import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@/storage/db"
import { Database as Adapter } from "@/storage/database"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { it } from "../lib/effect"

describe("Database.getChannelPath", () => {
  it.effect("returns database path for the current channel", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service
      const expected = ["latest", "beta", "prod"].includes(InstallationChannel)
        ? path.join(Global.Path.data, "oclite.db")
        : path.join(Global.Path.data, `oclite-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)

      expect(Database.getChannelPath(flags)).toBe(expected)
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("uses the shared database path when channel databases are disabled", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(Global.Path.data, "oclite.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true }))),
  )

  it.effect("accepts RuntimeFlags with skipMigrations for database callers", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(flags.skipMigrations).toBe(true)
      expect(Database.getChannelPath(flags)).toBe(Database.getChannelPath({ disableChannelDb: flags.disableChannelDb }))
    }).pipe(Effect.provide(RuntimeFlags.layer({ skipMigrations: true }))),
  )
})

describe("database compatibility adapter", () => {
  test("applies the complete Core migration set", () => {
    Adapter.close()

    expect(Adapter.use((db) => db.get<{ count: number }>("SELECT count(*) AS count FROM migration"))).toEqual({
      count: migrations.length,
    })
    expect(
      Adapter.use((db) =>
        db.get<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_context_epoch'",
        ),
      ),
    ).toEqual({ name: "session_context_epoch" })
  })

  test("discards post-commit callbacks when a transaction rolls back", () => {
    Adapter.close()
    Adapter.use((db) => db.run("CREATE TABLE rollback_probe (value text NOT NULL)"))
    let published = false

    expect(() =>
      Adapter.transaction((db) => {
        db.run("INSERT INTO rollback_probe (value) VALUES ('rolled back')")
        Adapter.effect(() => {
          published = true
        })
        throw new Error("rollback")
      }),
    ).toThrow("rollback")

    expect(Adapter.use((db) => db.all("SELECT value FROM rollback_probe"))).toEqual([])
    expect(published).toBe(false)
  })

  test("runs post-commit callbacks after committed rows are visible", () => {
    Adapter.close()
    Adapter.use((db) => db.run("CREATE TABLE commit_probe (value text NOT NULL)"))
    let rows: { value: string }[] = []

    Adapter.transaction((db) => {
      db.run("INSERT INTO commit_probe (value) VALUES ('committed')")
      Adapter.effect(() => {
        rows = Adapter.use((current) => current.all("SELECT value FROM commit_probe")) as { value: string }[]
      })
    })

    expect(rows).toEqual([{ value: "committed" }])
  })
})
