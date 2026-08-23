import { Effect } from "effect"
import { LLM, Message } from "./src/index"
import { Anthropic } from "./src/providers/index"
import type { LLMRequest } from "./src/schema"

const model = Anthropic.configure({
  apiKey: "sk-zen-test-123",
  baseURL: "https://opencode.ai/zen/v1",
}).model("claude-haiku-4-5")

const request = LLM.request({
  model,
  messages: [Message.user("hi")],
})

const probe = Effect.gen(function* () {
  const route = model.route
  const body = yield* route.body.from(request)
  const prepared = yield* route.prepareTransport(body, request as LLMRequest)
  console.log("URL:", (prepared as any).request.url)
  console.log("HEADERS:", JSON.stringify((prepared as any).request.headers, null, 2))
})

Effect.runPromise(probe).catch((e) => {
  console.error("PROBE FAILED:", e)
  process.exit(1)
})