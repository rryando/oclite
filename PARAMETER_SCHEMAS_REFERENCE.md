# Parameter Schemas Reference

This document shows exactly where parameter schemas are defined and what they send to the LLM.

## File Locations

All parameter schemas are defined in their respective tool files:

```
packages/opencode/src/tool/
├── read.ts              <- Read tool parameters
├── edit.ts              <- Edit tool parameters (not shown but similar)
├── glob.ts              <- Glob tool parameters
├── grep.ts              <- Grep tool parameters
├── write.ts             <- Write tool parameters
├── task.ts              <- Task tool parameters
├── skill.ts             <- Skill tool parameters (lines 10-12)
├── shell.ts             <- Shell tool (imports Parameters from shell/prompt.ts)
└── shell/
    └── prompt.ts        <- Shell tool parameters (lines 22-31, 33)
```

---

## 1. Read Tool Parameters

**File:** `packages/opencode/src/tool/read.ts`
**Lines:** 29-37

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

**Parameters to LLM (3 total):**
1. `filePath` (required, string) - The absolute path to the file or directory to read
2. `offset` (optional, non-negative integer) - The line number to start reading from (1-indexed)
3. `limit` (optional, non-negative integer) - The maximum number of lines to read (defaults to 2000)

**JSON Schema sent:**
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

## 2. Shell Tool Parameters

**File:** `packages/opencode/src/tool/shell/prompt.ts`
**Lines:** 22-31 (function definition), 33 (export)

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
      description: descriptions.bash  // <- This is ~350 bytes!
    }),
  })
}

export const Parameters = parameterSchema(descriptions.bash)
```

**Parameters to LLM (4 total):**
1. `command` (required, string) - The command to execute
2. `timeout` (optional, positive integer) - Optional timeout in milliseconds
3. `workdir` (optional, string) - The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.
4. `description` (required, string) - Clear, concise description of what this command does in 5-10 words. [~350 bytes of examples and guidelines]

**The descriptions object (lines 10-15):**
```typescript
const descriptions = {
  bash: "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
  powershell:
    'Clear, concise description of what this command does in 5-10 words. Examples:\nInput: Get-ChildItem -LiteralPath "."\nOutput: Lists current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: New-Item -ItemType Directory -Path "tmp"\nOutput: Creates directory tmp',
  cmd: 'Clear, concise description of what this command does in 5-10 words. Examples:\nInput: dir\nOutput: Lists current directory\n\nInput: if exist "package.json" type "package.json"\nOutput: Prints package.json when it exists\n\nInput: mkdir tmp\nOutput: Creates directory tmp',
}
```

**Actual bash description value (~350 bytes):**
```
Clear, concise description of what this command does in 5-10 words. Examples:
Input: ls
Output: Lists files in current directory

Input: git status
Output: Shows working tree status

Input: npm install
Output: Installs package dependencies

