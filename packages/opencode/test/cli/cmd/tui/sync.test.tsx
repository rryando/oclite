/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

function event(payload: GlobalEvent["payload"], project = "proj_test"): GlobalEvent {
  return {
    directory: project === "proj_test" ? "/tmp/opencode/packages/opencode" : "/tmp/linked",
    project,
    workspace: project === "proj_test" ? undefined : "ws_linked",
    payload,
  }
}

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("live messages use creation time with an ID tie-break", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount()
    const sessionID = "ses_order"
    const messages = [
      { id: "msg_a", created: 30 },
      { id: "msg_z", created: 10 },
      { id: "msg_m", created: 20 },
      { id: "msg_b", created: 20 },
    ]

    try {
      for (const message of messages) {
        emit(
          event({
            id: `evt_${message.id}`,
            type: "message.updated",
            properties: {
              sessionID,
              info: {
                id: message.id,
                sessionID,
                role: "user",
                time: { created: message.created },
                agent: "build",
                model: { providerID: "test", modelID: "test" },
              },
            },
          }),
        )
      }
      await wait(() => sync.data.message[sessionID]?.length === messages.length)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_z", "msg_b", "msg_m", "msg_a"])
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, JSON.stringify({ multi_tab_enabled: false }))
    const { app, kv, sync, session } = await mount()

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/opencode")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount()

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("records context epochs for the active session", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount()

    try {
      emit(
        event({
          id: "evt_context",
          type: "session.next.context.updated",
          properties: {
            sessionID: "ses_local",
            messageID: "msg_assistant",
            text: "system context",
            timestamp: 42,
          },
        }),
      )
      await wait(() => sync.data.session_context.ses_local?.length === 1)

      expect(sync.data.session_context.ses_local).toEqual([
        { id: "msg_assistant", type: "system", text: "system context", time: { created: 42 } },
      ])
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("hydrates linked persisted context and deduplicates the matching live event", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const sessionID = "ses_persisted_context"
    const session = {
      id: sessionID,
      slug: "persisted-context",
      projectID: "proj_linked",
      directory: "/tmp/linked",
      originSessionID: "ses_origin",
      title: "Persisted context",
      version: "1.18.21",
      time: { created: 1, updated: 1 },
    }
    let contextDirectory: string | null = null
    let releaseContext!: () => void
    const contextResponse = new Promise<void>((resolve) => {
      releaseContext = resolve
    })
    const { app, emit, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(session)
      if (url.pathname === `/session/${sessionID}/messages`) return json([])
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === `/api/session/${sessionID}/context`) {
        contextDirectory = url.searchParams.get("directory")
        return contextResponse.then(() =>
          json({
            data: [{ id: "msg_context", type: "system", text: "persisted context", time: { created: 42 } }],
          }),
        )
      }
      if (url.pathname === "/session") return json([session])
      return undefined
    })

    try {
      const syncing = sync.session.sync(sessionID)
      await wait(() => contextDirectory !== null)
      expect(contextDirectory as string | null).toBe("/tmp/linked")

      emit(
        event(
          {
            id: "evt_context_replayed",
            type: "session.next.context.updated",
            properties: { sessionID, messageID: "msg_context", text: "persisted context", timestamp: 42 },
          },
          "proj_linked",
        ),
      )
      releaseContext()
      await syncing

      expect(sync.data.session_context[sessionID]).toEqual([
        { id: "msg_context", type: "system", text: "persisted context", time: { created: 42 } },
      ])

      emit(
        event(
          {
            id: "evt_context_replayed_again",
            type: "session.next.context.updated",
            properties: { sessionID, messageID: "msg_context", text: "persisted context", timestamp: 42 },
          },
          "proj_linked",
        ),
      )
      await Bun.sleep(20)

      expect(sync.data.session_context[sessionID]).toHaveLength(1)
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("admits linked session interactive and state events without admitting unrelated projects", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount()
    const sessionID = "ses_linked_events"

    try {
      emit(
        event(
          {
            id: "evt_session",
            type: "session.created",
            properties: {
              sessionID,
              info: {
                id: sessionID,
                slug: "linked",
                projectID: "proj_linked",
                directory: "/tmp/linked",
                originSessionID: "ses_origin",
                title: "linked",
                version: "1.18.21",
                time: { created: 1, updated: 1 },
              },
            },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_context_linked",
            type: "session.next.context.updated",
            properties: { sessionID, messageID: "msg_linked", text: "linked context", timestamp: 2 },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_permission",
            type: "permission.asked",
            properties: {
              id: "per_linked",
              sessionID,
              permission: "edit",
              patterns: ["file.txt"],
              metadata: {},
              always: [],
            },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_question",
            type: "question.asked",
            properties: {
              id: "que_linked",
              sessionID,
              questions: [{ header: "Choice", question: "Continue?", options: [{ label: "Yes", description: "" }] }],
            },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_todo",
            type: "todo.updated",
            properties: {
              sessionID,
              todos: [{ content: "finish", status: "pending", priority: "high" }],
            },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_diff",
            type: "session.diff",
            properties: { sessionID, diff: [{ file: "file.txt", additions: 1, deletions: 0 }] },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_unrelated",
            type: "todo.updated",
            properties: {
              sessionID: "ses_unrelated",
              todos: [{ content: "ignore", status: "pending", priority: "low" }],
            },
          },
          "proj_other",
        ),
      )

      await wait(() => sync.data.todo[sessionID]?.length === 1)
      expect(sync.data.permission[sessionID]?.[0]?.id).toBe("per_linked")
      expect(sync.data.question[sessionID]?.[0]?.id).toBe("que_linked")
      expect(sync.data.session_diff[sessionID]?.[0]?.file).toBe("file.txt")
      expect(sync.data.session_context[sessionID]?.[0]?.text).toBe("linked context")
      expect(sync.data.todo.ses_unrelated).toBeUndefined()

      emit(
        event(
          {
            id: "evt_permission_replied",
            type: "permission.replied",
            properties: { sessionID, requestID: "per_linked", reply: "once" },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_question_rejected",
            type: "question.rejected",
            properties: { sessionID, requestID: "que_linked" },
          },
          "proj_linked",
        ),
      )
      await wait(() => sync.data.permission[sessionID]?.length === 0 && sync.data.question[sessionID]?.length === 0)
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("routes linked automatic permission replies to the target directory and workspace", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let reply: URL | undefined
    const { app, emit, permission } = await mount((url) => {
      if (url.pathname !== "/permission/per_auto/reply") return undefined
      reply = url
      return json(true)
    })
    const sessionID = "ses_linked_auto"

    try {
      permission.set("auto")
      emit(
        event(
          {
            id: "evt_session_auto",
            type: "session.created",
            properties: {
              sessionID,
              info: {
                id: sessionID,
                slug: "linked-auto",
                projectID: "proj_linked",
                directory: "/tmp/linked",
                originSessionID: "ses_origin",
                title: "linked auto",
                version: "1.18.21",
                time: { created: 1, updated: 1 },
              },
            },
          },
          "proj_linked",
        ),
      )
      emit(
        event(
          {
            id: "evt_permission_auto",
            type: "permission.asked",
            properties: {
              id: "per_auto",
              sessionID,
              permission: "edit",
              patterns: ["file.txt"],
              metadata: {},
              always: [],
            },
          },
          "proj_linked",
        ),
      )
      await wait(() => reply !== undefined)

      expect(reply?.searchParams.get("directory")).toBe("/tmp/linked")
      expect(reply?.searchParams.get("workspace")).toBe("ws_linked")
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})
