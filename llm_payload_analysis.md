# LLM Payload Analysis: What Gets Sent on "meow" Message

## Summary
For a simple "meow" message, the system sends:
- **System prompt sections** (environment info + skills section)
- **Tool descriptions** (8 tools × ~6.6 KB total text)
- **Parameter schemas** (JSON schemas for each tool's parameters)

---

## 1. TOOL DESCRIPTION FILES (6,575 bytes total)

### 1.1 read.txt (1,158 bytes)
```
Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents "foo\n", you will receive "1: foo\n". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and PDFs and return them as file attachments.
```

### 1.2 edit.txt (1,369 bytes)
```
Performs exact string replacements in files. 

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., `1: `). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `oldString` is not found in the file with an error "oldString not found in content".
- The edit will FAIL if `oldString` is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match." Either provide a larger string with more surrounding context to make it unique or use `replaceAll` to change every instance of `oldString`. 
- Use `replaceAll` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
```

### 1.3 glob.txt (545 bytes)
```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.
```

### 1.4 grep.txt (689 bytes)
```
- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\s+\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
```

### 1.5 write.txt (623 bytes)
```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.
```

### 1.6 task.txt (881 bytes)
```
Launch a new agent to handle complex, multistep tasks autonomously.

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Task tool:
- Reading a specific file path — use Read or Glob instead
- Searching for a specific symbol — use Grep instead
- Searching within 2-3 known files — use Read instead

Usage notes:
1. Launch multiple agents concurrently when possible (single message, multiple tool uses)
2. The agent returns a single message (not visible to user). Summarize results for the user.
3. Each invocation starts fresh unless you provide task_id to resume a prior session.
4. Your prompt must be self-contained with a detailed task description.
5. Clearly tell the agent whether to write code or just research.
6. If the agent description mentions proactive use, use it without the user asking.
```

### 1.7 todowrite.txt (911 bytes)
```
Create and maintain a structured task list for the current coding session. Tracks progress, organizes multi-step work, and surfaces status to the user.

## When to use
- The task requires 3+ distinct steps or actions
- The user provides multiple tasks or explicitly asks for a todo list
- You start a task - mark it `in_progress` (only one at a time)
- You finish a task - mark it `completed`

## When NOT to use
- Single, straightforward tasks (<3 steps)
- Purely informational or conversational requests

## States
- `pending` - not started
- `in_progress` - actively working (exactly ONE at a time)
- `completed` - finished successfully
- `cancelled` - no longer needed

## Rules
- Update status in real time; don't batch completions
- Mark `completed` only after the work is actually done, including verification
- Keep exactly one `in_progress` while work remains
- Items should be specific and actionable
```

### 1.8 skill.txt (399 bytes)
```
Load a specialized skill when the task at hand matches one of the skills listed in the system prompt.

Use this tool to inject the skill's instructions and resources into current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc in the same directory as the skill.

The skill name must match one of the skills listed in your system prompt.
```

### 1.9 shell.txt (1,200 bytes - from shell/shell.txt)
This is a **template** that gets rendered with actual values. The raw template contains:
```
${intro}

Be aware: OS: ${os}, Shell: ${shell}

${workdirSection}

Use `${tmp}` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

${commandSection}

# Git and GitHub
- Only commit, amend, push, or create PRs when explicitly requested.
- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files and never commit secrets.
- Write a concise commit message that matches the repo style.
- Do not update git config, skip hooks, use interactive `-i`, force-push, or create empty commits unless explicitly requested.
- If a commit fails or hooks reject it, fix the issue and create a new commit; do not amend the failed commit.
- Before creating a PR, inspect status, diff, remote tracking, recent commits, and the diff from the base branch.
- Review all commits included in the PR, not just the latest commit.
- Use `gh` for GitHub tasks, including PRs, issues, checks, and releases; return the PR URL when done.
```

The `${commandSection}` variable gets filled with ~900 bytes of detailed bash-specific instructions (or PowerShell/cmd equivalents).

---

## 2. PARAMETER SCHEMAS SENT TO LLM

### 2.1 Read Tool Parameters Schema
(from `packages/opencode/src/tool/read.ts` lines 29-37)

```typescript
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ 
    description: "The absolute path to the file or directory to read" 
  }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
})
```

**JSON Schema Output:**
```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "The absolute path to the file or directory to read"
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "description": "The line number to start reading from (1-indexed)"
    },
    "limit": {
      "type": "integer",
      "minimum": 0,
      "description": "The maximum number of lines to read (defaults to 2000)"
    }
  },
  "required": ["filePath"]
}
```

---

### 2.2 Shell Tool Parameters Schema
(from `packages/opencode/src/tool/shell/prompt.ts` lines 22-31)

```typescript
export function parameterSchema(description: string) {
  return Schema.Struct({
    command: Schema.String.annotate({ 
      description: "The command to execute" 
    }),
    timeout: Schema.optional(PositiveInt).annotate({ 
      description: "Optional timeout in milliseconds" 
    }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
    description: Schema.String.annotate({ 
      description: descriptions.bash  // ~350 bytes of multi-line description
    }),
  })
}

export const Parameters = parameterSchema(descriptions.bash)
```

**JSON Schema Output (for bash):**
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The command to execute"
    },
    "timeout": {
      "type": "integer",
      "minimum": 1,
      "description": "Optional timeout in milliseconds"
    },
    "workdir": {
      "type": "string",
      "description": "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in 5-10 words. Examples:\n[~350 bytes of examples...]"
    }
  },
  "required": ["command", "description"]
}
```

---

### 2.3 Skill Tool Parameters Schema
(from `packages/opencode/src/tool/skill.ts` lines 10-12)

```typescript
export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ 
    description: "The name of the skill from available_skills" 
  }),
})
```

**JSON Schema Output:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The name of the skill from available_skills"
    }
  },
  "required": ["name"]
}
```

