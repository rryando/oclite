import { describe, expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const cutoff = "20260530104205_add_origin_session_id"

describe("legacy database compatibility", () => {
  test("preserves fork rows while migrating the pre-cutover schema", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* DatabaseMigration.applyOnly(
          db,
          migrations.filter((migration) => migration.id <= cutoff),
        )
        yield* insertLegacyFixture(db)

        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])

        yield* DatabaseMigration.applyOnly(
          db,
          migrations.filter(
            (migration) => migration.id > cutoff && migration.id <= "20260603160727_jittery_ezekiel_stane",
          ),
        )
        yield* insertPreResetV2Fixture(db)
        yield* DatabaseMigration.applyOnly(
          db,
          migrations.filter(
            (migration) =>
              migration.id > "20260603160727_jittery_ezekiel_stane" &&
              migration.id <= "20260622142730_simplify_session_context_epoch",
          ),
        )
        yield* db.run(sql`
          INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq)
          VALUES ('ses_origin', 'baseline', '{}', 7)
        `)
        yield* DatabaseMigration.applyOnly(db, migrations)
        yield* DatabaseMigration.applyOnly(db, migrations)

        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
        expect(yield* db.all(sql`SELECT id, origin_session_id, workspace_id FROM session ORDER BY id`)).toEqual([
          { id: "ses_linked", origin_session_id: "ses_origin", workspace_id: "wrk_linked" },
          { id: "ses_origin", origin_session_id: null, workspace_id: "wrk_origin" },
        ])
        expect(
          yield* db.all(sql`
            SELECT linked.id
            FROM session AS linked
            WHERE linked.origin_session_id IN (
              SELECT origin.id FROM session AS origin WHERE origin.project_id = 'prj_origin'
            )
          `),
        ).toEqual([{ id: "ses_linked" }])
        expect(yield* db.all(sql`SELECT id FROM workspace ORDER BY id`)).toEqual([
          { id: "wrk_linked" },
          { id: "wrk_origin" },
        ])
        expect(yield* db.all(sql`SELECT id, worktree FROM project ORDER BY id`)).toEqual([
          { id: "prj_linked", worktree: "/linked" },
          { id: "prj_origin", worktree: "/origin" },
        ])
        expect(yield* db.all(sql`SELECT id, data FROM message`)).toEqual([
          { id: "msg_legacy", data: '{"role":"user"}' },
        ])
        expect(yield* db.all(sql`SELECT id, data FROM part`)).toEqual([
          { id: "prt_legacy", data: '{"type":"text","text":"keep me"}' },
        ])
        expect(yield* db.all(sql`SELECT aggregate_id, seq FROM event_sequence`)).toEqual([
          { aggregate_id: "ses_origin", seq: 7 },
        ])
        expect(yield* db.all(sql`SELECT id, seq, data FROM event`)).toEqual([
          { id: "evt_keep", seq: 7, data: '{"value":"keep me"}' },
        ])
        expect(yield* db.all(sql`SELECT id, seq, data FROM session_message`)).toEqual([
          { id: "smsg_keep", seq: 7, data: '{"content":"keep me"}' },
        ])
        expect(yield* db.all(sql`SELECT id, admitted_seq, prompt FROM session_input`)).toEqual([
          { id: "input_keep", admitted_seq: 8, prompt: '[{"type":"text","text":"keep me"}]' },
        ])
        expect(yield* db.all(sql`SELECT session_id, baseline_seq FROM session_context_epoch`)).toEqual([
          { session_id: "ses_origin", baseline_seq: 7 },
        ])
        const permissions = yield* db.all(
          sql`SELECT id, project_id AS projectID, action, resource FROM permission ORDER BY resource`,
        )
        expect(
          permissions.map((permission) => Schema.decodeUnknownSync(PermissionSaved.Info)(permission)),
        ).toMatchObject([
          { projectID: "prj_origin", action: "read", resource: "*" },
          { projectID: "prj_origin", action: "bash", resource: "git status" },
        ])
        expect(yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM migration`)).toEqual({
          count: migrations.length,
        })
      }),
    )
  })

  test("rolls back retained data and journal state when a migration fails", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.run(sql`CREATE TABLE event (id text PRIMARY KEY, data text NOT NULL)`)
        yield* db.run(sql`INSERT INTO event (id, data) VALUES ('evt_keep', 'keep me')`)

        yield* DatabaseMigration.applyOnly(db, [
          {
            id: "injected_failure",
            up: (tx) => tx.run(sql`DELETE FROM event`).pipe(Effect.andThen(Effect.fail("injected"))),
          },
        ]).pipe(Effect.catch(() => Effect.void))

        expect(yield* db.all(sql`SELECT id, data FROM event`)).toEqual([{ id: "evt_keep", data: "keep me" }])
        expect(yield* db.all(sql`SELECT id FROM migration`)).toEqual([])
      }),
    )
  })

  test("decodes origin links through the Core session schema", async () => {
    const info = await Effect.runPromise(
      Schema.decodeUnknownEffect(SessionSchema.Info)({
        id: "ses_linked",
        originSessionID: "ses_origin",
        projectID: "prj_linked",
        title: "Linked",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        location: { directory: "/linked" },
        time: { created: 1, updated: 1 },
      }),
    )

    expect(String(info.originSessionID)).toBe("ses_origin")
  })

  test("projects origin links from the durable session contract", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* DatabaseMigration.apply(db)
        yield* db.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('prj_linked', '/linked', 1, 1, '[]')
        `)
        const database = Layer.succeed(Database.Service, { db })

        yield* EventV2.Service.use((events) =>
          events.publish(SessionV1.Event.Created, {
            sessionID: SessionSchema.ID.make("ses_linked"),
            info: {
              id: SessionSchema.ID.make("ses_linked"),
              originSessionID: SessionSchema.ID.make("ses_origin"),
              slug: "linked",
              projectID: ProjectV2.ID.make("prj_linked"),
              directory: "/linked",
              title: "Linked",
              version: "test",
              time: { created: 1, updated: 1 },
            },
          }),
        ).pipe(
          Effect.provide(
            LayerNode.compile(LayerNode.group([EventV2.node, SessionProjector.node]), [[Database.node, database]]),
          ),
        )

        expect(yield* db.get(sql`SELECT origin_session_id FROM session WHERE id = 'ses_linked'`)).toEqual({
          origin_session_id: "ses_origin",
        })
      }),
    )
  })
})

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

