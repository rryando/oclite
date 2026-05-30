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
import { disposeAllInstances, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

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

const seed = Effect.fn("SpawnProjectTest.seed")(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "Origin" })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
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
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text", text }],
  }
}

describe("tool.spawn_project", () => {
  it.instance("creates a top-level session in the target directory linked by originSessionID", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const target = yield* tmpdirScoped()
      const tool = yield* SpawnProjectTool
      const def = yield* tool.init()

      const prompted: SessionID[] = []
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.sync(() => {
            prompted.push(input.sessionID)
            return reply(input, "spawned done")
          }),
      }

      const result = yield* def.execute(
        { directory: target, prompt: "do the cross-project work", description: "cross task" },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const spawnedId = SessionID.make(result.metadata.sessionId as string)
      // Tool returns promptly with a running spawn confirmation.
      expect(result.output).toContain(`<spawn id="${spawnedId}"`)
      expect(result.output).toContain('state="running"')
      expect(result.metadata.directory).toBe(target)
      expect(result.metadata.originSessionId).toBe(chat.id)

      // The spawned session is top-level (no parent) and linked back to origin.
      const spawned = yield* sessions.get(spawnedId)
      expect(spawned.parentID).toBeUndefined()
      expect(spawned.originSessionID).toBe(chat.id)
      expect(spawned.directory).toBe(target)

      // It is NOT a child of the origin session.
      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(0)

      // The spawn turn runs detached. On completion its result is injected back
      // into the origin session - wait for that published signal rather than a
      // fixed sleep. The spawn turn targets the spawned session; the injection
      // targets the origin session (two distinct prompt targets).
      yield* pollWithTimeout(
        Effect.sync(() => (prompted.includes(spawnedId) && prompted.includes(chat.id) ? true : undefined)),
        "spawn completion was never injected into the origin session",
      )
    }),
  )
})
