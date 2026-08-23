import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
  Promise.resolve(
    params?.cursor === "page-2"
      ? {
          tools: [
            {
              name: "second",
              inputSchema: { type: "object" },
              outputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
            },
          ],
        }
      : {
          tools: [
            {
              name: "first",
              inputSchema: { type: "object" },
              outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
            },
          ],
          nextCursor: "page-2",
        },
  ),
)
server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
  Promise.resolve({ content: [], structuredContent: { value: params.name === "first" ? 42 : 1 } }),
)

const client = new Client({ name: "pagination-test", version: "1.0.0" })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

try {
  const first = await client.listTools()
  const second = await client.listTools({ cursor: first.nextCursor })
  let error = ""
  try {
    await client.callTool({ name: "first", arguments: {} })
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  process.stdout.write(JSON.stringify({ tools: [...first.tools, ...second.tools].map((tool) => tool.name), error }))
} finally {
  await Promise.all([client.close(), server.close()])
}
