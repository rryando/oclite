import { Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient } from "effect/unstable/http"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { LLMNativeRuntime } from "@/session/llm/native-runtime"

const captured: Array<{ url: string; headers: Record<string, string> }> = []
const captureFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value
  })
  captured.push({ url: String(input), headers })
  return new Response(JSON.stringify({ type: "error", error: { type: "AuthError", message: "Missing API key." } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  })
}

const provider: Provider.Info = {
  id: ProviderID.make("opencode"),
  name: "OpenCode Zen",
  source: "api",
  env: ["OPENCODE_API_KEY"],
  key: "sk-zen-key",
  options: {},
  models: {},
}

const capabilities = {
  temperature: true,
  reasoning: true,
  attachment: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: true },
  output: { text: true, audio: false, image: false, video: false, pdf: false },
  interleaved: false,
}

const model: Provider.Model = {
  id: ModelID.make("claude-haiku-4-5"),
  providerID: ProviderID.make("opencode"),
  api: { id: "claude-haiku-4-5", npm: "@ai-sdk/anthropic", url: "https://opencode.ai/zen/v1" },
  name: "Claude Haiku 4.5",
  family: "claude-haiku",
  capabilities,
  cost: { input: 1, output: 5, cache: { read: 0.1, write: 1.25 } },
  limit: { context: 200000, input: undefined, output: 64000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-10-15",
  variants: undefined,
}

const layer = LLMClient.layer.pipe(
  Layer.provide(Layer.mergeAll(RequestExecutor.layer, WebSocketExecutor.layer)),
  Layer.provide(
    FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, captureFetch as typeof fetch)),
    ),
  ),
)

const run = Effect.gen(function* () {
  const llmClient = yield* LLMClient.Service
  const result = LLMNativeRuntime.stream({
    model,
    provider,
    auth: undefined,
    llmClient,
    messages: [{ role: "user", content: "hi" }],
    tools: {},
    headers: {},
    abort: new AbortController().signal,
  })
  if (result.type === "unsupported") {
    console.log("GATE:", result.reason)
    return
  }
  const events = yield* result.stream.pipe(Stream.runCollect).pipe(Effect.exit)
  console.log("GATE: supported")
  console.log("CAPTURED:", JSON.stringify(captured, null, 2))
  console.log("EXIT:", events)
})

Effect.runPromise(Effect.provide(run, layer)).catch((e) => {
  console.error("PROBE FAILED:", e)
  process.exit(1)
})