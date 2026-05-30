import * as Tool from "./tool"
import DESCRIPTION from "./spawn_project.txt"
import { BackgroundJob } from "@/background/job"
import { InstanceStore } from "@/project/instance-store"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { Agent } from "../agent/agent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { TaskPromptOps } from "./task"
import { Cause, Effect, Option, Schema } from "effect"

const id = "spawn_project"

export const Parameters = Schema.Struct({
  directory: Schema.String.annotate({
    description: "Absolute path to the target project directory to spawn the session in",
  }),
  prompt: Schema.String.annotate({
    description: "The initial work for the spawned session to perform in the target project",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "A short (3-5 words) title for the spawned session",
  }),
})

function output(input: { sessionID: SessionID; directory: string }) {
  return [
    `<spawn id="${input.sessionID}" directory="${input.directory}" state="running">`,
    "<summary>Cross-project session spawned</summary>",
    "<spawn_result>",
    `Started a top-level session ${input.sessionID} in ${input.directory}.`,
    "It runs independently; you will be notified automatically when it finishes. Do not poll for progress.",
    "Continue only with non-overlapping work, or stop if there is nothing else useful to do.",
    "</spawn_result>",
    "</spawn>",
  ].join("\n")
}

function injectMessage(input: { sessionID: SessionID; directory: string; state: "completed" | "error"; text: string }) {
  const tag = input.state === "completed" ? "spawn_result" : "spawn_error"
  const title =
    input.state === "completed"
      ? `Cross-project session completed in ${input.directory}`
      : `Cross-project session failed in ${input.directory}`
  return [
    `<spawn id="${input.sessionID}" directory="${input.directory}" state="${input.state}">`,
    `<summary>${title}</summary>`,
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</spawn>",
  ].join("\n")
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const SpawnProjectTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("SpawnProjectTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      // InstanceStore switches the full instance context (directory, worktree,
      // project.id) to the target project. It is resolved optionally so the tool
      // can typecheck and degrade gracefully in runtimes that do not provide it.
      const store = Option.getOrUndefined(yield* Effect.serviceOption(InstanceStore.Service))
      if (!store) return yield* Effect.fail(new Error("SpawnProjectTool requires InstanceStore in the runtime"))

      const target = AppFileSystem.resolve(params.directory)
      // The origin (calling) session lives in the current instance. Capture its
      // directory now so completion results can be injected back into it later,
      // after we have switched the active instance to the target project.
      const originDirectory = yield* InstanceState.directory
      const description = params.description ?? "Cross-project task"

      yield* ctx.ask({
        permission: id,
        patterns: [target],
        always: ["*"],
        metadata: { directory: target, description },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("SpawnProjectTool requires promptOps in ctx.extra"))

      const next = yield* agent.get(ctx.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

      // Create a TOP-LEVEL session (no parentID) in the TARGET project's
      // instance context, linked back to the caller via originSessionID. Running
      // create inside store.provide({ directory: target }) switches the full
      // InstanceContext (directory, worktree, project.id) for the session.
      const spawned = yield* store.provide(
        { directory: target },
        sessions.create({
          originSessionID: ctx.sessionID,
          title: `${description} (spawned in ${target})`,
          agent: next?.name,
        }),
      )

      yield* ctx.metadata({
        title: description,
        metadata: {
          originSessionId: ctx.sessionID,
          sessionId: spawned.id,
          directory: target,
        },
      })

      // The spawned turn runs detached: the tool must not block the caller while
      // the spawned session works. Mirror the background-subagent mechanism -
      // BackgroundJob.start runs the turn on its own fiber and returns immediately.
      // On completion (or error) we inject the result back into the origin
      // session. Each job run injects exactly once, so there is no double-inject.
      const spawnTurn = ops.prompt({
        messageID: MessageID.ascending(),
        sessionID: spawned.id,
        agent: next?.name,
        parts: yield* ops.resolvePromptParts(params.prompt),
      })

      const inject = Effect.fn("SpawnProjectTool.inject")(function* (state: "completed" | "error", text: string) {
        yield* store
          .provide(
            { directory: originDirectory },
            ops.prompt({
              sessionID: ctx.sessionID,
              agent: ctx.agent,
              parts: [
                {
                  type: "text",
                  synthetic: true,
                  text: injectMessage({ sessionID: spawned.id, directory: target, state, text }),
                },
              ],
            }),
          )
          .pipe(Effect.ignore)
      })

      yield* store.provide(
        { directory: target },
        background.start({
          id: spawned.id,
          type: id,
          title: description,
          metadata: { originSessionId: ctx.sessionID, directory: target },
          run: spawnTurn.pipe(
            Effect.map((result) => result.parts.findLast((part) => part.type === "text")?.text ?? ""),
            Effect.tap((text) => inject("completed", text).pipe(Effect.ignore)),
            Effect.catchCause((cause) =>
              (Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : inject("error", errorText(Cause.squash(cause))).pipe(Effect.ignore)
              ).pipe(Effect.andThen(Effect.failCause(cause))),
            ),
          ),
        }),
      )

      return {
        title: description,
        metadata: {
          originSessionId: ctx.sessionID,
          sessionId: spawned.id,
          directory: target,
        },
        output: output({ sessionID: spawned.id, directory: target }),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
