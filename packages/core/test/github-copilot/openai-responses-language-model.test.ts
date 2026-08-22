import { expect, mock, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { convertToOpenAIResponsesInput } from "@opencode-ai/core/github-copilot/responses/convert-to-openai-responses-input"
import { OpenAIResponsesLanguageModel } from "@opencode-ai/core/github-copilot/responses/openai-responses-language-model"

const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

test("Copilot Responses emits item metadata under the copilot namespace", async () => {
  const fetch = mock(async () =>
    Response.json({
      id: "resp_1",
      created_at: 0,
      model: "gpt-5.5",
      output: [
        {
          type: "message",
          role: "assistant",
          id: "msg_1",
          content: [{ type: "output_text", text: "Hello", annotations: [] }],
        },
        { type: "function_call", call_id: "call_1", name: "bash", arguments: "{}", id: "fc_1" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
  const model = new OpenAIResponsesLanguageModel("test-model", {
    provider: "copilot",
    url: () => "https://api.test.com/responses",
    headers: () => ({ Authorization: "Bearer test" }),
    fetch: fetch as never,
  })

  const result = await model.doGenerate({ prompt, includeRawChunks: false })

  expect(result.content[0].providerMetadata?.copilot?.itemId).toBe("msg_1")
  expect(result.content[0].providerMetadata?.openai).toBeUndefined()
  expect(result.content[1].providerMetadata?.copilot?.itemId).toBe("fc_1")
  expect(result.providerMetadata?.copilot?.responseId).toBe("resp_1")
})

test("Copilot Responses reads replay metadata from the copilot namespace", async () => {
  const result = await convertToOpenAIResponsesInput({
    prompt: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "bash",
            input: { command: "ls" },
            providerOptions: { copilot: { itemId: "fc_999" } },
          },
        ],
      },
    ],
    systemMessageMode: "system",
    store: false,
  })

  expect(result.input[0]).toMatchObject({ type: "function_call", id: "fc_999" })
})
