<img src="lisa-banner.png" alt="Lisa Logo" width="1000" />

# Lisa Plugin

**Lisa plans. Ralph does.**

Interactive specification interview workflow for Claude Code that conducts in-depth feature interviews and generates comprehensive specs. Use with [ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) for a complete planning-to-implementation workflow.

## Overview

Based on the technique described by [@trq212](https://twitter.com/trq212):

> My favorite way to use Claude Code to build large features is spec based. Start with a minimal spec or prompt and ask Claude to interview you using the AskUserQuestion tool about literally anything: technical implementation, UI & UX, concerns, tradeoffs, etc. Then make a new session to execute the spec.

This plugin automates that workflow with a Stop hook that ensures Claude continues interviewing until you explicitly say "done".

## Installation

```bash
# Add the marketplace
/plugin marketplace add blencorp/lisa

# Install the plugin
/plugin install lisa
```

## Commands

### `/lisa:plan <FEATURE_NAME> [OPTIONS]`

Start a specification interview for a feature.

**Arguments:**
- `FEATURE_NAME` (required) - Name of the feature to spec out

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--context <file>` | Initial context file (PRD, requirements, etc.) | none |
| `--output-dir <dir>` | Output directory for generated specs | `docs/specs` |
| `--max-questions <n>` | Maximum question rounds (0 = unlimited) | `0` |
| `--first-principles` | Challenge assumptions before detailed spec gathering | `false` |
| `-h, --help` | Show help | - |

**Examples:**

```bash
# Basic interview
/lisa:plan "user authentication"

# With existing context
/lisa:plan "payment processing" --context docs/PRD.md

# Custom output location
/lisa:plan "search feature" --output-dir specs/features

# Limit to 15 questions
/lisa:plan "caching layer" --max-questions 15

# Challenge assumptions first
/lisa:plan "new dashboard" --first-principles

# Combined options
/lisa:plan "api gateway" --context docs/arch.md --first-principles --max-questions 20
```

### `/lisa:help`

Display help documentation about the Lisa workflow.

## Output Files

Lisa generates three files when the interview is finalized:

| File | Location | Description |
|------|----------|-------------|
| Markdown PRD | `{output-dir}/{feature-slug}.md` | Human-readable specification |
| Structured JSON | `{output-dir}/{feature-slug}.json` | Machine-readable spec for tooling |
| Progress File | `{output-dir}/{feature-slug}-progress.txt` | Empty file for Ralph to track learnings |

**Example:** For `/lisa:plan "user authentication"`:
- `docs/specs/user-authentication.md`
- `docs/specs/user-authentication.json`
- `docs/specs/user-authentication-progress.txt`

### JSON Structure

The JSON output follows the [snarktank/ralph](https://github.com/snarktank/ralph) format:

```json
{
  "project": "user-authentication",
  "branchName": "ralph/user-authentication",
  "description": "User authentication with email/password and OAuth",
  "userStories": [
    {
      "id": "US-001",
      "category": "setup",
      "title": "Database schema for users",
      "description": "As a developer, I want user tables created so that I can store credentials",
      "acceptanceCriteria": [
        "Migration creates users table with id, email, password_hash columns",
        "Unique constraint on email column",
        "npm run migrate completes without errors"
      ],
      "passes": false,
      "notes": ""
    }
  ]
}
```

**Category values:**
- `setup` - Initial setup, configuration, scaffolding
- `core` - Core feature functionality
- `integration` - Connecting with other systems
- `polish` - UI refinements, error handling, edge cases

## How It Works

1. **Initialization**: Creates state file (`.claude/lisa.local.md`) and draft spec (`.claude/lisa-draft.md`)

2. **Interview Loop**:
   - Claude asks probing questions using `AskUserQuestion` tool
   - When Claude tries to stop, the Stop hook intercepts and continues
   - Draft spec updated every 2-3 questions
   - Questions adapt based on your answers

3. **Completion Detection**: When you say "done", "finalize", "finished", "that's all", "complete", or "wrap up"

4. **Finalization**: Generates all three output files (`.md`, `.json`, `-progress.txt`)

## Interview Coverage

The interview systematically covers:

### Scope Definition
- What is explicitly OUT of scope?
- MVP vs full vision boundaries
- Related features to avoid touching

### User Stories
- Discrete stories completable in one coding session
- **Verifiable** acceptance criteria (not vague)
  - Good: "API returns 200 for valid input", "Response < 200ms"
  - Bad: "Works correctly", "Is fast", "Handles errors"

### Technical Implementation
- Data models and storage
- API design (endpoints, methods, auth)
- Integration with existing systems
- Error handling and edge cases

### User Experience
- User flows and journeys
- Edge cases and error states
- Accessibility considerations

### Trade-offs
- Performance requirements
- Security considerations
- Scalability expectations

### Implementation Phases
- 2-4 incremental phases
- Verification command for each phase
- Minimum viable first phase

## First Principles Mode

Use `--first-principles` to challenge assumptions before diving into details:

```bash
/lisa:plan "new feature" --first-principles
```

**Phase 1 - Challenge the Approach (3-5 questions):**
- "What specific problem have you observed that led to this idea?"
- "What happens if we don't build this at all?"
- "What's the absolute simplest thing that might solve this?"
- "What would have to be true for this to be the wrong approach?"
- "Is there an existing solution we could use instead?"

**Phase 2 - Detailed Spec:** Only proceeds after validating the approach is sound.

## Runtime Files

During an interview:

| File | Purpose |
|------|---------|
| `.claude/lisa.local.md` | Interview state (iteration count, paths, settings) |
| `.claude/lisa-draft.md` | Running draft spec updated throughout |

## Canceling an Interview

```bash
rm .claude/lisa.local.md
```

## Complete Workflow: Lisa + Ralph

```
┌─────────────────┐     ┌─────────────────┐
│   Lisa Plans    │ ──> │   Ralph Does    │
│                 │     │                 │
│ /lisa:plan      │     │ /ralph-loop     │
│ "my feature"    │     │                 │
└─────────────────┘     └─────────────────┘
        │                       │
        v                       v
  ┌───────────┐          ┌───────────┐
  │ .md spec  │          │ Working   │
  │ .json     │          │ Code      │
  │ progress  │          │           │
  └───────────┘          └───────────┘
```

1. **Lisa plans** - Generate comprehensive spec:
   ```bash
   /lisa:plan "my feature"
   ```

2. **Ralph does** - Implement iteratively:
   ```bash
   /ralph-loop
   ```

The generated spec includes a pre-formatted Ralph Loop command with phases and verification steps.

## Local Development

To develop and test the plugin locally:

```bash
# Run Claude Code with the plugin loaded from local directory
cc --plugin-dir /path/to/lisa

# Example: if you cloned the repo to ~/projects/lisa
cc --plugin-dir ~/projects/lisa
```

This allows you to:
- Test changes immediately without reinstalling
- Verify skill discovery and trigger phrases
- Debug hook behavior and command execution

### Development Workflow

1. Make changes to plugin files (commands, hooks, scripts)
2. Start a new Claude Code session with `--plugin-dir`
3. Test the changes by running `/lisa:plan "test feature"`
4. Iterate until satisfied
5. Commit and push to publish updates

## Plugin Structure

```
lisa/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata (name, version, author)
├── commands/
│   ├── plan.md              # Main command (/lisa:plan)
│   └── help.md              # Help documentation (/lisa:help)
├── hooks/
│   ├── hooks.json           # Hook registration (stop hook)
│   └── stop-hook.sh         # Interview continuation logic
├── scripts/
│   └── setup-lisa.sh        # Interview initialization
└── README.md
```

## Version

- **Version:** 1.0.7
- **Author:** BLEN Engineering Team

---

Built with love by [BLEN, Inc](https://www.blencorp.com).

## About BLEN

BLEN, Inc is a digital services company that provides Emerging Technology (ML/AI, RPA), Digital Modernization (Legacy to Cloud), and Human-Centered Web/Mobile Design and Development.
