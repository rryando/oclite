import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { NodeSqliteClient } from "../src/index.ts"

test("executes queries and rolls back transactions", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* SqlClient
      yield* db.unsafe("CREATE TABLE item (id integer PRIMARY KEY, name text NOT NULL)")
      yield* db
        .withTransaction(
          db.unsafe("INSERT INTO item (id, name) VALUES (1, 'rolled back')").pipe(Effect.andThen(Effect.fail("boom"))),
        )
        .pipe(Effect.ignore)

      assert.deepEqual(yield* db.unsafe("SELECT * FROM item"), [])
      yield* db.unsafe("INSERT INTO item (id, name) VALUES (2, 'kept')")
      const rows = yield* db.unsafe<{ id: number; name: string }>("SELECT id, name FROM item")
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.id, 2)
      assert.equal(rows[0]?.name, "kept")
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
