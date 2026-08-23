import { expect, test } from "bun:test"
import { Schema } from "effect"
import { DurableEventManifest } from "../src/durable-event-manifest"
import { PromptInput } from "../src/prompt-input"
import { Revert } from "../src/revert"
import { Session } from "../src/session"
import { ListAnchor } from "../src/session-list-anchor"
import { SessionMessage } from "../src/session-message"

test("session prerequisite modules compose", () => {
  const sessionID = Session.ID.create()
  const messageID = SessionMessage.ID.create()

  expect(Session.ListAnchor).toBe(ListAnchor)
  expect(Schema.decodeUnknownSync(PromptInput.Prompt)({ text: "hello" })).toEqual({ text: "hello" })
  expect(Schema.decodeUnknownSync(Revert.State)({ messageID })).toEqual({ messageID })
  expect(Schema.decodeUnknownSync(ListAnchor)({ id: sessionID, time: 1, direction: "next" })).toEqual({
    id: sessionID,
    time: 1,
    direction: "next",
  })
  expect(DurableEventManifest.SessionDurable.definitions.size).toBeGreaterThan(0)
})