---

## 3. SYSTEM PROMPT INJECTION

### 3.1 Environment Section
(from `packages/opencode/src/session/system.ts` lines 28-42)

```
You are powered by the model named [model.api.id]. The exact model ID is [model.providerID]/[model.api.id]
Here is some useful information about the environment you are running in:
<env>
  Working directory: [ctx.directory]
  Workspace root folder: [ctx.worktree]
  Is directory a git repo: [yes/no]
  Platform: [process.platform]
  Today's date: [new Date().toDateString()]
</env>
```

**Approximate bytes:** 200-300 bytes

---

### 3.2 Skills Section
(from `packages/opencode/src/session/system.ts` lines 45-57)

```typescript
skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
  if (Permission.disabled(["skill"], agent.permission).has("skill")) return
  
  const list = yield* skill.available(agent)
  
  return [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    Skill.fmt(list, { verbose: true }),  // Lists available skills with verbose descriptions
  ].join("\n")
})
```

**Size:** Depends on available skills; typically 500-2000 bytes if skills are available.

---

## 4. TOTAL TOKEN COST BREAKDOWN

For a simple "meow" message with no skills enabled:

| Component | Bytes | Approx Tokens |
|-----------|-------|---------------|
| Tool descriptions (8 files) | 6,575 | ~1,640 |
| Shell tool template (rendered) | 1,200-2,000 | ~300-500 |
| Parameter JSON schemas | 800-1,200 | ~200-300 |
| Environment section | 200-300 | ~50-75 |
| Skills section (disabled) | 0 | 0 |
| **Total** | **~10,000-11,500** | **~2,200-2,600** |

---

## 5. KEY PARAMETER SCHEMA CHARACTERISTICS

### Read Tool
- **3 parameters:** `filePath` (required), `offset` (optional), `limit` (optional)
- **Description size:** ~200 bytes
- **Schema size:** ~500 bytes

### Shell Tool  
- **4 parameters:** `command` (required), `description` (required), `timeout` (optional), `workdir` (optional)
- **Description size:** ~350 bytes (for bash description alone)
- **Schema size:** ~800 bytes

### Skill Tool
- **1 parameter:** `name` (required)
- **Description size:** ~100 bytes
- **Schema size:** ~200 bytes

---

## 6. TOKEN-HEAVY ELEMENTS

**Most expensive components per token:**

1. **Shell description field in schema** (~350 bytes)
   - Contains multi-line examples for how to describe commands
   - Repeated for bash/PowerShell/cmd variants if available

2. **Tool descriptions text** (~6.6 KB total)
   - Read tool description is longest (1,158 bytes)
   - Edit tool description is 2nd longest (1,369 bytes)

3. **Command section in shell template** (~900 bytes when rendered)
   - Contains detailed step-by-step guidance on command execution
   - Includes directory verification, quoting rules, chaining instructions

4. **Skill section** (variable)
   - If available, typically 500-2000 bytes per skill
   - Lists available skills with verbose descriptions

---

## Notes

- The shell tool description is **templated and rendered** with actual values (OS, shell type, working directory, etc.)
- The "description" parameter in the shell tool schema requires a **detailed multi-line description** (~350 bytes) of what the command does
- All tool descriptions are loaded as plain text from `.txt` files and included in the system/tool prompt
- Parameter schemas are converted to JSON Schema format for transmission to the LLM
- The actual "meow" message itself would add only ~20-50 tokens, but the context setup adds 2,200-2,600 tokens
