import { describe, expect, test } from "bun:test"
import { LLMError, ProviderInternalReason, TransportReason } from "@opencode-ai/llm"
import { SessionRetry } from "@opencode-ai/core/session/retry"
import { Effect } from "effect"
import { it } from "./lib/effect"

describe("SessionRetry", () => {
  test("honors provider retry-after and bounds exponential jitter", () => {
    expect(
      SessionRetry.delay(
        2,
        new LLMError({
          module: "test",
          method: "stream",
          reason: new ProviderInternalReason({ message: "busy", status: 503, retryAfterMs: 9_000 }),
        }),
        0,
      ),
    ).toBe(9_000)
    expect(SessionRetry.delay(1, undefined, 0)).toBe(2_000)
    expect(SessionRetry.delay(99, undefined, 1)).toBe(30_000)
  })

  it.effect("retries typed provider and network transport failures only", () =>
    Effect.sync(() => {
      expect(
        SessionRetry.retryable(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new ProviderInternalReason({ message: "busy", status: 500 }),
          }),
        ),
      ).toBe(true)
      expect(
        SessionRetry.retryable(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new TransportReason({ message: "fetch failed", kind: "RequestError" }),
          }),
        ),
      ).toBe(true)
    }),
  )
})
