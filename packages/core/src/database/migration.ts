export * as DatabaseMigration from "./migration"

import { sql, type SQLWrapper } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type EffectDatabase = EffectDrizzleSqlite.EffectSQLiteDatabase
type Query = string | SQLWrapper
type MigrationEffect<A> = Effect.Effect<A, unknown, never>
export type Transaction = {
  run: (query: Query) => MigrationEffect<unknown>
  all: <A = unknown>(query: Query) => MigrationEffect<A[]>
  get: <A = unknown>(query: Query) => MigrationEffect<A | undefined>
}
type SyncDatabase = {
  run: (query: Query) => unknown
  all: <A = unknown>(query: Query) => A[]
  get: <A = unknown>(query: Query) => A | undefined
}
type Database = EffectDatabase | SyncDatabase
type Target = {
  run: (query: Query) => MigrationEffect<unknown>
  all: <A = unknown>(query: Query) => MigrationEffect<A[]>
  get: <A = unknown>(query: Query) => MigrationEffect<A | undefined>
  transaction: <A>(body: (tx: Transaction) => MigrationEffect<A>) => MigrationEffect<A>
}
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => MigrationEffect<void>
}

export function apply(db: EffectDatabase): MigrationEffect<void>
export function apply(db: SyncDatabase): MigrationEffect<void>
export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const target = normalize(db)
      const tables = yield* target.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      if (tables.some((table) => table.name === "session")) return yield* applyOnlyImpl(target, migrations)
      if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")
      yield* target.transaction((tx) =>
        Effect.gen(function* () {
          yield* schema.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
        }),
      )
    }),
  )
}

export function applyThrough(db: EffectDatabase, id: string): MigrationEffect<void>
export function applyThrough(db: SyncDatabase, id: string): MigrationEffect<void>
export function applyThrough(db: Database, id: string) {
  return lock.withPermit(
    applyOnlyImpl(
      normalize(db),
      migrations.filter((migration) => migration.id <= id),
    ),
  )
}

export function applyOnly(db: EffectDatabase, input: Migration[]): MigrationEffect<void>
export function applyOnly(db: SyncDatabase, input: Migration[]): MigrationEffect<void>
export function applyOnly(db: Database, input: Migration[]) {
  return applyOnlyImpl(normalize(db), input)
}

function applyOnlyImpl(target: Target, input: Migration[]) {
  return Effect.gen(function* () {
    yield* target.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* target.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* target.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        yield* target.run(sql`
          INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
          SELECT name, ${Date.now()}
          FROM ${sql.identifier("__drizzle_migrations")}
          WHERE name IS NOT NULL
        `)
        completed = new Set(
          (yield* target.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* target.transaction((tx) =>
        Effect.gen(function* () {
          yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
    }
  })
}

function normalize(db: Database): Target {
  if (Effect.isEffect((db as EffectDatabase).run("SELECT 1"))) return normalizeEffect(db as EffectDatabase)

  const sync = db as SyncDatabase
  const tx: Transaction = {
    run: (query) => Effect.try({ try: () => sync.run(query), catch: (cause) => cause }),
    all: (query) => Effect.try({ try: () => sync.all(query), catch: (cause) => cause }),
    get: (query) => Effect.try({ try: () => sync.get(query), catch: (cause) => cause }),
  }
  return {
    run: tx.run,
    all: tx.all,
    get: tx.get,
    transaction: (body) =>
      Effect.gen(function* () {
        yield* tx.run("BEGIN")
        const result = yield* body(tx).pipe(
          Effect.catch((cause) => tx.run("ROLLBACK").pipe(Effect.andThen(Effect.fail(cause)))),
        )
        yield* tx.run("COMMIT")
        return result
      }),
  }
}

function normalizeEffect(db: EffectDatabase): Target {
  const transaction = (tx: Parameters<Parameters<EffectDatabase["transaction"]>[0]>[0]): Transaction => ({
    run: (query) => tx.run(query).pipe(Effect.asVoid),
    all: (query) => tx.all(query),
    get: (query) => tx.get(query),
  })
  return {
    run: (query) => db.run(query).pipe(Effect.asVoid),
    all: (query) => db.all(query) as unknown as MigrationEffect<unknown[]>,
    get: (query) => db.get(query) as unknown as MigrationEffect<unknown>,
    transaction: (body) => db.transaction((tx) => body(transaction(tx))),
  } as Target
}
