export * as SessionStatus from "./status"

import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { Context, Effect, Layer } from "effect"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionSchema } from "./schema"

export type Info = typeof SessionStatusEvent.Info.Type

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<ReadonlyMap<SessionSchema.ID, Info>>
  readonly set: (sessionID: SessionSchema.ID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const statuses = new Map<SessionSchema.ID, Info>()
    return Service.of({
      get: (sessionID) => Effect.succeed(statuses.get(sessionID) ?? { type: "idle" }),
      list: () => Effect.succeed(new Map(statuses)),
      set: Effect.fn("SessionStatus.set")(function* (sessionID, status) {
        yield* events.publish(SessionStatusEvent.Status, { sessionID, status })
        if (status.type !== "idle") {
          statuses.set(sessionID, status)
          return
        }
        statuses.delete(sessionID)
        yield* events.publish(SessionStatusEvent.Idle, { sessionID })
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer))
export const node = makeGlobalNode({ service: Service, layer, deps: [EventV2.node] })
