import { expect, test } from "bun:test"
import { MAX_STEPS_PROMPT } from "@opencode-ai/core/session/runner/max-steps"

test("final-step instruction disables tools and requires a summary", () => {
  expect(MAX_STEPS_PROMPT).toContain("MAXIMUM STEPS REACHED")
  expect(MAX_STEPS_PROMPT).toContain("Tools are disabled")
  expect(MAX_STEPS_PROMPT).toContain("text response summarizing work done")
})
