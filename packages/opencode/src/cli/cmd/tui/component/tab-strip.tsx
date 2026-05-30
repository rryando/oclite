import { createMemo, For, Show } from "solid-js"
import path from "path"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

// Directory-aware tab strip rendered at the top of the TUI when multi-tab mode is on.
// It renders one tab per pinned slot, reusing local.session.slots()/pinned so tabs and the
// session quick-switch slots stay in lockstep. Closing a tab only unpins it (the underlying
// session is never deleted).
export function TabStrip() {
  const local = useLocal()
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()

  // Derive a short, disambiguating directory label for each open tab. When two tabs share a
  // basename we fall back to the parent/basename pair so the user can tell them apart.
  const tabs = createMemo(() => {
    const open = local.session.slots()
    const basenames = open.map((id) => {
      const dir = sync.session.get(id)?.directory ?? ""
      return { id, dir, base: dir ? path.basename(dir) : "untitled" }
    })
    const counts = new Map<string, number>()
    for (const tab of basenames) counts.set(tab.base, (counts.get(tab.base) ?? 0) + 1)
    return basenames.map((tab) => {
      if ((counts.get(tab.base) ?? 0) <= 1 || !tab.dir) return { id: tab.id, label: tab.base }
      const parent = path.basename(path.dirname(tab.dir))
      return { id: tab.id, label: parent ? `${parent}/${tab.base}` : tab.base }
    })
  })

  return (
    <Show when={tabs().length > 0}>
      <box flexDirection="row" flexShrink={0} backgroundColor={theme.backgroundPanel}>
        <For each={tabs()}>
          {(tab, index) => {
            const active = () => route.data.type === "session" && route.data.sessionID === tab.id
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : undefined}
                onMouseDown={() => local.session.quickSwitch(index() + 1)}
              >
                <text fg={active() ? theme.selectedListItemText : theme.text} wrapMode="none">
                  {tab.label}
                </text>
                <text
                  fg={active() ? theme.selectedListItemText : theme.textMuted}
                  wrapMode="none"
                  onMouseDown={(evt) => {
                    evt.stopPropagation()
                    local.session.closeTab(tab.id)
                  }}
                >
                  {" x"}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
