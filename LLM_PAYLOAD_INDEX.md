# LLM Payload Analysis - Complete Index

## Overview

This directory contains comprehensive documentation of exactly what gets sent to the LLM on a simple "meow" message, including all tool descriptions, parameter schemas, and system prompt sections.

## Generated Documents

### 1. FINDINGS_SUMMARY.md (This is the best starting point)
**Quick overview of what gets sent to the LLM**

- Total token cost: ~2,200-2,600 tokens
- Breakdown by component with exact byte counts
- Token-heavy elements identified
- Key observations and optimization opportunities
- Implementation details showing where things are loaded

**Start here for the executive summary.**

### 2. llm_payload_analysis.md
**Comprehensive technical analysis with all content**

Includes:
- Complete content of all 8 tool description files
- Shell tool description (templated)
- Parameter schemas for Read and Shell tools
- System prompt injection code
- Total token cost breakdown with detailed table
- Key parameter schema characteristics
- Token-heavy elements analysis
- Implementation notes

**Use this for detailed reference on specific components.**

### 3. tool_descriptions_complete.txt
**Verbatim tool descriptions sent to the LLM**

Word-for-word content of:
- read.txt (1,158 bytes)
- edit.txt (1,369 bytes)
- glob.txt (545 bytes)
- grep.txt (689 bytes)
- write.txt (623 bytes)
- task.txt (881 bytes)
- todowrite.txt (911 bytes)
- skill.txt (399 bytes)
- shell.txt template and rendered output

**Copy/paste source for exact tool descriptions.**

### 4. PARAMETER_SCHEMAS_REFERENCE.md
**Detailed parameter schema definitions**

For each tool, shows:
- Exact file location and line numbers
- TypeScript schema definition
- JSON Schema that gets sent to LLM
- Parameter count and descriptions
- Token cost per tool
- How schemas are converted and used

**Use this for understanding parameter overhead.**

### 5. LLM_PAYLOAD_INDEX.md (this file)
**Navigation guide for all generated documentation**

---

## Quick Facts

- **Total context overhead per message:** ~2,200-2,600 tokens
- **User message ratio:** Your "meow" is 0.8% of tokens sent
- **Biggest component:** Tool descriptions (1,640 tokens / 6,575 bytes)
- **Most expensive tool:** Shell tool (800 bytes schema + 900 bytes guidance)
- **Total parameters across all tools:** 22 parameters
- **Files in tool directory:** 8 `.txt` files + 1 shell template

---

## Where Things Live in Source Code

### Tool Description Files
```
packages/opencode/src/tool/*.txt
├── read.txt
├── edit.txt
├── glob.txt
├── grep.txt
├── write.txt
├── task.txt
├── todowrite.txt
├── skill.txt
└── shell/
    └── shell.txt (template)
```

### Parameter Schemas
```
packages/opencode/src/tool/
├── read.ts (lines 29-37)
├── edit.ts
├── glob.ts
├── grep.ts
├── write.ts
├── task.ts
├── skill.ts (lines 10-12)
└── shell/
    └── prompt.ts (lines 22-31, 33)
```

### System Prompt Sections
```
packages/opencode/src/session/system.ts
├── lines 28-42   (environment section)
└── lines 45-57   (skills section)
```

---

## Token Cost Breakdown

| Component | Bytes | Tokens | % of Total |
|-----------|-------|--------|-----------|
| Tool descriptions | 6,575 | 1,640 | 75% |
| Shell template | 1,200-2,000 | 300-500 | 14-23% |
| Parameter schemas | 800-1,200 | 200-300 | 9-14% |
| Environment section | 200-300 | 50-75 | 2-3% |
| Skills section | 0-2,000 | 0-500 | 0-23% |
| **Your message** | **50** | **20** | **0.8%** |
| **TOTAL** | **~10,000-11,500** | **~2,200-2,600** | **100%** |

---

## Most Token-Expensive Elements (Priority Order)

