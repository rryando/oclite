import { Context, Schema } from "effect"
import { LayerNode } from "./effect/layer-node"
import { tags } from "./effect/app-node"

export * as Location from "./location"

export const Ref = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  project: Schema.optional(Schema.Struct({ id: Schema.String, directory: Schema.String })),
}).annotate({ identifier: "Location.Ref" })
export type Ref = typeof Ref.Type

export class Service extends Context.Service<Service, Ref>()("@opencode/Location") {}

export const node = LayerNode.unbound(Service, tags.values.location)
