import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context"
import { it } from "../lib/effect"

const source = (value: string | SystemContext.Unavailable) =>
  SystemContext.make({
    key: SystemContext.Key.make("test/source"),
    codec: Schema.toCodecJson(Schema.String),
    load: Effect.succeed(value),
    baseline: (current) => `Baseline: ${current}`,
    update: (previous, current) => `Changed: ${previous} -> ${current}`,
    removed: (previous) => `Removed: ${previous}`,
  })

describe("SystemContext", () => {
  it.effect("returns unchanged for compatible equal source values", () =>
    Effect.gen(function* () {
      const initial = yield* SystemContext.initialize(source("one"))
      expect(yield* SystemContext.reconcile(source("one"), initial.snapshot)).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("renders source-aware updates", () =>
    Effect.gen(function* () {
      const initial = yield* SystemContext.initialize(source("one"))
      expect(yield* SystemContext.reconcile(source("two"), initial.snapshot)).toEqual({
        _tag: "Updated",
        text: "Changed: one -> two",
        snapshot: { "test/source": { value: "two", removed: "Removed: two" } },
      })
    }),
  )

  it.effect("replaces generations when stored source data is incompatible", () =>
    Effect.gen(function* () {
      expect(
        yield* SystemContext.reconcile(source("current"), {
          "test/source": { value: 42, removed: "Removed" },
        }),
      ).toEqual({
        _tag: "ReplacementReady",
        generation: {
          baseline: "Baseline: current",
          snapshot: { "test/source": { value: "current", removed: "Removed: current" } },
        },
      })
    }),
  )

  it.effect("preserves snapshots and blocks replacement while an admitted source is unavailable", () =>
    Effect.gen(function* () {
      const previous = { "test/source": { value: "one", removed: "Removed: one" } }
      expect(yield* SystemContext.reconcile(source(SystemContext.unavailable), previous)).toEqual({
        _tag: "Unchanged",
      })
      expect(yield* SystemContext.replace(source(SystemContext.unavailable), previous)).toEqual({
        _tag: "ReplacementBlocked",
      })
    }),
  )
})