1. **Tool description text** (~1,640 tokens)
   - Loaded from 8 `.txt` files
   - Edit.txt is longest (1,369 bytes)
   - Read.txt is second longest (1,158 bytes)
   - Could potentially be condensed

2. **Shell command guidance** (~300-500 tokens)
   - Part of rendered shell template
   - ~900 bytes of detailed instructions
   - Directory verification, quoting rules, chaining instructions

3. **Shell description parameter** (~200 tokens just for parameter description)
   - The "description" field itself has a 350-byte description
   - Contains multi-line examples for bash/PowerShell/cmd
   - Repeated for each shell variant

4. **Parameter schemas** (~200-300 tokens)
   - JSON schemas for all 22 parameters
   - Parameter descriptions are inline

5. **Skills section** (0-500 tokens, variable)
   - Only included if skills are available/enabled
   - Lists available skills with verbose descriptions

---

## Key Insights

### Token Efficiency
- Your message is only 0.8% of total tokens - 99.2% is context
- This is necessary for the agent to understand available tools
- Most context is fixed overhead that doesn't change per message

### What's Variable
- **Skills section** (0-500 tokens) - depends on available skills
- **Shell template** rendered values - changes based on environment
- System environment info - minimal variability (~50-75 tokens)

### What's Fixed
- Tool descriptions (6,575 bytes, always sent)
- Parameter schemas (800-1,200 bytes, always sent)
- Basic system prompt (~200 bytes)

### Optimization Opportunities
1. Shell tool's description parameter description (350 bytes) could be condensed
2. Tool descriptions could be summarized if token budget is tight
3. Shell command section could be shortened with careful wording
4. Some tool descriptions have redundant guidance

---

## How to Use These Documents

**If you want to:**

- Understand the big picture → Start with **FINDINGS_SUMMARY.md**
- See exact tool descriptions → Read **tool_descriptions_complete.txt**
- Understand parameter overhead → Check **PARAMETER_SCHEMAS_REFERENCE.md**
- Get comprehensive technical details → Review **llm_payload_analysis.md**
- Find source code locations → See file paths in **PARAMETER_SCHEMAS_REFERENCE.md**

---

## Technical Details

### Tool Description Loading
```typescript
// packages/opencode/src/tool/read.ts
import DESCRIPTION from "./read.txt"
export const ReadTool = Tool.define("read", ...)
```

All `.txt` files are imported and included in tool definitions.

### Schema to JSON Schema Conversion
```typescript
// Effect schema
Schema.String.annotate({ description: "..." })

// Converts to JSON Schema
{
  "type": "string",
  "description": "..."
}
```

### System Prompt Injection
```typescript
// packages/opencode/src/session/system.ts
environment: (model) => [
  `You are powered by the model named ${model.api.id}...`,
  `<env>...`
]

skills: (agent) => {
  const list = yield* skill.available(agent)
  return `Skills provide...\n${Skill.fmt(list, { verbose: true })}`
}
```

---

## About This Analysis

Generated: May 29, 2026
Analyzed in: `/home/rryando/Work/fork/opencode`
Repository: `@opencode-ai/opencode`

This analysis traces exactly what gets sent to the LLM:
1. All tool `.txt` description files (6,575 bytes)
2. Shell template rendering (1,200-2,000 bytes)
3. Parameter schemas for each tool (800-1,200 bytes)
4. System prompt sections (200-2,300 bytes)
5. Your message (50 bytes)

Total: ~2,200-2,600 tokens sent before the LLM can process your input.

---

## Related Files in Codebase

- `packages/opencode/src/tool/tool.ts` - Tool framework
- `packages/opencode/src/tool/registry.ts` - Tool registration
- `packages/opencode/src/session/instruction.ts` - Instruction handling
- `packages/opencode/src/provider/provider.ts` - Model configuration
- `packages/opencode/src/skill/skill.ts` - Skill management

---

## Notes

All paths are relative to `/home/rryando/Work/fork/opencode/`.

For any questions about specific token costs or implementation details, refer to the line numbers specified in PARAMETER_SCHEMAS_REFERENCE.md.
