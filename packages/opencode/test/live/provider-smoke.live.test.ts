import { describe, expect, test } from "bun:test"
import {
  assertLiveSmokeEvents,
  liveProviderSmoke,
  parseLiveConfig,
  parseNdjsonEvents,
  sanitizeLiveDiagnostic,
  type LiveScenario,
} from "../lib/live-provider-smoke"

describe("live provider smoke harness guards", () => {
  test("is disabled without an exact opt-in", () => {
    expect(parseLiveConfig({}).enabled).toBe(false)
    expect(parseLiveConfig({ LIVE_LLM: "true" }).enabled).toBe(false)
  })

  test("requires bounded configuration after opt-in", () => {
    expect(() => parseLiveConfig({ LIVE_LLM: "1" })).toThrow("LIVE_PROVIDER")
    expect(() =>
      parseLiveConfig({
        LIVE_LLM: "1",
        LIVE_PROVIDER: "anthropic",
        LIVE_MODEL: "openai/gpt-5",
        LIVE_SCENARIO: "normal",
        LIVE_MAX_CALLS: "1",
      }),
    ).toThrow("must start with anthropic/")
    expect(() =>
      parseLiveConfig({
        LIVE_LLM: "1",
        LIVE_PROVIDER: "anthropic",
        LIVE_MODEL: "anthropic/claude-sonnet-4-5",
        LIVE_SCENARIO: "normal",
        LIVE_MAX_CALLS: "0",
      }),
    ).toThrow("LIVE_MAX_CALLS")
    expect(() =>
      parseLiveConfig({
        LIVE_LLM: "1",
        LIVE_PROVIDER: "anthropic",
        LIVE_MODEL: "anthropic/claude-sonnet-4-5",
        LIVE_SCENARIO: "subagent",
        LIVE_MAX_CALLS: "2",
      }),
    ).toThrow("at least 3")
  })

  test("accepts each supported scenario with an explicit call limit", () => {
    for (const scenario of ["normal", "read-tool", "usage", "subagent"] satisfies LiveScenario[]) {
      const config = parseLiveConfig({
        LIVE_LLM: "1",
        LIVE_PROVIDER: "anthropic",
        LIVE_MODEL: "anthropic/claude-sonnet-4-5",
        LIVE_SCENARIO: scenario,
        LIVE_MAX_CALLS: "3",
      })
      expect(config).toMatchObject({ enabled: true, scenario, maxCalls: 3 })
    }
  })

  test("parses NDJSON strictly and rejects malformed output", () => {
    expect(
      parseNdjsonEvents(
        '{"type":"step_start","sessionID":"ses_1","part":{"type":"step-start"}}\n' +
          '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"ok"}}\n',
      ),
    ).toHaveLength(2)
    expect(() => parseNdjsonEvents('{"type":"text","sessionID":"ses_1"}\nnot-json\n')).toThrow("NDJSON line 2")
    expect(() => parseNdjsonEvents("[]\n")).toThrow("NDJSON line 1")
  })

  test("redacts credentials from live diagnostics", () => {
    expect(
      sanitizeLiveDiagnostic(
        "Authorization: Bearer secret-value\napi_key=sk-test-123\naccess_token=token-sensitive-value",
      ),
    ).toBe("Authorization: Bearer [REDACTED]\napi_key=[REDACTED]\naccess_token=[REDACTED]")
  })

  test("validates text, steps, tool use, usage, and max-call guards", () => {
    const step = (input = 1, output = 1, cost = 0) => ({
      type: "step_finish",
      sessionID: "ses_1",
      part: {
        type: "step-finish",
        cost,
        tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    const start = { type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }
    const text = { type: "text", sessionID: "ses_1", part: { type: "text", text: "LIVE_SMOKE_OK" } }
    const tool = {
      type: "tool_use",
      sessionID: "ses_1",
      part: { type: "tool", tool: "read", state: { status: "completed" } },
    }

    expect(() => assertLiveSmokeEvents([start, text, step()], "normal", 1)).not.toThrow()
    expect(() => assertLiveSmokeEvents([start, tool, text, step(), step()], "read-tool", 2)).not.toThrow()
    expect(() => assertLiveSmokeEvents([start, text, step()], "usage", 1)).not.toThrow()
    expect(() => assertLiveSmokeEvents([start, text, step(-1, 1)], "usage", 1)).toThrow("finite nonnegative")
    expect(() => assertLiveSmokeEvents([start, text, step(1, 1, -1)], "usage", 1)).toThrow("cost")
    expect(() => assertLiveSmokeEvents([start, text, step(0, 0)], "usage", 1)).toThrow("positive input and output")
    expect(() =>
      assertLiveSmokeEvents([start, { ...text, part: { ...text.part, text: "wrong" } }, step()], "normal", 1),
    ).toThrow("did not equal")
    expect(() => assertLiveSmokeEvents([start, text, step(), step()], "normal", 1)).toThrow("LIVE_MAX_CALLS")
    expect(() => assertLiveSmokeEvents([start, text, step()], "read-tool", 1)).toThrow("read tool")
  })
})

const live = parseLiveConfig(process.env)

if (!live.enabled) {
  test.skip("live provider smoke (set LIVE_LLM=1 to opt in)", () => {})
} else {
  test(`live provider smoke: ${live.scenario}`, async () => {
    const result = await liveProviderSmoke(live)
    expect(result.exitCode, result.stderr).toBe(0)
    assertLiveSmokeEvents(result.events, live.scenario, live.maxCalls, result.expectedText)
  }, 95_000)
}
