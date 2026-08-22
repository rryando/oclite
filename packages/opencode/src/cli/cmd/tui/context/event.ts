import type { Event } from "@opencode-ai/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

// Session ids of cross-project spawned sessions linked to this process. Their lifecycle events
// carry an originSessionID, but their follow-on events do NOT — those only carry a sessionID. We
// learn the linked ids from the lifecycle events (which arrive first) so we can also admit the
// matching session events past the project filter. Module-level because useEvent()
// returns fresh closures per consumer; every subscription shares the same linked set.
const linkedSessions = new Set<string>()

// Seed a linked session id discovered outside the live event stream (e.g. the bootstrap linked-scope
// query), so its events are admitted even if no live lifecycle event arrived first.
export function registerLinkedSession(sessionID: string) {
  linkedSessions.add(sessionID)
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      if (event.directory === "global" || event.project === project.project()) {
        handler(event.payload, { directory: event.directory, workspace: event.workspace })
        return
      }

      // Cross-project spawned sessions publish their events tagged with the TARGET project (not this
      // TUI's), so the project filter above drops them. Admit the ones that belong to a linked
      // session so the spawned tab gets its metadata, transcript stream, and status.
      const payload = event.payload
      if (
        (payload.type === "session.created" ||
          payload.type === "session.updated" ||
          payload.type === "session.deleted") &&
        payload.properties.info.originSessionID
      ) {
        if (payload.type === "session.deleted") linkedSessions.delete(payload.properties.info.id)
        else linkedSessions.add(payload.properties.info.id)
        handler(payload, { directory: event.directory, workspace: event.workspace })
        return
      }

      // Interactive, state, message, status, and sync-v2 transcript events carry only a sessionID;
      // forward them when that session is linked. (session.next.context.updated is tagged with the
      // TARGET project, so it hits the project filter above just like message/status events.)
      if (
        (payload.type === "message.updated" ||
          payload.type === "message.removed" ||
          payload.type === "message.part.updated" ||
          payload.type === "message.part.delta" ||
          payload.type === "message.part.removed" ||
          payload.type === "permission.asked" ||
          payload.type === "permission.replied" ||
          payload.type === "question.asked" ||
          payload.type === "question.replied" ||
          payload.type === "question.rejected" ||
          payload.type === "todo.updated" ||
          payload.type === "session.diff" ||
          payload.type === "session.status" ||
          payload.type === "session.next.context.updated") &&
        linkedSessions.has(payload.properties.sessionID)
      ) {
        handler(payload, { directory: event.directory, workspace: event.workspace })
      }
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
