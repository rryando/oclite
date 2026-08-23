import { describe, expect } from "bun:test"
import { Effect, Exit, Schema, Scope } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { testEffect } from "../lib/effect"

const it = testEffect(SystemContextRegistry.layer)
const entry = (key: string, value: string) => ({
  key: SystemContext.Key.make(key),
  load: Effect.succeed(
    SystemContext.make({
      key: SystemContext.Key.make(key),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.succeed(value),
      baseline: String,
      update: (_previous: string, current: string) => current,
    }),
  ),
})

describe("SystemContextRegistry", () => {
  it.effect("loads entries in stable order and removes them with their scope", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const scope = yield* Scope.make()
      yield* registry.register(entry("test/z", "last")).pipe(Scope.provide(scope))
      yield* registry.register(entry("test/a", "first"))

      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("first\n\nlast")
      yield* Scope.close(scope, Exit.void)
      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("first")
    }),
  )
})
