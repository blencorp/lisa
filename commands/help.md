---
description: "Explain the lisa-plan workflow"
---

# Lisa Plan Help

Please explain the following to the user:

## What is Lisa Plan?

**Lisa plans. Ralph does.**

Lisa Plan is an interactive specification gathering workflow that conducts in-depth feature interviews using the AskUserQuestion tool and generates comprehensive technical specifications. Use it with [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) for a complete planning-to-implementation workflow.

Based on the technique described by @trq212: Start with a minimal spec, have Claude interview you about technical implementation, UI/UX, concerns, and trade-offs, then generate a complete specification.

**Key Features:**
- Adaptive questioning based on responses
- Non-obvious, in-depth questions covering technical, UX, and trade-off considerations
- Continuous interview until you say "done" or "finalize"
- Running draft maintained throughout
- Final spec output in structured markdown format

## Available Commands

### /lisa-plan <FEATURE_NAME> [OPTIONS]

Start a specification interview for a feature.

**Usage:**
```
/lisa-plan "user authentication"
/lisa-plan "payment processing" --context docs/PRD.md
/lisa-plan "search feature" --output-dir specs/features --max-questions 20
```

**Options:**
- `--context <file>` - Initial context file (PRD, requirements, etc.)
- `--output-dir <dir>` - Output directory for specs (default: docs/specs)
- `--max-questions <n>` - Maximum question rounds (default: unlimited)

### /lisa-plan:help

Show this help message.

## Interview Flow

1. **Initialization** - Creates state file and draft spec
2. **Interview** - Asks non-obvious questions via AskUserQuestion tool
3. **Draft Updates** - Maintains running draft every 2-3 questions
4. **Finalization** - When you say "done" or "finalize", writes final spec

## Question Types

The interview covers:

- **Technical Implementation** - Data models, APIs, auth, error handling, integration
- **User Experience** - Flows, edge cases, accessibility, error states
- **Trade-offs** - Performance, security, scalability, MVP scope, technical debt

## Output

- **Draft (during interview):** `.claude/lisa-plan-draft.md`
- **Final spec:** `docs/specs/{feature-slug}.md`

## Example Session

```
You: /lisa-plan "file upload feature"
Claude: [Asks about file types, size limits, storage backend via AskUserQuestion]
You: [Answers]
Claude: [Asks about virus scanning, thumbnail generation]
You: [Answers]
Claude: [Asks about error handling, retry logic]
You: done
Claude: [Writes final spec to docs/specs/file-upload-feature.md]
```

## Canceling an Interview

To cancel an active interview, delete the state file:
```bash
rm .claude/lisa-plan.local.md
```

## Using the Spec

After the interview completes, use the spec in a new Claude session:
```bash
cat docs/specs/your-feature.md | claude
# Or: "Read docs/specs/your-feature.md and implement it"
```

## Complete Workflow: Lisa + Ralph

1. **Lisa plans** - Generate comprehensive spec: `/lisa-plan "my feature"`
2. **Ralph does** - Implement iteratively: `/ralph-loop`

Lisa plans. Ralph does. Ship faster.
