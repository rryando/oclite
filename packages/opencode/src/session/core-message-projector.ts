import { Database } from "@/storage/database"
import { MessageV2 } from "./message-v2"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import { MessageID, PartID, SessionID } from "./schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { SyncEvent } from "@/sync"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime, Effect } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { isDeepStrictEqual } from "node:util"

export const project = Effect.fn("CoreMessageProjector.project")(function* (
  sync: SyncEvent.Interface,
  sessionID: SessionID,
  message: SessionMessage.Message,
) {
  const session = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
  if (!session) return
  if (message.type !== "user" && message.type !== "assistant" && message.type !== "compaction") return

  const existing = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.session_id, sessionID), eq(PartTable.message_id, MessageID.make(message.id))))
      .orderBy(asc(PartTable.time_created), asc(PartTable.id))
      .all(),
  )
  const partID = (index: number) => existing[index]?.id ?? PartID.ascending()
  const time = DateTime.toEpochMillis(message.time.created)

  if (message.type === "user") {
    const model = session.model
    const info: MessageV2.User = {
      id: MessageID.make(message.id),
      sessionID,
      role: "user",
      time: { created: time },
      agent: session.agent ?? "build",
      model: {
        providerID: ProviderID.make(model?.providerID ?? "unknown"),
        modelID: ModelID.make(model?.id ?? "unknown"),
        variant: model?.variant,
      },
    }
    const parts: MessageV2.Part[] = [
      ...(message.text
        ? [
            {
              id: partID(0),
              messageID: info.id,
              sessionID,
              type: "text" as const,
              text: message.text,
            },
          ]
        : []),
      ...(message.files ?? []).map((file, index) => ({
        id: partID(index + Number(Boolean(message.text))),
        messageID: info.id,
        sessionID,
        type: "file" as const,
        mime: file.mime,
        filename: file.name,
        url: file.uri,
      })),
      ...(message.agents ?? []).map((agent, index) => ({
        id: partID(index + Number(Boolean(message.text)) + (message.files?.length ?? 0)),
        messageID: info.id,
        sessionID,
        type: "agent" as const,
        name: agent.name,
      })),
    ]
    yield* publish(sync, info, parts, time)
    return
  }

  if (message.type === "compaction") {
    const model = session.model
    const info: MessageV2.User = {
      id: MessageID.make(message.id),
      sessionID,
      role: "user",
      time: { created: time },
      agent: session.agent ?? "build",
      model: {
        providerID: ProviderID.make(model?.providerID ?? "unknown"),
        modelID: ModelID.make(model?.id ?? "unknown"),
        variant: model?.variant,
      },
    }
    yield* publish(
      sync,
      info,
      [
        {
          id: partID(0),
          messageID: info.id,
          sessionID,
          type: "compaction",
          auto: message.reason === "auto",
        },
        {
          id: partID(1),
          messageID: info.id,
          sessionID,
          type: "text",
          text: message.summary,
          synthetic: true,
        },
      ],
      time,
    )
    return
  }

  const parent = Database.use((db) =>
    db
      .select({ id: MessageTable.id })
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
      .all()
      .findLast((row) => String(row.id) !== String(message.id)),
  )
  if (!parent) return
  const info: MessageV2.Assistant = {
    id: MessageID.make(message.id),
    sessionID,
    role: "assistant",
    parentID: parent.id,
    time: {
      created: time,
      completed: message.time.completed ? DateTime.toEpochMillis(message.time.completed) : undefined,
    },
    modelID: ModelID.make(message.model.id),
    providerID: ProviderID.make(message.model.providerID),
    variant: message.model.variant,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: session.directory, root: session.directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: message.finish,
    error: message.error
      ? MessageV2.fromError(new Error(message.error.message), { providerID: ProviderID.make(message.model.providerID) })
      : undefined,
  }
  const content = message.content.map((item, index): MessageV2.Part => {
    const base = { id: partID(index + 1), messageID: info.id, sessionID }
    if (item.type === "text") return { ...base, type: "text", text: item.text }
    if (item.type === "reasoning")
      return {
        ...base,
        type: "reasoning",
        text: item.text,
        metadata: item.providerMetadata,
        time: {
          start: DateTime.toEpochMillis(item.time?.created ?? message.time.created),
          end: item.time?.completed ? DateTime.toEpochMillis(item.time.completed) : undefined,
        },
      }
    const started = DateTime.toEpochMillis(item.time.ran ?? item.time.created)
    const input = typeof item.state.input === "string" ? {} : item.state.input
    if (item.state.status === "pending")
      return {
        ...base,
        type: "tool",
        tool: item.name,
        callID: item.id,
        state: { status: "pending", input, raw: item.state.input },
      }
    if (item.state.status === "running")
      return {
        ...base,
        type: "tool",
        tool: item.name,
        callID: item.id,
        state: { status: "running", input, time: { start: started }, metadata: item.state.structured },
        metadata: item.provider,
      }
    if (item.state.status === "error")
      return {
        ...base,
        type: "tool",
        tool: item.name,
        callID: item.id,
        state: {
          status: "error",
          input,
          error: item.state.error.message,
          metadata: item.state.structured,
          time: {
            start: started,
            end: DateTime.toEpochMillis(item.time.completed ?? message.time.completed ?? message.time.created),
          },
        },
        metadata: item.provider,
      }
    const structured = item.state.structured
    return {
      ...base,
      type: "tool",
      tool: item.name,
      callID: item.id,
      state: {
        status: "completed",
        input,
        output: item.state.content
          .map((part) => (part.type === "text" ? part.text : `[Attached ${part.mime}]`))
          .join("\n"),
        title: typeof structured.title === "string" ? structured.title : item.name,
        metadata:
          typeof structured.metadata === "object" && structured.metadata !== null
            ? (structured.metadata as Record<string, unknown>)
            : structured,
        time: {
          start: started,
          end: DateTime.toEpochMillis(item.time.completed ?? message.time.completed ?? message.time.created),
        },
      },
      metadata: item.provider,
    }
  })
  const parts: MessageV2.Part[] = [
    { id: partID(0), messageID: info.id, sessionID, type: "step-start", snapshot: message.snapshot?.start },
    ...content,
    ...(message.time.completed
      ? [
          {
            id: partID(content.length + 1),
            messageID: info.id,
            sessionID,
            type: "step-finish" as const,
            reason: message.finish ?? (message.error ? "error" : "stop"),
            snapshot: message.snapshot?.end,
            cost: message.cost ?? 0,
            tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ]
      : []),
  ]
  yield* publish(sync, info, parts, time)
})