function insertLegacyFixture(db: Db) {
  return Effect.gen(function* () {
    yield* db.run(sql`
      INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
      VALUES
        ('prj_origin', '/origin', 1, 1, '[]'),
        ('prj_linked', '/linked', 1, 1, '[]')
    `)
    yield* db.run(sql`
      INSERT INTO workspace (id, type, name, directory, project_id, time_used)
      VALUES
        ('wrk_origin', 'local', 'Origin', '/origin', 'prj_origin', 1),
        ('wrk_linked', 'local', 'Linked', '/linked', 'prj_linked', 1)
    `)
    yield* db.run(sql`
      INSERT INTO session (
        id, project_id, workspace_id, origin_session_id, slug, directory, title, version, time_created, time_updated
      ) VALUES
        ('ses_origin', 'prj_origin', 'wrk_origin', NULL, 'origin', '/origin', 'Origin', 'test', 1, 1),
        ('ses_linked', 'prj_linked', 'wrk_linked', 'ses_origin', 'linked', '/linked', 'Linked', 'test', 1, 1)
    `)
    yield* db.run(sql`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES ('msg_legacy', 'ses_origin', 1, 1, '{"role":"user"}')
    `)
    yield* db.run(sql`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES ('prt_legacy', 'msg_legacy', 'ses_origin', 1, 1, '{"type":"text","text":"keep me"}')
    `)
    yield* db.run(sql`
      INSERT INTO permission (project_id, time_created, time_updated, data)
      VALUES (
        'prj_origin',
        1,
        1,
        '[{"permission":"read","pattern":"*","action":"allow"},{"permission":"bash","pattern":"git status","action":"allow"}]'
      )
    `)
  })
}

function insertPreResetV2Fixture(db: Db) {
  return Effect.gen(function* () {
    yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_origin', 7)`)
    yield* db.run(sql`
      INSERT INTO event (id, aggregate_id, seq, type, data)
      VALUES ('evt_keep', 'ses_origin', 7, 'session.updated.1', '{"value":"keep me"}')
    `)
    yield* db.run(sql`
      INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
      VALUES ('smsg_keep', 'ses_origin', 'user', 7, 1, 1, '{"content":"keep me"}')
    `)
    yield* db.run(sql`
      INSERT INTO session_input (seq, id, session_id, prompt, delivery, time_created)
      VALUES (8, 'input_keep', 'ses_origin', '[{"type":"text","text":"keep me"}]', 'steer', 1)
    `)
  })
}
