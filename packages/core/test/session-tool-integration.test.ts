import { describe, expect } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tools } from "@opencode-ai/core/tool/tools"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"

const registered = new Map<string, ApplicationTools.Entry>()
const layer = ToolRegistry.layer.pipe(
  Layer.provideMerge(PluginV2.layer),
  Layer.provideMerge(
    Layer.succeed(
      ApplicationTools.Service,
      ApplicationTools.Service.of({
        entries: () => registered,
        register: () => Effect.void,
      }),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ToolOutputStore.Service,
      ToolOutputStore.Service.of({
        limits: () => Effect.succeed({ maxLines: 2_000, maxBytes: 50 * 1_024 }),
        bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
        cleanup: () => Effect.void,
      }),
    ),
  ),
)
const it = testEffect(layer)

describe("Session tool integration", () => {
  it.effect("runs plugin hooks around MCP-style registered structured tools", () =>
    Effect.gen(function* () {
      registered.clear()
      const tool = Tool.make({
        description: "Echo structured input",
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.Struct({ value: Schema.String }),
        execute: (input) => Effect.succeed(input),
      })
      yield* (yield* Tools.Service).register({ mcp_echo: tool })
      const plugins = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugins.add({
        id: PluginV2.ID.make("test-tool-hooks"),
        effect: Effect.succeed({
          "tool.execute.before": (event) =>
            Effect.sync(() => {
              calls.push("before")
              event.args = { value: "changed" }
            }),
          "tool.execute.after": (event) =>
            Effect.sync(() => {
              calls.push("after")
              event.output.structured = { value: "hooked" }
            }),
        }),
      })
      const materialized = yield* (yield* ToolRegistry.Service).materialize()
      const definition = materialized.definitions.find((item) => item.name === "mcp_echo")
      expect(definition?.outputSchema).toEqual({
        type: "object",
        required: ["value"],
        properties: { value: { type: "string" } },
        additionalProperties: false,
      })
      const settled = yield* materialized.settle({
        sessionID: SessionV2.ID.make("ses_tool_hooks"),
        agent: AgentV2.ID.make("build"),
        assistantMessageID: SessionMessage.ID.create(),
        call: LLMEvent.toolCall({ id: "call_1", name: "mcp_echo", input: { value: "original" } }),
      })
      expect(calls).toEqual(["before", "after"])
      expect(settled.output?.structured).toEqual({ value: "hooked" })
    }),
  )
})
