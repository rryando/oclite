import { Schema } from "effect"
import { LLMError, ProviderErrorEvent } from "./schema"

// Provider error message classification. Context-overflow errors are reported
// inconsistently across providers (Anthropic, OpenAI, Bedrock, gateways) with
// no machine-readable code, so we match on the stable phrases each surfaces
// when the request exceeds the model's context window.
const CONTEXT_OVERFLOW_PATTERNS = [
  /context.{0,20}(?:length|window|limit)/i,
  /maximum.{0,20}context/i,
  /prompt is too long/i,
  /too many (?:input )?tokens/i,
  /exceeds?.{0,30}(?:token|context).{0,20}limit/i,
  /input length and `max_tokens` exceed context limit/i,
  /reduce the length of (?:the messages|your prompt)/i,
]

/** Heuristic: does a provider error message describe a context-window overflow? */
export const isContextOverflow = (message: string): boolean =>
  CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message))

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && isContextOverflow(failure.reason.message)
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"