const publish = Effect.fn("CoreMessageProjector.publish")(function* (
  sync: SyncEvent.Interface,
  info: MessageV2.Info,
  parts: MessageV2.Part[],
  time: number,
) {
  const message = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, info.id)).get())
  const messageData = (({ id: _, sessionID: __, ...data }) => data)(info)
  if (!message || !isDeepStrictEqual(message.data, messageData))
    yield* sync.run(MessageV2.Event.Updated, { sessionID: info.sessionID, info })

  const current = new Set(parts.map((part) => part.id))
  const stored = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.session_id, info.sessionID), eq(PartTable.message_id, info.id)))
      .all(),
  )
  for (const row of stored) {
    if (current.has(row.id)) continue
    yield* sync.run(MessageV2.Event.PartRemoved, {
      sessionID: info.sessionID,
      messageID: info.id,
      partID: row.id,
    })
  }
  for (const part of parts) {
    const row = stored.find((item) => item.id === part.id)
    const data = (({ id: _, messageID: __, sessionID: ___, ...value }) => value)(part)
    if (row && isDeepStrictEqual(row.data, data)) continue
    yield* sync.run(MessageV2.Event.PartUpdated, { sessionID: info.sessionID, part, time })
  }
})

export * as CoreMessageProjector from "./core-message-projector"
