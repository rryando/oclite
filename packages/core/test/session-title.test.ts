import { expect, test } from "bun:test"
import { cleanTitle, isDefaultTitle } from "@opencode-ai/core/session/runner/llm"

test("recognizes owned default titles and cleans generated titles", () => {
  expect(isDefaultTitle("New session - 2026-08-22T10:20:30.000Z")).toBe(true)
  expect(isDefaultTitle("Child session - 2026-08-22T10:20:30.000Z")).toBe(true)
  expect(isDefaultTitle("User title")).toBe(false)
  expect(cleanTitle("<think>draft</think>\n  Useful title\nignored")).toBe("Useful title")
  expect(cleanTitle("x".repeat(101))).toBe(`${"x".repeat(97)}...`)
})
