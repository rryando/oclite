import path from "node:path"
import { expect, test } from "bun:test"

test("preserves output schema validators across tool pages", async () => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "pagination-schema.fixture.ts")], {
    cwd: path.join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ])

  expect(code, stderr).toBe(0)
  const result = JSON.parse(stdout) as { tools: string[]; error: string }
  expect(result.tools).toEqual(["first", "second"])
  expect(result.error).toContain("Structured content does not match the tool's output schema")
})
