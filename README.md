# Lisa Plan Plugin

**Lisa plans. Ralph does.**

Interactive specification interview workflow for Claude Code that conducts in-depth feature interviews and generates comprehensive specs. Use with [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) for a complete planning-to-implementation workflow.

## Overview

Based on the technique described by [@trq212](https://twitter.com/trq212):

> My favorite way to use Claude Code to build large features is spec based. Start with a minimal spec or prompt and ask Claude to interview you using the AskUserQuestion tool about literally anything: technical implementation, UI & UX, concerns, tradeoffs, etc. Then make a new session to execute the spec.

This plugin automates that workflow with a Stop hook that ensures Claude continues interviewing until you explicitly say "done".

## Usage

```bash
# Start an interview
/lisa-plan "user authentication"

# With context file
/lisa-plan "payment processing" --context docs/PRD.md

# With custom output directory
/lisa-plan "search feature" --output-dir specs/features

# With question limit
/lisa-plan "caching layer" --max-questions 15
```

## How It Works

1. **Initialization**: Creates state file and draft spec template
2. **Interview Loop**:
   - Claude asks questions using `AskUserQuestion` tool
   - When Claude tries to stop, the Stop hook intercepts
   - The same interview prompt is fed back, continuing the loop
3. **Completion Detection**: When you say "done", "finalize", etc., the hook detects this and triggers finalization
4. **Output**: Final spec written to `docs/specs/{feature-slug}.md`

## Files

```
.claude/plugins/lisa-plan/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/
│   ├── lisa-plan.md         # Main command
│   └── help.md              # Help documentation
├── hooks/
│   ├── hooks.json           # Hook registration
│   └── stop-hook.sh         # Interview continuation logic
├── scripts/
│   └── setup-lisa-plan.sh
└── README.md
```

## Runtime Files

During an interview, these files are created:

- `.claude/lisa-plan.local.md` - Interview state (delete to cancel)
- `.claude/lisa-plan-draft.md` - Running draft spec

## Canceling an Interview

```bash
rm .claude/lisa-plan.local.md
```

## Using the Generated Spec

In a new Claude session:

```bash
# Option 1: Pipe the spec
cat docs/specs/your-feature.md | claude

# Option 2: Reference in prompt
"Read docs/specs/your-feature.md and implement it step by step"
```

## Complete Workflow: Lisa + Ralph

1. **Lisa plans** - Generate comprehensive spec: `/lisa-plan "my feature"`
2. **Ralph does** - Implement iteratively: `/ralph-loop`

Lisa plans. Ralph does. Ship faster.

## Question Types

The interview covers:

- **Technical**: Data models, APIs, authentication, error handling
- **UX**: User flows, edge cases, accessibility
- **Trade-offs**: Performance, security, scalability, MVP scope
