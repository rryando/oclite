export * as Snapshot from "./snapshot"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "./effect/app-node"
import { RelativePath } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("Snapshot.ID"))
export type ID = typeof ID.Type

export class Error extends Schema.TaggedErrorClass<Error>()("Snapshot.Error", {
  operation: Schema.Literals(["capture", "files"]),
  message: Schema.String,
}) {}

export interface Interface {
  readonly capture: () => Effect.Effect<ID | undefined>
  readonly files: (input: { readonly from: ID; readonly to: ID }) => Effect.Effect<readonly RelativePath[], Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Snapshot") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    capture: () => Effect.succeed(undefined),
    files: () => Effect.fail(new Error({ operation: "files", message: "Snapshots are not available" })),
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })

/** Legacy persisted session diff shape retained for database compatibility. */
export type LegacyFileDiff = {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}
