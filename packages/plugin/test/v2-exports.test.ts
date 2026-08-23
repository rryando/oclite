import { expect, test } from "bun:test"
import { Effect } from "effect"
import { define as defineEffect } from "@opencode-ai/plugin/v2/effect"
import { define as definePromise } from "@opencode-ai/plugin/v2/promise"

test("v2 plugin entrypoints preserve typed plugin definitions", () => {
  const effect = defineEffect({ id: "effect", effect: () => Effect.void })
  const promise = definePromise({ id: "promise", setup: async () => {} })

  expect(effect.id).toBe("effect")
  expect(promise.id).toBe("promise")
})
