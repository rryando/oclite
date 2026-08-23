import { expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { testEffect } from "./lib/effect"

const it = testEffect(Snapshot.layer)

it.effect("reports unavailable snapshot operations explicitly", () =>
  Effect.gen(function* () {
    const snapshots = yield* Snapshot.Service
    expect(yield* snapshots.capture()).toBeUndefined()

    const result = yield* snapshots
      .files({ from: Snapshot.ID.make("from"), to: Snapshot.ID.make("to") })
      .pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) expect(result.cause.toString()).toContain("Snapshots are not available")
  }),
)
