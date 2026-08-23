import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionContextEpoch } from "@opencode-ai/core/session/context-epoch"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  SessionContextEpochTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { DateTime, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"

const run = async <A, E>(effect: Effect.Effect<A, E, Database.Service | EventV2.Service | SessionStore.Service>) => {
  await using directory = await tmpdir()
  const database = Database.layerFromPath(path.join(directory.path, "session.sqlite"))
  return Effect.runPromise(
    effect
      .pipe(
        Effect.provide(
          Layer.mergeAll(
            database,
            EventV2.layerWith().pipe(Layer.provide(database)),
            SessionStore.layer.pipe(Layer.provide(database)),
          ),
        ),
        Effect.scoped,
      )
      .pipe(Effect.orDie) as Effect.Effect<A>,
  )
}

const messageRow = (
  sessionID: SessionSchema.ID,
  seq: number,
  type: "system" | "user",
  text: string,
  created: DateTime.Utc,
) => ({
  id: SessionMessage.ID.create(),
  session_id: sessionID,
  type,
  seq,
  data: { text, time: { created: DateTime.toEpochMillis(created) } } as typeof SessionMessageTable.$inferInsert.data,
})

const text = (message: SessionMessage.Message) => ("text" in message ? message.text : undefined)

const seed = Effect.fnUntraced(function* () {
  const db = (yield* Database.Service).db
  const sessionID = SessionSchema.ID.create()
  yield* db
    .insert(ProjectTable)
    .values({ id: ProjectV2.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: ProjectV2.ID.global,
      slug: "data-layer",
      directory: AbsolutePath.make("/project"),
      title: "Data layer",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
  return { db, sessionID }
})

describe("session data layer", () => {
  test("reads a created session and orders history by aggregate sequence", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const store = yield* SessionStore.Service
        const created = yield* store.get(seeded.sessionID)
        expect(created).toMatchObject({ id: seeded.sessionID, title: "Data layer" })

        const now = yield* DateTime.now
        yield* seeded.db
          .insert(SessionMessageTable)
          .values([
            messageRow(seeded.sessionID, 2, "system", "2", now),
            messageRow(seeded.sessionID, 0, "system", "0", now),
            messageRow(seeded.sessionID, 1, "system", "1", now),
          ])
          .run()
          .pipe(Effect.orDie)

        expect((yield* SessionHistory.load(seeded.db, seeded.sessionID)).map(text)).toEqual(["0", "1", "2"])
      }),
    )
  })

  test("filters baseline system messages while preserving later messages", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const now = yield* DateTime.now
        yield* seeded.db
          .insert(SessionMessageTable)
          .values([
            messageRow(seeded.sessionID, 0, "system", "old", now),
            messageRow(seeded.sessionID, 1, "user", "user", now),
            messageRow(seeded.sessionID, 2, "system", "new", now),
          ])
          .run()
          .pipe(Effect.orDie)
        yield* seeded.db
          .insert(SessionContextEpochTable)
          .values({ session_id: seeded.sessionID, baseline: "baseline", snapshot: {}, baseline_seq: 0 })
          .run()
          .pipe(Effect.orDie)

        expect((yield* SessionHistory.load(seeded.db, seeded.sessionID)).map(text)).toEqual(["user", "new"])
      }),
    )
  })

  test("preserves post-baseline system deltas across a compaction boundary", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const now = yield* DateTime.now
        yield* seeded.db
          .insert(SessionMessageTable)
          .values([
            messageRow(seeded.sessionID, 0, "user", "old user", now),
            messageRow(seeded.sessionID, 2, "system", "context delta", now),
            messageRow(seeded.sessionID, 3, "user", "pre-compaction user", now),
            {
              id: SessionMessage.ID.create(),
              session_id: seeded.sessionID,
              type: "compaction",
              seq: 4,
              data: {
                reason: "auto",
                summary: "summary",
                recent: "recent",
                time: { created: DateTime.toEpochMillis(now) },
              } as typeof SessionMessageTable.$inferInsert.data,
            },
            messageRow(seeded.sessionID, 5, "user", "new user", now),
          ])
          .run()
          .pipe(Effect.orDie)
        yield* seeded.db
          .insert(SessionContextEpochTable)
          .values({ session_id: seeded.sessionID, baseline: "baseline", snapshot: {}, baseline_seq: 1 })
          .run()
          .pipe(Effect.orDie)

        const history = yield* SessionHistory.load(seeded.db, seeded.sessionID)
        expect(history.map((message) => message.type)).toEqual(["system", "compaction", "user"])
        expect(history.map(text)).toEqual(["context delta", undefined, "new user"])
      }),
    )
  })

  test("initializes lazily, reconciles unchanged state, and atomically advances snapshots", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const events = yield* EventV2.Service
        let value = "one"
        let loads = 0
        const context = Effect.sync(() => {
          loads++
          return SystemContext.make({
            key: SystemContext.Key.make("test/value"),
            codec: Schema.String,
            load: Effect.sync(() => value),
            baseline: (current) => `baseline:${current}`,
            update: (previous, current) => `updated:${previous}->${current}`,
          })
        })

        expect(yield* SessionContextEpoch.initialize(seeded.db, context, seeded.sessionID)).toEqual({
          baseline: "baseline:one",
          baselineSeq: -1,
        })
        expect(yield* SessionContextEpoch.initialize(seeded.db, context, seeded.sessionID)).toBeUndefined()
        expect(loads).toBe(1)

        yield* events.project(SessionEvent.ContextUpdated, (event) =>
          seeded.db
            .insert(SessionMessageTable)
            .values({
              id: event.data.messageID,
              session_id: event.data.sessionID,
              type: "system",
              seq: event.durable!.seq,
              data: {
                text: event.data.text,
                time: { created: DateTime.toEpochMillis(event.data.timestamp) },
              } as typeof SessionMessageTable.$inferInsert.data,
            })
            .run()
            .pipe(Effect.orDie),
        )

        expect(yield* SessionContextEpoch.prepare(seeded.db, events, context, seeded.sessionID)).toEqual({
          baseline: "baseline:one",
          baselineSeq: -1,
        })
        expect(yield* SessionHistory.load(seeded.db, seeded.sessionID)).toEqual([])

        value = "two"
        yield* SessionContextEpoch.prepare(seeded.db, events, context, seeded.sessionID)
        const epoch = yield* seeded.db.select().from(SessionContextEpochTable).get().pipe(Effect.orDie)
        expect(epoch?.snapshot).toEqual({ "test/value": { value: "two" } })
        expect((yield* SessionHistory.load(seeded.db, seeded.sessionID)).map(text)).toEqual(["updated:one->two"])

        value = "three"
        yield* SessionContextEpoch.prepare(seeded.db, events, context, seeded.sessionID)
        const updates = yield* seeded.db
          .select({ id: SessionMessageTable.id })
          .from(SessionMessageTable)
          .orderBy(SessionMessageTable.seq)
          .all()
          .pipe(Effect.orDie)
        expect(updates).toHaveLength(2)
        expect(new Set(updates.map((message) => message.id)).size).toBe(2)
        expect((yield* SessionHistory.load(seeded.db, seeded.sessionID)).map(text)).toEqual([
          "updated:one->two",
          "updated:two->three",
        ])
      }),
    )
  })

  test("blocks fresh initialization while a source is unavailable", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const context = SystemContext.make({
          key: SystemContext.Key.make("test/unavailable"),
          codec: Schema.toCodecJson(Schema.String),
          load: Effect.succeed(SystemContext.unavailable),
          baseline: (current) => current,
          update: (_, current) => current,
        })

        const exit = yield* SessionContextEpoch.initialize(seeded.db, Effect.succeed(context), seeded.sessionID).pipe(
          Effect.exit,
        )

        expect(exit._tag).toBe("Failure")
        expect(String(exit)).toContain("InitializationBlocked")
        expect(yield* seeded.db.select().from(SessionContextEpochTable).all().pipe(Effect.orDie)).toEqual([])
      }),
    )
  })

  test("fails closed when the persisted snapshot is corrupt", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        yield* seeded.db
          .insert(SessionContextEpochTable)
          .values({ session_id: seeded.sessionID, baseline: "baseline", snapshot: {}, baseline_seq: -1 })
          .run()
          .pipe(Effect.orDie)
        yield* seeded.db
          .run(sql`UPDATE session_context_epoch SET snapshot = ${"[]"} WHERE session_id = ${seeded.sessionID}`)
          .pipe(Effect.orDie)

        const exit = yield* SessionContextEpoch.prepare(
          seeded.db,
          yield* EventV2.Service,
          Effect.succeed(SystemContext.empty),
          seeded.sessionID,
        ).pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
        expect(String(exit)).toContain("ContextSnapshotDecodeError")
      }),
    )
  })

  test("replaces an incompatible generation without emitting a context delta", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const events = yield* EventV2.Service
        const stringContext = SystemContext.make({
          key: SystemContext.Key.make("test/value"),
          codec: Schema.toCodecJson(Schema.String),
          load: Effect.succeed("one"),
          baseline: (current) => `string:${current}`,
          update: (_, current) => current,
        })
        yield* SessionContextEpoch.initialize(seeded.db, Effect.succeed(stringContext), seeded.sessionID)
        const numberContext = SystemContext.make({
          key: SystemContext.Key.make("test/value"),
          codec: Schema.toCodecJson(Schema.Number),
          load: Effect.succeed(2),
          baseline: (current) => `number:${current}`,
          update: (_, current) => current.toString(),
        })

        expect(
          yield* SessionContextEpoch.prepare(seeded.db, events, Effect.succeed(numberContext), seeded.sessionID),
        ).toEqual({ baseline: "number:2", baselineSeq: -1 })
        expect(yield* seeded.db.select().from(SessionMessageTable).all().pipe(Effect.orDie)).toEqual([])
        expect((yield* seeded.db.select().from(SessionContextEpochTable).get().pipe(Effect.orDie))?.snapshot).toEqual({
          "test/value": { value: 2 },
        })
      }),
    )
  })

  test("rolls back the projected context message and snapshot together", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const events = yield* EventV2.Service
        let value = "one"
        const context = Effect.succeed(
          SystemContext.make({
            key: SystemContext.Key.make("test/value"),
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.sync(() => value),
            baseline: (current) => current,
            update: (previous, current) => `${previous}->${current}`,
          }),
        )
        yield* SessionContextEpoch.initialize(seeded.db, context, seeded.sessionID)
        yield* events.project(SessionEvent.ContextUpdated, (event) =>
          Effect.gen(function* () {
            yield* seeded.db
              .insert(SessionMessageTable)
              .values({
                id: event.data.messageID,
                session_id: event.data.sessionID,
                type: "system",
                seq: event.durable!.seq,
                data: {
                  text: event.data.text,
                  time: { created: DateTime.toEpochMillis(event.data.timestamp) },
                } as typeof SessionMessageTable.$inferInsert.data,
              })
              .run()
              .pipe(Effect.orDie)
            yield* seeded.db
              .delete(SessionContextEpochTable)
              .where(eq(SessionContextEpochTable.session_id, seeded.sessionID))
              .run()
              .pipe(Effect.orDie)
          }),
        )
        value = "two"

        const exit = yield* SessionContextEpoch.prepare(seeded.db, events, context, seeded.sessionID).pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
        expect((yield* seeded.db.select().from(SessionContextEpochTable).get().pipe(Effect.orDie))?.snapshot).toEqual({
          "test/value": { value: "one" },
        })
        expect(yield* seeded.db.select().from(SessionMessageTable).all().pipe(Effect.orDie)).toEqual([])
        expect(yield* seeded.db.select().from(EventTable).all().pipe(Effect.orDie)).toEqual([])
        expect(yield* seeded.db.select().from(EventSequenceTable).all().pipe(Effect.orDie)).toEqual([])
      }),
    )
  })

  test("promotes the oldest pending input through a durable event", async () => {
    await run(
      Effect.gen(function* () {
        const seeded = yield* seed()
        const events = yield* EventV2.Service
        yield* events.project(SessionEvent.PromptAdmitted, (event) =>
          SessionInput.projectAdmitted(seeded.db, {
            admittedSeq: event.durable!.seq,
            id: event.data.messageID,
            sessionID: event.data.sessionID,
            prompt: event.data.prompt,
            delivery: event.data.delivery,
            timeCreated: event.data.timestamp,
          }),
        )
        yield* events.project(SessionEvent.Prompted, (event) =>
          SessionInput.projectPrompted(seeded.db, {
            id: event.data.messageID,
            sessionID: event.data.sessionID,
            prompt: event.data.prompt,
            delivery: event.data.delivery,
            timeCreated: event.data.timestamp,
            promotedSeq: event.durable!.seq,
          }),
        )

        const first = yield* SessionInput.admit(seeded.db, events, {
          id: SessionMessage.ID.create(),
          sessionID: seeded.sessionID,
          prompt: { text: "first" },
          delivery: "queue",
        })
        const second = yield* SessionInput.admit(seeded.db, events, {
          id: SessionMessage.ID.create(),
          sessionID: seeded.sessionID,
          prompt: { text: "second" },
          delivery: "queue",
        })

        expect(yield* SessionInput.promoteNextQueued(seeded.db, events, seeded.sessionID)).toBe(true)
        expect((yield* SessionInput.find(seeded.db, first.id))?.promotedSeq).toBe(2)
        expect((yield* SessionInput.find(seeded.db, second.id))?.promotedSeq).toBeUndefined()
        expect(yield* SessionInput.hasPending(seeded.db, seeded.sessionID, "queue")).toBe(true)
        expect((yield* seeded.db.select().from(SessionInputTable).all()).map((row) => row.admitted_seq)).toEqual([0, 1])
      }),
    )
  })
})
