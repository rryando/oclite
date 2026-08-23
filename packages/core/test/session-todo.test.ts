import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { Effect, Layer } from "effect"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

const sessionID = SessionSchema.ID.make("ses_todo_test")

describe("SessionTodo", () => {
  test("replaces persisted todos in order and publishes updates", async () => {
    await using directory = await tmpdir()
    const database = Database.layerFromPath(path.join(directory.path, "session.sqlite"))
    const events = EventV2.layerWith().pipe(Layer.provide(database))
    const todos = SessionTodo.layer.pipe(Layer.provide(Layer.merge(database, events)))

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const eventService = yield* EventV2.Service
        const todoService = yield* SessionTodo.Service
        const published: unknown[] = []
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
            slug: "todo",
            directory: "/project",
            title: "todo",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        const unsubscribe = yield* eventService.listen((event) =>
          event.type === SessionTodo.Event.Updated.type ? Effect.sync(() => published.push(event.data)) : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        yield* todoService.update({
          sessionID,
          todos: [
            { content: "second", status: "pending", priority: "low" },
            { content: "first", status: "in_progress", priority: "high" },
          ],
        })
        expect(yield* todoService.get(sessionID)).toEqual([
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
        ])
        expect((yield* db.select().from(TodoTable).all().pipe(Effect.orDie)).map((row) => row.position)).toEqual([0, 1])

        yield* todoService.update({ sessionID, todos: [] })
        expect(yield* todoService.get(sessionID)).toEqual([])
        expect(published).toHaveLength(2)
      }).pipe(Effect.provide(Layer.mergeAll(database, events, todos)), Effect.scoped),
    )
  })
})
