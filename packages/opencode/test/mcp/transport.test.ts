import path from "node:path"
import { expect, test } from "bun:test"

test("does not reconnect an SSE stream after a JSON-RPC error response", async () => {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "transport.fixture.ts")], {
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
  expect(stdout).toBe("1")
})
