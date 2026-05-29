# What Gets Sent to the LLM on a Simple "meow" Message

## Quick Answer

When you send "meow" to an opencode agent, **approximately 2,200-2,600 tokens** are sent to the LLM before your message. The "meow" itself is only ~20 tokens.

## Breakdown by Component

### 1. Tool Description Files (6,575 bytes = ~1,640 tokens)

Eight tool description files are loaded from `packages/opencode/src/tool/*.txt`:

| File | Size | Purpose |
|------|------|---------|
| **read.txt** | 1,158 bytes | File/directory reading, up to 2000 lines |
| **edit.txt** | 1,369 bytes | Exact string replacements in files |
| **glob.txt** | 545 bytes | Fast file pattern matching |
| **grep.txt** | 689 bytes | Content search with regex |
| **write.txt** | 623 bytes | Write files to filesystem |
| **task.txt** | 881 bytes | Launch autonomous subagents |
| **todowrite.txt** | 911 bytes | Create structured task lists |
| **skill.txt** | 399 bytes | Load specialized skill modules |

**Total tool descriptions:** 6,575 bytes

### 2. Shell Tool Description (1,200-2,000 bytes = ~300-500 tokens)

The shell tool uses a **templated description** from `packages/opencode/src/tool/shell/shell.txt` that gets rendered with:
- OS information (linux, darwin, win32)
- Shell type (bash, zsh, powershell, cmd)
- Working directory
- Command section (~900 bytes of detailed bash-specific guidance)

### 3. Parameter Schemas (800-1,200 bytes = ~200-300 tokens)

JSON schemas are sent for each tool. Key examples:

**Read Tool:**
```json
{
  "type": "object",
  "properties": {
    "filePath": {"type": "string", "description": "..."},
    "offset": {"type": "integer", "description": "..."},
    "limit": {"type": "integer", "description": "..."}
  }
}
```

**Shell Tool:** 4 parameters (command, description, timeout, workdir)
- The "description" parameter itself has a ~350 byte description with multi-line examples

**Skill Tool:** 1 parameter (name)

### 4. System Prompt Sections (200-2,300 bytes = ~50-575 tokens)

**Environment Section (~200-300 bytes):**
```
You are powered by the model named [id]. The exact model ID is [provider]/[id]
Working directory: [path]
Workspace root folder: [path]
Is directory a git repo: yes/no
Platform: linux/darwin/win32
Today's date: [date]
```

**Skills Section (~0-2,000 bytes, if enabled):**
- Lists available skills with verbose descriptions
- Only included if skill permission is enabled
- Typically 500-2000 bytes per skill

### 5. Your Message (~50 bytes = ~20 tokens)

The actual "meow" message.

## Total Token Cost

| Component | Bytes | Tokens |
|-----------|-------|--------|
| Tool descriptions | 6,575 | 1,640 |
| Shell template | 1,200-2,000 | 300-500 |
| Parameter schemas | 800-1,200 | 200-300 |
| Environment section | 200-300 | 50-75 |
| Skills section | 0-2,000 | 0-500 |
| **"meow" message** | **50** | **20** |
| **TOTAL** | **~10,000-11,500** | **~2,200-2,600** |

## Token-Heavy Elements (Biggest Cost Drivers)

1. **Tool descriptions** (~1,640 tokens)
   - The longest are `edit.txt` (1,369 bytes) and `read.txt` (1,158 bytes)
   - These are sent with every message to help the LLM understand available tools

2. **Shell command section** (~300-500 tokens)
   - Detailed guidance on directory verification, quoting, command chaining
   - Only sent if shell tool is available

3. **Parameter schema descriptions** (~200-300 tokens)
   - The shell tool's "description" parameter has a 350-byte description alone
   - Explains the format for command descriptions

4. **Skills section** (variable, 0-500 tokens)
   - Only sent if skills are available and enabled
   - Lists available skills with verbose descriptions

## Key Observations

- **Fixed overhead:** ~2,200 tokens minimum (tool descriptions + schemas + environment)
- **Variable overhead:** 0-500 tokens (skills section)
- **Message ratio:** Your "meow" is 0.8% of the total tokens sent
- **System prompt dominance:** 99.2% of tokens are context/tool definitions before your message
- **Optimization opportunity:** The shell tool's description parameter description is quite large (~350 bytes) and could potentially be condensed

## Implementation Details

### How Tool Descriptions are Loaded

```typescript
// packages/opencode/src/tool/read.ts
import DESCRIPTION from "./read.txt"
export const ReadTool = Tool.define("read", ...)
```

All `.txt` files in `packages/opencode/src/tool/` are imported directly and included in tool definitions.

### Shell Tool Description Building

```typescript
// packages/opencode/src/tool/shell/prompt.ts
const descriptions = {
  bash: "Clear, concise description... [350+ bytes]",
  powershell: "...",
  cmd: "..."
}

export function parameterSchema(description: string) {
  return Schema.Struct({
    description: Schema.String.annotate({ description })
    // ^-- This description itself is 350+ bytes!
  })
}
```

### System Prompt Injection

```typescript
// packages/opencode/src/session/system.ts
environment: (model) => [
  `You are powered by the model named ${model.api.id}...`,
  `<env>...`,
]

skills: (agent) => 
  `Skills provide specialized instructions...
   ${Skill.fmt(list, { verbose: true })}`
```

## Files Referenced

- `/home/rryando/Work/fork/opencode/packages/opencode/src/tool/*.txt` - Tool descriptions
- `/home/rryando/Work/fork/opencode/packages/opencode/src/tool/shell/shell.txt` - Shell template
- `/home/rryando/Work/fork/opencode/packages/opencode/src/tool/shell/prompt.ts` - Parameter schemas
- `/home/rryando/Work/fork/opencode/packages/opencode/src/session/system.ts` - System prompt sections

## Generated Files

Two analysis documents have been created:

1. **llm_payload_analysis.md** - Comprehensive analysis with all content
2. **tool_descriptions_complete.txt** - Complete verbatim tool descriptions
