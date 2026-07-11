import { Installation } from "@/installation"
import { Server } from "@/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

// v1.17.10 parity: a rejecting RPC handler never reaches Rpc.listen's
// postMessage(rpc.result), so the TUI-side client.call() promise hangs
// forever (e.g. createWorkerFetch awaiting "fetch"), which breaks/hangs the
// whole TUI process. Rpc.listen (packages/opencode/src/util/rpc.ts) has no
// try/catch of its own, so we make every handler guarantee resolution here:
// on failure we log via the same channel as the existing unhandledRejection
// handler and return a well-formed fallback so the client always unblocks.
function guard<Args extends unknown[], Result>(
  method: string,
  handler: (...args: Args) => Result | Promise<Result>,
  fallback: (...args: Args) => Result,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (e) {
      Log.Default.error("rpc handler failed", {
        method,
        e: e instanceof Error ? e.message : e,
      })
      return fallback(...args)
    }
  }
}

export const rpc = {
  fetch: guard(
    "fetch",
    async (input: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
      const headers = { ...input.headers }
      const auth = ServerAuth.header()
      if (auth && !headers["authorization"] && !headers["Authorization"]) {
        headers["Authorization"] = auth
      }
      const request = new Request(input.url, {
        method: input.method,
        headers,
        body: input.body,
      })
      const response = await Server.Default().app.fetch(request)
      const body = await response.text()
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      }
    },
    () => ({
      status: 500,
      headers: { "content-type": "text/plain" } as Record<string, string>,
      body: "worker fetch failed",
    }),
  ),
  snapshot: guard(
    "snapshot",
    () => writeHeapSnapshot("server.heapsnapshot"),
    () => "" as ReturnType<typeof writeHeapSnapshot>,
  ),
  server: guard(
    "server",
    async (input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) => {
      if (server) await server.stop(true)
      server = await Server.listen(input)
      return { url: server.url.toString() }
    },
    () => ({ url: "" }),
  ),
  checkUpgrade: guard(
    "checkUpgrade",
    async (input: { directory: string }) => {
      await InstanceRuntime.load({ directory: input.directory })
      await upgrade().catch(() => {})
    },
    () => undefined,
  ),
  reload: guard(
    "reload",
    async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const cfg = yield* Config.Service
          yield* cfg.invalidate()
          yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
        }),
      )
    },
    () => undefined,
  ),
  shutdown: guard(
    "shutdown",
    async () => {
      Log.Default.info("worker shutting down")

      await InstanceRuntime.disposeAllInstances()
      if (server) await server.stop(true)
    },
    () => undefined,
  ),
}

Rpc.listen(rpc)
