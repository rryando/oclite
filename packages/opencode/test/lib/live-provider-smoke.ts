import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type LiveScenario = "normal" | "read-tool" | "usage" | "subagent"

type DisabledLiveConfig = { readonly enabled: false }
export type EnabledLiveConfig = {
  readonly enabled: true
  readonly provider: string
  readonly model: string
  readonly scenario: LiveScenario
  readonly maxCalls: number
}
export type LiveConfig = DisabledLiveConfig | EnabledLiveConfig

export type LiveEvent = Record<string, unknown> & {
  readonly type: string
  readonly sessionID: string
}

const scenarios = new Set<LiveScenario>(["normal", "read-tool", "usage", "subagent"])
const timeoutMs = 90_000
const cliEntry = path.resolve(import.meta.dir, "../../src/index.ts")

export function parseLiveConfig(env: Record<string, string | undefined>): LiveConfig {
  if (env.LIVE_LLM !== "1") return { enabled: false }

  const provider = required(env, "LIVE_PROVIDER")
  const model = required(env, "LIVE_MODEL")
  const scenario = required(env, "LIVE_SCENARIO")
  const rawMaxCalls = required(env, "LIVE_MAX_CALLS")

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(provider)) throw new Error("LIVE_PROVIDER must be a provider ID")
  if (!model.startsWith(`${provider}/`) || model.length === provider.length + 1) {
    throw new Error(`LIVE_MODEL must start with ${provider}/`)
  }
  if (!scenarios.has(scenario as LiveScenario)) {
    throw new Error("LIVE_SCENARIO must be normal, read-tool, usage, or subagent")
  }

  const maxCalls = Number(rawMaxCalls)
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8) {
    throw new Error("LIVE_MAX_CALLS must be an integer from 1 through 8")
  }
  if (scenario === "read-tool" && maxCalls < 2) throw new Error("LIVE_MAX_CALLS must be at least 2 for read-tool")
  if (scenario === "subagent" && maxCalls < 3) throw new Error("LIVE_MAX_CALLS must be at least 3 for subagent")

  return { enabled: true, provider, model, scenario: scenario as LiveScenario, maxCalls }
}

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required when LIVE_LLM=1`)
  return value
}

export function parseNdjsonEvents(stdout: string): LiveEvent[] {
  return stdout.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return []
    try {
      const value: unknown = JSON.parse(line)
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object")
      if (!("type" in value) || typeof value.type !== "string") throw new Error("missing string type")
      if (!("sessionID" in value) || typeof value.sessionID !== "string") throw new Error("missing string sessionID")
      return [value as LiveEvent]
    } catch (error) {
      throw new Error(`Invalid NDJSON line ${index + 1}: ${error instanceof Error ? error.message : "parse error"}`)
    }
  })
}

export function sanitizeLiveDiagnostic(value: string) {
  return value
    .replaceAll(/\u001b\[[0-9;]*m/g, "")
    .replaceAll(/authorization(\s*[=:]\s*)(?:Bearer\s+)?\S+/gi, "Authorization$1Bearer [REDACTED]")
    .replaceAll(/\b(?:sk|key|token|secret|password)[-_][A-Za-z0-9._-]+\b/gi, "[REDACTED]")
    .replaceAll(/(api[-_ ]?key|access[-_ ]?token|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2[REDACTED]")
    .slice(0, 2_000)
}

export function assertLiveSmokeEvents(
  events: LiveEvent[],
  scenario: LiveScenario,
  maxCalls: number,
  expectedText = "LIVE_SMOKE_OK",
) {
  const errors = events.filter((event) => event.type === "error")
  if (errors.length > 0) {
    throw new Error(
      `live smoke response contained an error event: ${sanitizeLiveDiagnostic(JSON.stringify(errors.map((event) => event.error)))}`,
    )
  }

  const output = events
    .filter((event) => event.type === "text")
    .map(text)
    .filter(Boolean)
    .at(-1)
  if (!output) {
    throw new Error(
      `live smoke response did not contain a completed text event (${events.map((event) => event.type).join(", ")})`,
    )
  }
  if (output !== expectedText) throw new Error(`live smoke response text did not equal ${expectedText}`)

  const steps = events.filter((event) => event.type === "step_finish")
  if (!events.some((event) => event.type === "step_start")) {
    throw new Error("live smoke response did not contain a step_start event")
  }
  if (steps.length === 0) throw new Error("live smoke response did not contain a step_finish event")
  if (steps.length > maxCalls) throw new Error(`live smoke exceeded LIVE_MAX_CALLS (${maxCalls})`)

  let inputTokens = 0
  let outputTokens = 0
  for (const step of steps) {
    const data = part(step)
    const tokens = data.tokens
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
      throw new Error("step_finish event did not contain usage")
    }
    for (const value of usageValues(tokens)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error("usage values must be finite nonnegative numbers")
      }
    }
    if (typeof data.cost !== "number" || !Number.isFinite(data.cost) || data.cost < 0) {
      throw new Error("step_finish cost must be a finite nonnegative number")
    }
    const usage = tokens as Record<string, unknown>
    inputTokens += typeof usage.input === "number" ? usage.input : 0
    outputTokens += typeof usage.output === "number" ? usage.output : 0
  }
  if (inputTokens <= 0 || outputTokens <= 0) throw new Error("live smoke usage must include positive input and output")

  if (scenario === "read-tool" && !hasTool(events, "read")) {
    throw new Error("read-tool scenario did not complete the read tool")
  }
  if (scenario === "subagent" && !hasTool(events, "task"))
    throw new Error("subagent scenario did not complete the task tool")
  if ((scenario === "read-tool" || scenario === "subagent") && steps.length < 2) {
    throw new Error(`${scenario} scenario did not complete a tool follow-up call`)
  }
}

function part(event: LiveEvent) {
  if (!event.part || typeof event.part !== "object" || Array.isArray(event.part)) return {} as Record<string, unknown>
  return event.part as Record<string, unknown>
}

function text(event: LiveEvent) {
  const value = part(event).text
  return typeof value === "string" ? value.trim() : ""
}

function usageValues(tokens: object) {
  const usage = tokens as Record<string, unknown>
  const cache = usage.cache
  return [
    ...(usage.total === undefined ? [] : [usage.total]),
    usage.input,
    usage.output,
    usage.reasoning,
    ...(cache && typeof cache === "object" && !Array.isArray(cache)
      ? [(cache as Record<string, unknown>).read, (cache as Record<string, unknown>).write]
      : [undefined, undefined]),
  ]
}

function hasTool(events: LiveEvent[], name: string) {
  return events.some((event) => {
    if (event.type !== "tool_use" || part(event).tool !== name) return false
    const state = part(event).state
    return (
      !!state && typeof state === "object" && !Array.isArray(state) && "status" in state && state.status === "completed"
    )
  })
}

export async function liveProviderSmoke(config: EnabledLiveConfig) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-live-smoke-"))
  await fs.chmod(directory, 0o700)

  try {
    const marker = `live-smoke-${crypto.randomUUID()}`
    await fs.writeFile(path.join(directory, "read-me.txt"), marker, { mode: 0o600 })
    const env: Record<string, string | undefined> = {
      ...process.env,
      XDG_DATA_HOME: process.env.LIVE_XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
      XDG_CACHE_HOME: process.env.LIVE_XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      XDG_CONFIG_HOME: process.env.LIVE_XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
      XDG_STATE_HOME: process.env.LIVE_XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_AUTOCOMPACT: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_DISABLE_LLM_RETRIES: "1",
      OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "64",
      OPENCODE_DB: path.join(directory, "live-smoke.db"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: { [config.provider]: {} },
        ...(config.scenario === "subagent"
          ? {
              agent: {
                build: { permission: { task: "allow" } },
                general: { permission: { task: "deny" } },
              },
            }
          : {}),
        permission: { "*": "deny", read: "allow" },
      }),
    }
    for (const key of [
      "OPENCODE",
      "OPENCODE_PID",
      "OPENCODE_PROCESS_ROLE",
      "OPENCODE_RUN_ID",
      "OPENCODE_LOG_INITIALIZED_RUN_ID",
      "OPENCODE_TEST_HOME",
      "OPENCODE_TEST_MANAGED_CONFIG_DIR",
      "OPENCODE_MODELS_PATH",
      "OPENCODE_EXPERIMENTAL_EVENT_SYSTEM",
      "OPENCODE_EXPERIMENTAL_WORKSPACES",
    ]) {
      delete env[key]
    }
    const proc = Bun.spawn(
      [
        "sh",
        "-c",
        'umask 077; exec "$@"',
        "live-provider-smoke",
        "bun",
        "run",
        "--conditions=browser",
        cliEntry,
        "run",
        "--format",
        "json",
        "--model",
        config.model,
        "--agent",
        "build",
        "--title",
        "live-provider-smoke",
        prompt(config.scenario, marker),
      ],
      {
        cwd: directory,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const stdout = new Response(proc.stdout).text()
    const stderr = new Response(proc.stderr).text()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs)
    })

    try {
      const exited = await Promise.race([proc.exited, timedOut])
      if (exited === "timeout") {
        proc.kill("SIGKILL")
        await proc.exited
        throw new Error("live provider smoke exceeded the 90s timeout")
      }
      const diagnostic = sanitizeLiveDiagnostic((await stderr).trim())
      const events = parseNdjsonEvents(await stdout)
      return {
        exitCode: exited,
        events,
        expectedText: config.scenario === "read-tool" ? marker : "LIVE_SMOKE_OK",
        stderr: [
          diagnostic,
          sanitizeLiveDiagnostic(
            JSON.stringify(
              events.map((event) => ({
                type: event.type,
                error: event.type === "error" ? event.error : undefined,
              })),
            ),
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (proc.exitCode === null) proc.kill("SIGKILL")
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

function prompt(scenario: LiveScenario, marker: string) {
  if (scenario === "read-tool") {
    return `Use the read tool on read-me.txt, then reply with exactly the file contents. The expected contents are ${marker}.`
  }
  if (scenario === "subagent") {
    return "Use the task tool once with the general subagent to obtain the phrase LIVE_SMOKE_OK, then reply LIVE_SMOKE_OK."
  }
  if (scenario === "usage") return "Reply with exactly LIVE_SMOKE_OK. Do not use tools."
  return "Reply with exactly LIVE_SMOKE_OK. Do not use tools."
}
