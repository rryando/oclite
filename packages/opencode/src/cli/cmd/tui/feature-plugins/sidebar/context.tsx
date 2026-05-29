import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

type ThemeColor = TuiPluginApi["theme"]["current"]["text"]

function ProgressBar(props: { percent: number; width: number; color: ThemeColor; dimColor: ThemeColor }) {
  const filled = Math.round((props.percent / 100) * props.width)
  const empty = props.width - filled
  return (
    <box flexDirection="row">
      <text style={{ fg: props.color }}>{"█".repeat(filled)}</text>
      <text style={{ fg: props.dimColor }}>{"░".repeat(empty)}</text>
    </box>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last)
      return { tokens: 0, input: 0, output: 0, cache: 0, percent: null }

    const { input, output, reasoning, cache } = last.tokens
    const tokens = input + output + reasoning + cache.read + cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      input,
      output,
      cache: cache.read + cache.write,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const barColor = createMemo<ThemeColor>(() => {
    const p = state().percent ?? 0
    if (p >= 80) return theme().error
    if (p >= 50) return theme().warning
    return theme().success
  })

  const costColor = createMemo<ThemeColor>(() => {
    const c = cost()
    if (c >= 1) return theme().error
    if (c >= 0.1) return theme().warning
    return theme().textMuted
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>

      <box paddingTop={1}>
        <Show when={state().percent !== null}>
          <ProgressBar percent={state().percent!} width={34} color={barColor()} dimColor={theme().borderSubtle} />
        </Show>

        {/* Compact stat line */}
        <Show when={state().tokens > 0}>
          <text>
            <Show when={state().percent !== null}>
              <span style={{ fg: barColor() }}>{state().percent}%</span>
              <span style={{ fg: theme().textMuted }}> · </span>
            </Show>
            <span style={{ fg: theme().textMuted }}>{fmt(state().input)} in</span>
            <span style={{ fg: theme().textMuted }}> · </span>
            <span style={{ fg: theme().textMuted }}>{fmt(state().output)} out</span>
            <Show when={state().cache > 0}>
              <span style={{ fg: theme().textMuted }}> · </span>
              <span style={{ fg: theme().info }}>{fmt(state().cache)} cache</span>
            </Show>
            <span style={{ fg: theme().textMuted }}> · </span>
            <span style={{ fg: costColor() }}>{money.format(cost())}</span>
          </text>
        </Show>

        {/* No tokens yet — just show $0.00 */}
        <Show when={state().tokens === 0}>
          <text style={{ fg: theme().textMuted }}>{money.format(cost())}</text>
        </Show>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
