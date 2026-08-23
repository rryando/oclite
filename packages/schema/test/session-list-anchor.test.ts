import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Session } from "../src/session"
import { ListAnchor } from "../src/session-list-anchor"

test("session list anchor is available as a focused entrypoint", () => {
  const id = Session.ID.create()
  expect(
    Schema.decodeUnknownSync(ListAnchor)({
      id,
      time: 1,
      direction: "next",
    }),
  ).toEqual({ id, time: 1, direction: "next" })
})
