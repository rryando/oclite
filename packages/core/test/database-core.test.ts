import { expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { Database as BunDatabase } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

test("keeps migrations unique and ordered", () => {
  const ids = migrations.map((migration) => migration.id)
  expect(ids).toEqual([...ids].sort())
  expect(new Set(ids).size).toBe(ids.length)
})

test("creates the complete schema idempotently", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.apply(db)

      expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)).toEqual({
        name: "session",
      })
      expect(
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'data_migration'`),
      ).toEqual({ name: "data_migration" })
      expect(yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM migration`)).toEqual({
        count: migrations.length,
      })
    }),
  )
})

test("applies every migration in order to a temporary database", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.applyOnly(db, migrations)

      expect(yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM migration`)).toEqual({
        count: migrations.length,
      })
      expect(
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_input'`),
      ).toEqual({ name: "session_input" })
    }),
  )
})

test("rolls back a failed migration and its journal entry", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.applyOnly(db, [
        {
          id: "failed",
          up: (tx) => tx.run(sql`CREATE TABLE should_rollback (id integer)`).pipe(Effect.andThen(Effect.fail("stop"))),
        },
      ]).pipe(Effect.catch(() => Effect.void))

      expect(
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'`),
      ).toBeUndefined()
      expect(yield* db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({ count: 0 })
    }),
  )
})

test("instantiates the Core Bun adapter in a temporary database", async () => {
  await using directory = await import("./fixture/tmpdir").then((module) => module.tmpdir())
  const filename = `${directory.path}/core.sqlite`

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const database = yield* Database.Service
        expect(yield* database.db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({
          count: migrations.length,
        })
      }).pipe(Effect.provide(Database.layerFromPath(filename))),
    ),
  )

  await Effect.runPromise(Database.Service.pipe(Effect.provide(Database.layerFromPath(filename)), Effect.scoped))
})

test("migrates synchronous compatibility clients transactionally", async () => {
  await using directory = await import("./fixture/tmpdir").then((module) => module.tmpdir())
  const native = new BunDatabase(`${directory.path}/sync.sqlite`)
  const db = drizzle({ client: native })

  try {
    await Effect.runPromise(
      DatabaseMigration.applyOnly(db, [
        {
          id: "sync_failure",
          up: (tx) => tx.run(sql`CREATE TABLE should_rollback (id integer)`).pipe(Effect.andThen(Effect.fail("stop"))),
        },
      ]).pipe(Effect.catch(() => Effect.void)),
    )

    expect(
      db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'`),
    ).toBeUndefined()
    expect(db.all(sql`SELECT id FROM migration`)).toEqual([])
  } finally {
    native.close()
  }
})

test("can stop synchronous migrations at a compatibility boundary", async () => {
  await using directory = await import("./fixture/tmpdir").then((module) => module.tmpdir())
  const native = new BunDatabase(`${directory.path}/compatibility.sqlite`)
  const db = drizzle({ client: native })

  try {
    await Effect.runPromise(DatabaseMigration.applyThrough(db, "20260602182828_add_project_directories"))

    expect(db.get<{ id: string }>(sql`SELECT id FROM migration ORDER BY id DESC LIMIT 1`)).toEqual({
      id: "20260602182828_add_project_directories",
    })
  } finally {
    native.close()
  }
})
