import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocalContext } from "@/util/local-context"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { EffectBridge } from "@/effect/bridge"
import { init } from "#db"
import { Effect } from "effect"

export { NotFoundError } from "./storage"

const log = Log.create({ service: "db" })

type DatabaseFlags = Pick<RuntimeFlags.Info, "disableChannelDb" | "skipMigrations">

const readRuntimeFlags = () =>
  Effect.runSync(RuntimeFlags.Service.useSync((flags) => flags).pipe(Effect.provide(RuntimeFlags.defaultLayer)))

export function getChannelPath(flags: Pick<DatabaseFlags, "disableChannelDb"> = readRuntimeFlags()) {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || flags.disableChannelDb)
    return path.join(Global.Path.data, "oclite.db")
  return path.join(Global.Path.data, `oclite-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const getPath = (flags?: Pick<DatabaseFlags, "disableChannelDb">) => {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return getChannelPath(flags)
}

export type Transaction = SQLiteTransaction<"sync", void>
type Client = ReturnType<typeof init>

let client: Client | undefined

export const Client = Object.assign(
  (flags: DatabaseFlags = readRuntimeFlags()): Client => {
    if (client) return client
    const dbPath = getPath(flags)
    log.info("opening database", { path: dbPath })
    const db = init(dbPath)
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")
    if (!flags.skipMigrations) Effect.runSync(DatabaseMigration.apply(db))
    client = db
    return db
  },
  {
    reset: () => {
      client = undefined
    },
    loaded: () => client !== undefined,
  },
)

export function close() {
  if (!client) return
  client.$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (error) {
    if (!(error instanceof LocalContext.NotFound)) throw error
    const effects: (() => void | Promise<void>)[] = []
    const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
    effects.forEach((effect) => effect())
    return result
  }
}

export function effect(fn: () => void | Promise<void>) {
  const bound = EffectBridge.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    void bound()
  }
}

type NotPromise<T> = T extends Promise<unknown> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: { behavior?: "deferred" | "immediate" | "exclusive" },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (error) {
    if (!(error instanceof LocalContext.NotFound)) throw error
    const effects: (() => void | Promise<void>)[] = []
    const current = Client()
    const run = current.transaction.bind(current) as unknown as (
      callback: (tx: TxOrDb) => NotPromise<T>,
      options?: { behavior?: "deferred" | "immediate" | "exclusive" },
    ) => NotPromise<T>
    const result = run(
      EffectBridge.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx))),
      { behavior: options?.behavior },
    )
    effects.forEach((effect) => effect())
    return result
  }
}

export * as Database from "./database"
