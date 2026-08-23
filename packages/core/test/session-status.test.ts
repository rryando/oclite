import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionStatus } from "@opencode-ai/core/session/status"
import { it } from "./lib/effect"

describe("SessionStatus", () => {
  const published: string[] = []
  const events = EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push(`${definition.type}:${JSON.stringify(data)}`)
        return { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
      }),
    publishEvent: (event) => Effect.succeed(event),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    sync: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })

  it.effect("publishes busy, retry, and idle transitions", () =>
    Effect.gen(function* () {
      published.length = 0
      const status = yield* SessionStatus.Service
      const sessionID = SessionV2.ID.make("ses_status")
      yield* status.set(sessionID, { type: "busy" })
      yield* status.set(sessionID, { type: "retry", attempt: 1, message: "busy", next: 123 })
      expect((yield* status.get(sessionID)).type).toBe("retry")
      yield* status.set(sessionID, { type: "idle" })
      expect((yield* status.get(sessionID)).type).toBe("idle")
      expect(published.map((entry) => entry.split(":")[0])).toEqual([
        "session.status",
        "session.status",
        "session.status",
        "session.idle",
      ])
    }).pipe(Effect.provide(SessionStatus.layer), Effect.provide(Layer.succeed(EventV2.Service, events))),
  )
})
