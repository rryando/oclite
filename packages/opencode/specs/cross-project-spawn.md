# Cross-project sessions

Reference for spawning interactive sessions in another project's directory and
surfacing them as tabs in the TUI. The feature is enabled by default: the
`spawn_project` tool is a core tool always available to the model, and the TUI
tab strip is on by default (toggle it off from the command palette).

## Overview

- An agent in session A can spawn a **top-level** session bound to a different
  project's directory (project B) via the `spawn_project` tool.
- The spawned session is a normal interactive session — not a child subagent of
  A. It is linked back to A through `Session.Info.originSessionID`.
- The spawned turn runs detached. When it finishes, its result is injected back
  into the origin session A as a synthetic message.
- The TUI surfaces cross-project sessions as directory-aware tabs by default
  (the `multi_tab_enabled` KV flag defaults to on; disable it from the command
  palette: "Disable multi-project tabs").

## `spawn_project` tool

Spawns an interactive top-level session in a **different** project directory.

### Availability

`spawn_project` is a core tool (`CORE_TOOL_IDS`) registered unconditionally, so
it is always present in the model's tool list — no flag or env var required.

### Parameters

| Parameter     | Type     | Required | Description                                                            |
| ------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `directory`   | `string` | yes      | Absolute path to the target project directory to spawn the session in. |
| `prompt`      | `string` | yes      | The initial work for the spawned session to perform in that project.   |
| `description` | `string` | no       | A short (3–5 word) title for the spawned session.                      |

### Behavior

1. The tool resolves `directory` and switches the active instance context to the
   target project, then creates a **top-level** session there (no `parentID`).
   The new session records `originSessionID` = the calling session's id.
2. The first turn of the spawned session is kicked off on a background job and
   the tool **returns immediately** with a `state="running"` confirmation. It
   does not block waiting for the spawned session to complete.
3. When the spawned turn completes (or errors), its result is injected back into
   the origin session as a synthetic message:
   - On success: a `<spawn … state="completed">` block wrapping the spawned
     session's final text.
   - On failure: a `<spawn … state="error">` block wrapping the error message.

   The injection happens exactly once per job run, so there is no double-inject.
   Interruptions do not produce an injected error.

The origin agent is notified through this injected message; it should not poll
the spawned session for progress.

## Linked session scope

`Session.list({ scope: "linked" })` returns, for the current project:

- the current project's own sessions, **plus**
- any session whose `origin_session_id` points at a session in the current
  project (i.e. cross-project sessions this project spawned).

The default scope (`"project"`) returns only the current project's sessions, so
a session spawned into another directory is invisible there. Sessions in another
project that were **not** spawned by the current project are never returned by
either scope.

This is backed by the `origin_session_id` column on the `session` table
(migration `20260530104205`). Because all open instances share one SQLite
database, the cross-project subselect that powers `scope: "linked"` is valid.

## TUI tab strip

When the `multi_tab_enabled` KV flag is on, the TUI renders a directory-aware
tab strip over the pinned session slots. The strip is hidden and all tab
commands are disabled when the flag is off.

| Action     | Default keybind | Command             | Notes                                                                                |
| ---------- | --------------- | ------------------- | ------------------------------------------------------------------------------------ |
| New tab    | `alt+t`         | `session.tab.new`   | Creates a fresh top-level session in the current directory, pins it, and focuses it. |
| Close tab  | `alt+w`         | `session.tab.close` | Closes the active tab. Tabs are also closable by click.                              |
| Cycle tabs | `alt+]`         | `session.tab.cycle` | Moves focus to the next tab.                                                         |

Additional behavior:

- Cross-project sessions spawned via `spawn_project` are auto-surfaced as tabs,
  labeled by their directory, so you can switch into the spawned session's
  project.
- There are at most **9** tab slots. When all 9 are full, `session.tab.new`
  still creates the session (reachable through the session switcher) but cannot
  pin it; the TUI shows a "tab limit reached" warning instead of silently
  dropping it.
