# Lisa CLI

AI-Powered Planning Interview Tool - Generate PRDs through interactive AI interviews.

Lisa is a command-line tool that conducts structured interviews with AI assistants to help you plan software features. It guides you through a series of questions about your feature idea and generates comprehensive Product Requirements Documents (PRDs) in both Markdown and JSON formats.

## Features

- **Interactive AI Interviews**: Lisa uses AI assistants (Claude, OpenCode, Cursor, Codex, or Copilot) to conduct structured planning interviews
- **Multiple AI Provider Support**: Works with Claude Code, OpenCode, Cursor, Codex, and GitHub Copilot
- **Smart Codebase Exploration**: Automatically analyzes your project structure to provide context-aware questions
- **Context File Support**: Include reference documents to inform the AI about existing specifications
- **First Principles Mode**: Challenge assumptions with foundational questions before detailed planning
- **Resume Capability**: Interrupted interviews can be resumed from where you left off
- **Dual Output Formats**: Generates both Markdown (human-readable) and JSON (machine-readable) PRDs

## Installation

```bash
npm install -g @blen/lisa
```

## Prerequisites

Lisa requires at least one AI CLI tool to be installed:

- **Claude Code**: `claude` CLI from Anthropic
- **OpenCode**: `opencode` CLI
- **Cursor**: `cursor` or `agent` CLI
- **Codex**: `codex` CLI
- **Copilot**: `gh` CLI with Copilot extension

## Usage

### Basic Usage

```bash
lisa "user authentication system"
```

This starts an interactive interview about the feature "user authentication system".

### With AI Provider Selection

```bash
lisa "feature description" --provider claude
lisa "feature description" --provider opencode
lisa "feature description" --provider cursor
lisa "feature description" --provider codex
lisa "feature description" --provider copilot
```

### With Context Files

Include reference documents to provide additional context:

```bash
# Single file
lisa "feature description" --context docs/spec.md

# Multiple files
lisa "feature description" --context docs/spec.md docs/api.md
```

### First Principles Mode

Start with foundational questions that challenge assumptions:

```bash
lisa "feature description" --first-principles
```

### Resume an Interrupted Interview

```bash
lisa --resume
```

## Command Reference

```
Usage: lisa [options] [feature]

Arguments:
  feature                          Feature description to plan (e.g., "user authentication")

Options:
  -v, --version                    Display the current version
  -r, --resume                     Resume a previously interrupted interview session
  -f, --first-principles           Begin with foundational questions that challenge assumptions
  -c, --context <files...>         Reference documents to include in AI context
  -p, --provider <name>            AI provider to use: claude, opencode, cursor, codex, copilot
  -h, --help                       Display help for command
```

## Output

Lisa generates PRD files in the `./lisa/` directory:

- `./lisa/{feature-slug}.md` - Markdown PRD with overview, user stories, and technical notes
- `./lisa/{feature-slug}.json` - JSON PRD for programmatic use

### Markdown Output Structure

```markdown
# Feature Name

**Generated:** YYYY-MM-DD

## Overview
[Feature overview and context]

## User Stories

### 1. Story Title
[Story description]

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

## Technical Notes
[Implementation considerations and technical details]
```

### JSON Output Structure

```json
{
  "$schema": "https://lisa-cli.dev/schemas/prd-v1.json",
  "version": "1.0",
  "metadata": {
    "slug": "feature-slug",
    "title": "Feature Name",
    "generatedAt": "2024-01-01T00:00:00.000Z",
    "generator": "lisa-cli"
  },
  "overview": "Feature overview...",
  "userStories": [
    {
      "id": 1,
      "title": "Story Title",
      "description": "Story description",
      "acceptanceCriteria": [
        { "id": 1, "text": "Criterion 1", "completed": false }
      ]
    }
  ],
  "technicalNotes": "Implementation notes..."
}
```

## Configuration

Lisa stores configuration in `./lisa/config.yaml`:

```yaml
# Lisa CLI Configuration
# Default AI provider (claude, opencode, cursor, codex, copilot)
defaultProvider: claude

# Output directory for generated PRDs
outputDirectory: ./lisa
```

## State Management

Interview progress is saved to `./lisa/state.yaml`, allowing you to:

- Resume interrupted interviews with `lisa --resume`
- Recover from network errors or crashes
- Continue multi-session planning work

State is automatically cleared after successful PRD generation.

## Programmatic Usage

