export * as SessionRetry from "./retry"

import type { LLMError } from "@opencode-ai/llm"

export const INITIAL_DELAY = 2_000
export const BACKOFF_FACTOR = 2
export const JITTER_FACTOR = 0.25
export const MAX_DELAY_WITHOUT_PROVIDER_HINT = 30_000
export const MAX_DELAY = 2_147_483_647
export const MAX_RETRIES = 5

const NETWORK_ERROR =
  /fetch failed|failed to fetch|network[-_\s]error|connection (?:error|refused|lost)|socket (?:connection was closed|hang up)|reset before headers|getaddrinfo|enotfound|eai_again|econnrefused|econnreset|etimedout|\b(?:request|response|connection|network|stream|read) (?:timeout|timed out|time out)\b/i

const exponential = (attempt: number, random: number) => {
  const base = INITIAL_DELAY * BACKOFF_FACTOR ** (attempt - 1)
  return Math.ceil(base + base * JITTER_FACTOR * random)
}

export function delay(attempt: number, error?: LLMError, random = Math.random()) {
  if (error?.retryAfterMs !== undefined) return Math.min(Math.max(0, error.retryAfterMs), MAX_DELAY)
  return Math.min(exponential(attempt, random), MAX_DELAY_WITHOUT_PROVIDER_HINT)
}

export function retryable(error: LLMError) {
  if (error.reason._tag === "InvalidRequest") return false
  if (error.retryable) return true
  return error.reason._tag === "Transport" && NETWORK_ERROR.test(error.reason.message)
}

export function info(error: LLMError) {
  const http = "http" in error.reason ? error.reason.http : undefined
  return {
    message: error.reason.message,
    isRetryable: retryable(error),
    ...(http?.response?.status === undefined ? {} : { statusCode: http.response.status }),
    ...(http?.response?.headers === undefined ? {} : { responseHeaders: http.response.headers }),
    ...(http?.body === undefined ? {} : { responseBody: http.body }),
  }
}
