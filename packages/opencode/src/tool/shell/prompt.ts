import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema(description: string) {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to execute" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "Optional timeout in milliseconds" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
    description: Schema.String.annotate({ description }),
  })
}

export const Parameters = parameterSchema("Clear, concise description of what this command does in 5-10 words.")
export type Parameters = Schema.Schema.Type<typeof Parameters>

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  return {
    description: [
      `Executes a given ${shellDisplayName(name)} command with optional timeout.`,
      `OS: ${platform}, Shell: ${name}`,
      "Use the `workdir` parameter instead of `cd`. Use dedicated tools for file operations (Read/Edit/Write/Glob/Grep).",
      `Use \`${Global.Path.tmp}\` for temp files.`,
      `Timeout: ${defaultTimeoutMs}ms default. Output truncated at ${limits.maxLines} lines / ${limits.maxBytes} bytes.`,
      "Prefer dedicated tools over find/grep/cat/head/tail/sed/awk/echo.",
      "Chain dependent commands with '&&'. Use ';' for fire-and-forget sequences.",
    ].join("\n"),
    parameters: parameterSchema("Clear, concise description of what this command does in 5-10 words."),
  }
}

export * as ShellPrompt from "./prompt"