Input: mkdir foo
Output: Creates directory 'foo'
```

---

## 3. Skill Tool Parameters

**File:** `packages/opencode/src/tool/skill.ts`
**Lines:** 10-12

```typescript
export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ 
    description: "The name of the skill from available_skills" 
  }),
})
```

**Parameters to LLM (1 total):**
1. `name` (required, string) - The name of the skill from available_skills

**JSON Schema sent:**
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

## 4. Other Tool Parameters (Summary)

### Glob Tool

**File:** `packages/opencode/src/tool/glob.ts`

```typescript
export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided.",
  }),
  pattern: Schema.String.annotate({
    description: "The glob pattern to match files against",
  }),
})
```

**Parameters:**
- `pattern` (required, string) - The glob pattern to match files against
- `path` (optional, string) - Directory to search in (long detailed description)

---

### Grep Tool

**File:** `packages/opencode/src/tool/grep.ts`

```typescript
export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ 
    description: "The regex pattern to search for in file contents" 
  }),
  include: Schema.optional(Schema.String).annotate({
    description: "File pattern to include in the search (e.g. \"*.js\", \"*.{ts,tsx}\")",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
})
```

**Parameters:**
- `pattern` (required, string) - The regex pattern to search for in file contents
- `include` (optional, string) - File pattern to include in the search
- `path` (optional, string) - The directory to search in

---

### Write Tool

**File:** `packages/opencode/src/tool/write.ts`

```typescript
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "The path to the file to write. If the path starts with './', it will be written relative to the current working directory.",
  }),
  content: Schema.String.annotate({
    description: "The file content",
  }),
})
```

**Parameters:**
- `filePath` (required, string) - The path to the file to write
- `content` (required, string) - The file content

---

### Edit Tool

**File:** `packages/opencode/src/tool/edit.ts`

```typescript
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "The path to the file to edit. If the path starts with './', it will be read relative to the current working directory.",
  }),
  oldString: Schema.String.annotate({
    description: "The exact substring to replace. Must match exactly as it appears in the file (including whitespace and special characters).",
  }),
  newString: Schema.String.annotate({
    description: "The replacement text.",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "If true, replace all occurrences of oldString. If false or omitted, replace only the first occurrence.",
  }),
})
```

**Parameters:**
- `filePath` (required, string) - The path to the file to edit
- `oldString` (required, string) - The exact substring to replace
- `newString` (required, string) - The replacement text
- `replaceAll` (optional, boolean) - Replace all occurrences

---

### Task Tool

**File:** `packages/opencode/src/tool/task.ts`

```typescript
export const Parameters = Schema.Struct({
  subagent_type: Schema.String.annotate({
    description: "The type of subagent to launch (e.g., 'search', 'code', 'research')",
  }),
  prompt: Schema.String.annotate({
    description: "Self-contained detailed task description for the subagent",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "Optional task_id to resume a prior session",
  }),
})
```

**Parameters:**
- `subagent_type` (required, string) - The type of subagent to launch
- `prompt` (required, string) - Self-contained detailed task description
- `task_id` (optional, string) - Optional task_id to resume a prior session

---

## Token Cost Analysis

| Tool | Parameters | Approx Schema Size | Tokens |
|------|-----------|------------------|--------|
| Read | 3 | ~500 bytes | ~125 |
| Edit | 4 | ~600 bytes | ~150 |
| Glob | 2 | ~400 bytes | ~100 |
| Grep | 3 | ~400 bytes | ~100 |
| Write | 2 | ~300 bytes | ~75 |
| Task | 3 | ~400 bytes | ~100 |
| Skill | 1 | ~200 bytes | ~50 |
| Shell | 4 (with 350-byte desc) | ~800 bytes | ~200 |
| **TOTAL** | **22** | **~4,600 bytes** | **~900** |

---

## Key Insights

1. **Largest schemas:** Shell tool (800 bytes) and Edit tool (600 bytes)
2. **Most parameters:** Task and Shell tools (4 parameters each)
3. **Longest description:** Shell "description" parameter (350 bytes of examples)
4. **Smallest:** Skill tool (200 bytes, 1 parameter)

---

## How These Get Converted to JSON Schema

The Effect `Schema` types are automatically converted to JSON Schema format by the LLM framework:

```typescript
// TypeScript schema
Schema.String.annotate({ description: "..." })

// Becomes JSON Schema
{
  "type": "string",
  "description": "..."
}

// Optional types
Schema.optional(Schema.String)

// Become
{
  "type": "string",
  // NOT in required array
}

// Integer constraints
NonNegativeInt  // minimum: 0
PositiveInt     // minimum: 1
```

---

## Where These Schemas Are Used

All parameter schemas are used in the same flow:

1. **Tool definition** (`tool.ts`):
   ```typescript
   export const MyTool = Tool.define("myTool", ...)
   ```

2. **Tool registration** (in `registry.ts` or similar):
   - Tool is registered with the LLM framework
   - Parameters schema is converted to JSON Schema

3. **LLM receives**:
   - Tool name and description
   - Parameters as JSON Schema
   - Parameter descriptions

4. **LLM generates**:
   - Tool call with typed parameters

5. **Runtime validates**:
   - Parameters decoded using the original Effect schema
   - Type-safe execution
