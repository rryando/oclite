export * as SessionSchema from "./schema"

import { Schema } from "effect"
import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  ...Session.Info.fields,
  originSessionID: ID.pipe(Schema.optional),
}).annotate({ identifier: "SessionV2.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
