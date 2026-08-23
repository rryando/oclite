import { describe, expect } from "bun:test"
import { CoreSession } from "@/effect/core-session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Effect, Layer } from "effect"
import { SessionV2 } from "@/v2/session"
import { Session } from "@/session/session"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Tool } from "@opencode-ai/core/tool/tool"
import { LLMEvent } from "@opencode-ai/llm"
import path from "node:path"

const it = testEffect(Layer.mergeAll(CoreSession.defaultLayer, Session.defaultLayer))
const session = testEffect(SessionV2.layer)

describe("CoreSession production adapter", () => {
  it.instance("registers current application tools including task and spawn_project", () =>
    Effect.gen(function* () {
      const service = yield* CoreSession.Service
      const test = yield* TestInstance
      const runtime = yield* service.current(test.directory)
      expect(Array.from(runtime.tools().keys())).toEqual(
        expect.arrayContaining(["bash", "read", "edit", "task", "spawn_project"]),
      )
    }),
  )

  it.instance("executes registered tools through legacy context and permissions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const chat = yield* sessions.create({ permission: [{ permission: "read", pattern: "*", action: "allow" }] })
      const file = path.join(test.directory, "adapter.txt")
      yield* Effect.promise(() => Bun.write(file, "adapter works"))
      const runtime = yield* (yield* CoreSession.Service).current(test.directory)
      const read = runtime.tools().get("read")
      expect(read).toBeDefined()
      const output = yield* Tool.settle(
        read!.tool,
        LLMEvent.toolCall({ id: "call_read", name: "read", input: { filePath: file } }),
        {
          sessionID: chat.id,
          agent: AgentV2.ID.make("build"),
          assistantMessageID: SessionMessage.ID.create(),
          toolCallID: "call_read",
        },
      )
      expect(output.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("adapter works") })]),
      )
    }),
  )
})

describe("SessionV2 lifecycle adapter", () => {
  session.instance("preserves parent and origin session links", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const parent = yield* sessions.create()
      const child = yield* sessions.create({ parentID: parent.id, originSessionID: parent.id })
      expect(child.parentID).toBe(parent.id)
      expect(child.originSessionID).toBe(parent.id)
    }),
  )
})
