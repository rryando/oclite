import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SpawnProjectTool } from "../../src/tool/spawn_project"
import { type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

// End-to-end cross-project spawn coverage across TWO real project directories.
//
// We exercise the real SpawnProjectTool against the real InstanceStore, Session,
// DB and BackgroundJob. The ONLY stub is `promptOps` — the LLM-turn boundary —
// matching the seam the existing spawn_project/task tool tests stub. The stub
// does not fake any session/instance/db behaviour: when the spawned turn runs it
// persists a real assistant message through Session.updateMessage/updatePart,
// exactly as a real turn would, so we can assert the injected result becomes a
// genuine message in the origin session rather than inspecting an in-memory flag.

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionRunState.defaultLayer,
  SessionStatus.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  testInstanceStoreLayer,
  RuntimeFlags.layer(),
)

const it = testEffect(layer)

// Persist a real assistant reply into `input.sessionID`, returning the same
// WithParts shape a production turn returns. This is what `promptOps.prompt`
// would ultimately produce — we keep the LLM out of the loop but let the actual
// Session machinery store the message and parts. The Session service is passed
// in explicitly so the resulting Effect has no service requirement (matching the
// `never`-R contract of TaskPromptOps.prompt).
const persistReply = Effect.fn("CrossProjectSpawnTest.persistReply")(function* (
  session: Session.Interface,
  input: SessionPrompt.PromptInput,
  text: string,
) {
  const messageID = input.messageID ?? MessageID.ascending()
  const info: MessageV2.Assistant = {
    id: messageID,
    role: "assistant",
    parentID: MessageID.ascending(),
    sessionID: input.sessionID,
    mode: input.agent ?? "general",
    agent: input.agent ?? "general",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: input.model?.modelID ?? ref.modelID,
    providerID: input.model?.providerID ?? ref.providerID,
    time: { created: Date.now() },
    finish: "stop",
  }
  yield* session.updateMessage(info)
  const part: MessageV2.TextPart = {
    id: PartID.ascending(),
    messageID,
    sessionID: input.sessionID,
    type: "text",
    text,
  }
  yield* session.updatePart(part)
  return { info, parts: [part] } satisfies MessageV2.WithParts
})

describe("integration: cross-project spawn", () => {
  it.live(
    "spawns a top-level session in another project, returns without blocking, then injects the result back into the origin",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service

        // Two separate git roots => two distinct project ids in the shared db.
        const dirA = yield* tmpdirScoped({ git: true })
        const dirB = yield* tmpdirScoped({ git: true })

        // Origin session lives in project A (the caller's instance context).
        const origin = yield* provideInstance(dirA)(sessions.create({ title: "origin-A" }))

        // An unrelated B session that was NOT spawned by A — must stay invisible
        // to A's linked scope.
        const unrelated = yield* provideInstance(dirB)(sessions.create({ title: "unrelated-B" }))

        // The stubbed LLM boundary. We record which sessions were prompted (so we
        // can observe the detached completion) and persist a real reply for each.
        const prompted: SessionID[] = []
        const promptOps: TaskPromptOps = {
          cancel: () => Effect.void,
          resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
          prompt: (input) =>
            Effect.gen(function* () {
              prompted.push(input.sessionID)
              return yield* persistReply(sessions, input, `spawned reply for ${input.sessionID}`)
            }),
        }

        // ---- Requirement 1 + 2 (return-without-blocking): execute the tool from
        // project A targeting project B's directory. The tool definition is
        // initialised inside dirA's instance context so it captures A as origin.
        const result = yield* provideInstance(dirA)(
          Effect.gen(function* () {
            const def = yield* (yield* SpawnProjectTool).init()
            return yield* def.execute(
              { directory: dirB, prompt: "do the cross-project work", description: "cross task" },
              {
                sessionID: origin.id,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                extra: { promptOps },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
          }),
        )

        const spawnedId = SessionID.make(result.metadata.sessionId as string)

        // Requirement 2 (does not block): the tool returned a "running" spawn
        // confirmation synchronously, before the spawned turn has completed.
        expect(result.output).toContain(`<spawn id="${spawnedId}"`)
        expect(result.output).toContain('state="running"')
        expect(result.metadata.directory).toBe(dirB)
        expect(result.metadata.originSessionId).toBe(origin.id)

        // ---- Requirement 1: the spawned session is TOP-LEVEL, lives in project B
        // (a different project than A), and is linked back to A via originSessionID.
        const spawned = yield* sessions.get(spawnedId)
        expect(spawned.parentID).toBeUndefined()
        expect(spawned.originSessionID).toBe(origin.id)
        expect(spawned.directory).toBe(dirB)
        // Different project than the origin (two git roots => two project ids).
        expect(spawned.projectID).not.toBe(origin.projectID)
        // And it is NOT a child of the origin session.
        const kids = yield* sessions.children(origin.id)
        expect(kids).toHaveLength(0)

        // ---- Requirement 2 (injection back into origin): the spawned turn runs
        // detached on a BackgroundJob fiber. On completion the result is injected
        // into the ORIGIN session. Wait for a published readiness signal — both
        // the spawned session and the origin session have been prompted — instead
        // of a fixed sleep.
        yield* pollWithTimeout(
          Effect.sync(() => (prompted.includes(spawnedId) && prompted.includes(origin.id) ? true : undefined)),
          "spawn completion was never injected into the origin session",
        )

        // The injection produced a REAL message in the origin session (persisted
        // through the actual Session machinery, not a mock).
        const originMessages = yield* provideInstance(dirA)(sessions.messages({ sessionID: origin.id }))
        const injected = originMessages.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes(`spawned reply for ${origin.id}`)),
        )
        expect(injected).toBeDefined()

        // ---- Requirement 3: linked-scope listing from project A.
        // Default scope from A: only A's own sessions; the spawned B session and
        // the unrelated B session are both invisible.
        const defaultIds = yield* provideInstance(dirA)(sessions.list()).pipe(Effect.map((s) => s.map((x) => x.id)))
        expect(defaultIds).toContain(origin.id)
        expect(defaultIds).not.toContain(spawnedId)
        expect(defaultIds).not.toContain(unrelated.id)

        // Linked scope from A: A's own sessions PLUS the cross-project session A
        // spawned — but NOT the unrelated B session A never spawned.
        const linkedIds = yield* provideInstance(dirA)(sessions.list({ scope: "linked" })).pipe(
          Effect.map((s) => s.map((x) => x.id)),
        )
        expect(linkedIds).toContain(origin.id)
        expect(linkedIds).toContain(spawnedId)
        expect(linkedIds).not.toContain(unrelated.id)

        yield* sessions.remove(spawnedId)
        yield* sessions.remove(unrelated.id)
        yield* sessions.remove(origin.id)
      }),
    { timeout: 30000 },
  )
})
