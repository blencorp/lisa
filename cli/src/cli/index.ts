#!/usr/bin/env node
/**
 * Lisa CLI - AI-Powered Planning Interview Tool
 * CLI entry point
 */

import { Command } from 'commander';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { VERSION } from '../index.js';

export interface CLIOptions {
  resume?: boolean;
  firstPrinciples?: boolean;
  context?: string[];
  provider?: string;
}

export interface CLIResult {
  action: 'interview' | 'resume' | 'error';
  feature?: string;
  options: CLIOptions;
}

/**
 * Example usage strings for help output
 */
export const EXAMPLES = `
Examples:
  $ lisa "user authentication system"
      Start a new interview to plan a user authentication feature

  $ lisa "payment processing" --provider claude
      Use Claude as the AI provider for the interview

  $ lisa "API refactoring" --context docs/api-spec.md
      Include reference documentation in the AI context

  $ lisa "dashboard redesign" --context design.md requirements.txt
      Include multiple reference files

  $ lisa "new feature" --first-principles
      Start with foundational questions before detailed planning

  $ lisa --resume
      Continue a previously interrupted interview session
`;

/**
 * Detailed description for the CLI
 */
export const DESCRIPTION = `AI-Powered Planning Interview Tool

Lisa conducts interactive interviews with AI assistants to help you plan
software features. Through a series of guided questions, Lisa generates
comprehensive Product Requirements Documents (PRDs) in both Markdown and
JSON formats.

Output files are saved to ./lisa/ directory:
  - {slug}.md   - Human-readable PRD in Markdown format
  - {slug}.json - Machine-readable PRD for programmatic use`;

export function createProgram(): Command {
  const program = new Command();

  program
    .name('lisa')
    .description(DESCRIPTION)
    .version(VERSION, '-v, --version', 'Display the current version')
    .argument('[feature]', 'Feature description to plan (e.g., "user authentication")')
    .option(
      '-r, --resume',
      'Resume a previously interrupted interview session from ./lisa/state.yaml'
    )
    .option(
      '-f, --first-principles',
      'Begin with foundational questions that challenge assumptions before detailed planning'
    )
    .option(
      '-c, --context <files...>',
      'Reference documents to include in AI context (supports multiple files)'
    )
    .option(
      '-p, --provider <name>',
      'AI provider to use: claude, opencode, cursor, codex, copilot (default: claude)',
      'claude'
    )
    .addHelpText('after', EXAMPLES)
    .showHelpAfterError('(use --help for available options)');

  return program;
}

export function runCLI(argv: string[] = process.argv): CLIResult {
  const program = createProgram();

  let result: CLIResult = {
    action: 'error',
    options: {},
  };

  program.action((feature: string | undefined, options: CLIOptions) => {
    if (options.resume) {
      result = {
        action: 'resume',
        options,
      };
      console.log('Resuming previous interview session...');
      return;
    }

    if (!feature) {
      console.error('Error: Please provide a feature description or use --resume');
      console.error('Usage: lisa "feature description"');
      result = {
        action: 'error',
        options,
      };
      return;
    }

    result = {
      action: 'interview',
      feature,
      options,
    };
    console.log(`Starting interview for: ${feature}`);
  });

  program.parse(argv);
  return result;
}

/**
 * Get the full help text output
 * Useful for testing and programmatic access
 */
export function getHelpText(): string {
  const program = createProgram();
  return program.helpInformation();
}

/**
 * Available AI providers
 */
export const PROVIDERS = ['claude', 'opencode', 'cursor', 'codex', 'copilot'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/**
 * Check if a string is a valid provider name
 */
export function isValidProvider(name: string): name is ProviderName {
  return PROVIDERS.includes(name as ProviderName);
}

// Only run if this is the main module
// Use realpathSync to handle symlinks (e.g., when installed globally via npm)
function isMain(): boolean {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const executedFile = realpathSync(process.argv[1]);
    return currentFile === executedFile;
  } catch {
    return false;
  }
}

if (isMain()) {
  runCLI();
}