Lisa can also be used as a library:

```typescript
import { runInterview, exploreCodebase, generateMarkdown } from '@blen/lisa';

// Explore codebase
const exploration = await exploreCodebase('/path/to/project');
console.log(exploration.summary);

// Generate PRD
const prd = {
  overview: 'Feature overview...',
  userStories: [...],
  technicalNotes: '...'
};
const markdown = generateMarkdown(prd, 'feature-slug');
```

## Supported File Types for Context

Lisa supports the following file types for `--context`:

- **Markdown**: `.md`, `.markdown`
- **Text**: `.txt`, `.text`
- **Code**: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`
- **Config**: `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.conf`
- **Web**: `.html`, `.css`, `.scss`, `.less`
- **Other**: `.xml`, `.sql`, `.graphql`, `.gql`, `.sh`, `.bash`, `.zsh`

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/blencorp/lisa.git
cd lisa/cli

# Install dependencies
npm install
```

### Running Locally

During development, use `npm run dev` to run the CLI directly without building:

```bash
# Run CLI with a feature description
npm run dev "user authentication system"

# With options
npm run dev "feature name" -- --provider claude --first-principles

# Resume an interrupted session
npm run dev -- --resume

# Show help
npm run dev -- --help
```

Note: Use `--` before CLI flags to pass them through npm to the script.

### Building

```bash
# Compile TypeScript to JavaScript
npm run build

# Output is written to ./dist/
```

### Type Checking

```bash
# Run TypeScript compiler without emitting files
npm run typecheck
```

### Linting

```bash
# Check for lint errors
npm run lint

# Auto-fix lint errors
npm run lint:fix
```

## Testing

Lisa uses [Vitest](https://vitest.dev/) as its test framework.

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch
```

### Test Structure

The test suite includes multiple types of tests:

| Type | Location | Description |
|------|----------|-------------|
| Unit | `src/**/*.test.ts` | Tests for individual modules (core, providers, utils) |
| Integration | `src/integration/` | Tests for interview flow with mocked providers |
| E2E | `src/e2e/` | Tests against real AI CLI providers |
| Snapshot | `src/core/prd.snapshot.test.ts` | Validates PRD output formats |

### Test Files Overview

```
src/
├── cli/
│   ├── index.test.ts          # CLI command parsing
│   └── prompt.test.ts         # Interactive prompts
├── core/
│   ├── orchestrator.test.ts   # Interview orchestration
│   ├── state.test.ts          # Session state persistence
│   ├── prd.test.ts            # PRD generation
│   ├── prd.snapshot.test.ts   # PRD output snapshots
│   ├── context.test.ts        # Context file loading
│   ├── exploration.test.ts    # Codebase analysis
│   ├── error-recovery.test.ts # Error handling
│   ├── config.test.ts         # Configuration management
│   └── interview.test.ts      # Interview wrapper
├── providers/
│   ├── claude.test.ts         # Claude provider
│   ├── opencode.test.ts       # OpenCode provider
│   ├── cursor.test.ts         # Cursor provider
│   ├── codex.test.ts          # Codex provider
│   ├── copilot.test.ts        # Copilot provider
│   └── index.test.ts          # Provider registry
├── utils/
│   └── index.test.ts          # Utility functions
├── integration/
│   └── interview.integration.test.ts
├── e2e/
│   └── interview.e2e.test.ts
└── package.test.ts            # NPM package validation
```

### Running Specific Tests

```bash
# Run a specific test file
npm test src/core/prd.test.ts

# Run tests matching a pattern
npm test -- --grep "orchestrator"

# Run tests with coverage
npm test -- --coverage
```

### Updating Snapshots

If you make intentional changes to PRD output formats:

```bash
npm test -- --update-snapshots
```

### E2E Tests

E2E tests require actual AI CLI tools to be installed. They test against real providers and are skipped if the required CLI is not available:

```bash
# E2E tests automatically skip if CLI tools are not installed
npm test src/e2e/
```

## Project Structure

```
lisa-cli/
├── src/
│   ├── index.ts              # Public API exports
│   ├── cli/                  # CLI interface (Commander.js, Inquirer)
│   ├── core/                 # Core logic (orchestrator, state, PRD generation)
│   ├── providers/            # AI provider implementations
│   └── utils/                # Utility functions
├── dist/                     # Compiled output
├── lisa/                     # Default output directory for PRDs
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## License

MIT
