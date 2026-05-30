import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createSignal, createResource, For, Show, onCleanup } from "solid-js"

const id = "internal:sidebar-arcs"

interface ArcsTask {
  id: string
  title: string
  status: string
  priority: string
}

interface ArcsPlan {
  id: string
  title: string
  status: string
}

interface ArcsBrief {
  slug: string
  name: string
  operatingBrief: {
    currentFocus: string
    recommendedSurface: string
    why: string
    nextAction: string
  }
  openTasksCount: number
  topOpenTasks?: ArcsTask[]
  activePlansCount: number
}

interface ArcsNext {
  task: ArcsTask
  context: string
}

interface ArcsData {
  brief: ArcsBrief
  tasks: ArcsTask[]
  activePlan: ArcsPlan | null
  next: ArcsNext | null
}

function spawnJson<T>(args: string[]): T | null {
  const result = Bun.spawnSync(args, { stderr: "ignore" })
  if (result.exitCode !== 0) return null
  const parsed = JSON.parse(result.stdout.toString().trim())
  return parsed.ok ? (parsed.data as T) : null
}

const INACTIVE = new Set(["done", "cancelled"])

function fetchArcs(): ArcsData | null {
  const brief = spawnJson<ArcsBrief>(["arcs", "brief", "--lean", "--json"])
  if (!brief) return null

  const plans = spawnJson<ArcsPlan[]>(["arcs", "plan", "list", brief.slug, "--lean", "--json"]) ?? []
  const activePlan = plans.find((p) => p.status === "in_progress") ?? plans.find((p) => p.status === "planned") ?? null

  const tasks = activePlan
    ? (spawnJson<ArcsTask[]>(["arcs", "task", "list", brief.slug, `--planId=${activePlan.id}`, "--lean", "--json"]) ?? []).filter((t) => !INACTIVE.has(t.status))
    : (spawnJson<ArcsTask[]>(["arcs", "task", "list", brief.slug, "--lean", "--json"]) ?? brief.topOpenTasks ?? []).filter((t) => !INACTIVE.has(t.status))

  const nextRaw = spawnJson<ArcsNext>(["arcs", "next", brief.slug, "--lean", "--json"])
  const next = nextRaw?.task ? nextRaw : null
  return { brief, tasks, activePlan, next }
}

function statusColor(status: string, theme: ReturnType<() => TuiPluginApi["theme"]["current"]>) {
  if (status === "in_progress") return theme.warning
  if (status === "done") return theme.success
  return theme.textMuted
}

function statusIcon(status: string) {
  if (status === "in_progress") return "•"
  if (status === "done") return "✓"
  return " "
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [open, setOpen] = createSignal(true)
  const [tick, setTick] = createSignal(0)

  const interval = setInterval(() => setTick((n) => n + 1), 30_000)
  onCleanup(() => clearInterval(interval))

  const [data] = createResource(tick, fetchArcs)

  return (
    <Show when={data()}>
      {(d) => (
        <box>
          {/* Header */}
          <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
            <text fg={theme().text}>
              <b>ARCS</b>
              <Show when={!open()}>
                <span style={{ fg: theme().textMuted }}> ({d().brief.openTasksCount} open)</span>
              </Show>
            </text>
          </box>

          <Show when={open()}>
            <box paddingLeft={1} paddingTop={1} gap={1}>

              {/* Next up */}
              <Show when={d().next}>
                {(next) => (
                  <box>
                    <text fg={theme().text}>
                      <b>Next</b>
                    </text>
                    <box flexDirection="row" gap={1} paddingTop={0}>
                      <text flexShrink={0} fg={theme().warning}>▶</text>
                      <text flexGrow={1} wrapMode="word" fg={theme().text}>
                        {next().task.title}
                      </text>
                    </box>
                    <text fg={theme().textMuted} wrapMode="word">
                      {next().context}
                    </text>
                  </box>
                )}
              </Show>

              {/* Full task list */}
              <Show when={d().tasks.length > 0}>
                <box>
                  <text fg={theme().text}>
                    <b>Tasks</b>
                    <Show when={d().activePlan}>
                      {(plan) => <span style={{ fg: theme().textMuted }}> · {plan().title}</span>}
                    </Show>
                  </text>
                  <For each={d().tasks}>
                    {(task) => (
                      <box flexDirection="row" gap={0}>
                        <text
                          flexShrink={0}
                          style={{ fg: statusColor(task.status, theme()) }}
                        >
                          [{statusIcon(task.status)}]{" "}
                        </text>
                        <text
                          flexGrow={1}
                          wrapMode="word"
                          style={{ fg: statusColor(task.status, theme()) }}
                        >
                          {task.title}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              {/* Brief next action */}
              <text fg={theme().textMuted} wrapMode="word">
                {d().brief.operatingBrief.nextAction}
              </text>

            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
