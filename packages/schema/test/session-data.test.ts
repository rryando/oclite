import { expect, test } from "bun:test"
import { PermissionV1 } from "../src/v1/permission"
import { SessionInput } from "../src/session-input"
import { SessionMessage } from "../src/session-message"
import { SessionTodo } from "../src/session-todo"
import { SessionID } from "../src/session-id"
import { Workspace } from "../src/workspace"
import { DateTime, Schema } from "effect"

test("session input round trips through its shared schema", () => {
  const value = SessionInput.Admitted.make({
    admittedSeq: 2,
    id: SessionMessage.ID.create(),
    sessionID: SessionID.create(),
    prompt: { text: "hello" },
    delivery: "queue",
    timeCreated: DateTime.makeUnsafe(42),
  })

  expect(Schema.decodeUnknownSync(SessionInput.Admitted)(Schema.encodeSync(SessionInput.Admitted)(value))).toEqual(
    value,
  )
})

test("workspace, todo, and permission compatibility schemas are exported", () => {
  expect(String(Workspace.ID.make("wrk_test"))).toBe("wrk_test")
  expect(SessionTodo.Info.make({ content: "ship", status: "pending", priority: "high" })).toEqual({
    content: "ship",
    status: "pending",
    priority: "high",
  })
  expect(PermissionV1.Ruleset.make([{ permission: "read", pattern: "*", action: "allow" }])).toHaveLength(1)
})
