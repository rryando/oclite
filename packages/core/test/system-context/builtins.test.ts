import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Location } from "@opencode-ai/core/location"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextBuiltIns } from "@opencode-ai/core/system-context/builtins"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { node as sessionRunnerNode } from "@opencode-ai/core/session/runner/llm"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { testEffect } from "../lib/effect"

const directory = "/workspace"
const it = testEffect(
  SystemContextBuiltIns.defaultLayer.pipe(
    Layer.provideMerge(Layer.succeed(Location.Service, Location.Service.of({ directory }))),
  ),
)

describe("SystemContextBuiltIns", () => {
  test("is installed in the production session runner graph", () => {
    expect(sessionRunnerNode.service).toBe(SessionRunner.Service)
    expect(sessionRunnerNode.dependencies).toContain(SystemContextBuiltIns.node)
    expect(sessionRunnerNode.dependencies).toContain(InstructionContext.node)
  })

  it.effect("registers environment and date as independent sources", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const generation = yield* SystemContext.initialize(yield* registry.load())

      expect(generation.baseline).toContain(`Working directory: ${directory}`)
      expect(generation.snapshot).toHaveProperty("core/environment")
      expect(generation.snapshot).toHaveProperty("core/date")
    }),
  )
})
