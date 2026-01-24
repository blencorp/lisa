import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProgram,
  runCLI,
  getHelpText,
  EXAMPLES,
  DESCRIPTION,
  PROVIDERS,
  isValidProvider,
} from './index.js';
import { VERSION } from '../index.js';

describe('createProgram', () => {
  it('creates a Commander program with correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('lisa');
  });

  it('has the correct version', () => {
    const program = createProgram();
    expect(program.version()).toBe(VERSION);
  });

  it('has the correct description', () => {
    const program = createProgram();
    const description = program.description();
    expect(description).toContain('AI-Powered Planning Interview Tool');
    expect(description).toContain('Lisa conducts interactive interviews');
    expect(description).toContain('Product Requirements Documents');
  });

  it('defines the feature argument', () => {
    const program = createProgram();
    const args = program.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0].name()).toBe('feature');
    expect(args[0].required).toBe(false);
  });

  it('defines --resume option', () => {
    const program = createProgram();
    const option = program.options.find(opt => opt.long === '--resume');
    expect(option).toBeDefined();
  });

  it('defines --first-principles option', () => {
    const program = createProgram();
    const option = program.options.find(opt => opt.long === '--first-principles');
    expect(option).toBeDefined();
  });

  it('defines --context option', () => {
    const program = createProgram();
    const option = program.options.find(opt => opt.long === '--context');
    expect(option).toBeDefined();
  });

  it('defines --provider option', () => {
    const program = createProgram();
    const option = program.options.find(opt => opt.long === '--provider');
    expect(option).toBeDefined();
  });

  it('has --version with -v alias', () => {
    const program = createProgram();
    const option = program.options.find(
      opt => opt.long === '--version' && opt.short === '-v'
    );
    expect(option).toBeDefined();
    expect(option?.description).toBe('Display the current version');
  });

  it('includes detailed description', () => {
    const program = createProgram();
    const description = program.description();
    expect(description).toContain('AI-Powered Planning Interview Tool');
    expect(description).toContain('interactive interviews');
    expect(description).toContain('Product Requirements Documents');
    expect(description).toContain('./lisa/');
  });

  it('EXAMPLES constant demonstrates all features', () => {
    expect(EXAMPLES).toContain('Examples:');
    expect(EXAMPLES).toContain('lisa "user authentication system"');
    expect(EXAMPLES).toContain('--provider claude');
    expect(EXAMPLES).toContain('--context');
    expect(EXAMPLES).toContain('--first-principles');
    expect(EXAMPLES).toContain('--resume');
  });

  it('has clear descriptions for each option', () => {
    const program = createProgram();

    const resumeOpt = program.options.find(opt => opt.long === '--resume');
    expect(resumeOpt?.description).toContain('interrupted interview');
    expect(resumeOpt?.description).toContain('./lisa/state.yaml');

    const fpOpt = program.options.find(opt => opt.long === '--first-principles');
    expect(fpOpt?.description).toContain('foundational questions');
    expect(fpOpt?.description).toContain('challenge assumptions');

    const contextOpt = program.options.find(opt => opt.long === '--context');
    expect(contextOpt?.description).toContain('Reference documents');
    expect(contextOpt?.description).toContain('multiple files');

    const providerOpt = program.options.find(opt => opt.long === '--provider');
    expect(providerOpt?.description).toContain('claude');
    expect(providerOpt?.description).toContain('opencode');
    expect(providerOpt?.description).toContain('cursor');
    expect(providerOpt?.description).toContain('codex');
    expect(providerOpt?.description).toContain('copilot');
  });

  it('has argument description with example', () => {
    const program = createProgram();
    const args = program.registeredArguments;
    expect(args[0].description).toContain('Feature description');
    expect(args[0].description).toContain('user authentication');
  });
});

describe('runCLI', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('parses feature description from arguments', () => {
    const result = runCLI(['node', 'lisa', 'add user authentication']);

    expect(result.action).toBe('interview');
    expect(result.feature).toBe('add user authentication');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Starting interview for: add user authentication'
    );
  });

  it('handles --resume flag', () => {
    const result = runCLI(['node', 'lisa', '--resume']);

    expect(result.action).toBe('resume');
    expect(result.options.resume).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Resuming previous interview session...'
    );
  });

  it('returns error when no feature provided and no --resume', () => {
    const result = runCLI(['node', 'lisa']);

    expect(result.action).toBe('error');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error: Please provide a feature description or use --resume'
    );
  });

  it('parses --first-principles flag', () => {
    const result = runCLI(['node', 'lisa', 'feature', '--first-principles']);

    expect(result.options.firstPrinciples).toBe(true);
  });

  it('parses --provider option', () => {
    const result = runCLI(['node', 'lisa', 'feature', '--provider', 'claude']);

    expect(result.options.provider).toBe('claude');
  });

  it('parses --context option with multiple files', () => {
    const result = runCLI([
      'node',
      'lisa',
      'feature',
      '--context',
      'file1.md',
      'file2.md',
    ]);

    expect(result.options.context).toEqual(['file1.md', 'file2.md']);
  });

  it('parses multiple options together', () => {
    const result = runCLI([
      'node',
      'lisa',
      'build payment system',
      '--first-principles',
      '--provider',
      'opencode',
      '--context',
      'spec.md',
    ]);

    expect(result.action).toBe('interview');
    expect(result.feature).toBe('build payment system');
    expect(result.options.firstPrinciples).toBe(true);
    expect(result.options.provider).toBe('opencode');
    expect(result.options.context).toEqual(['spec.md']);
  });

  it('uses default provider when not specified', () => {
    const result = runCLI(['node', 'lisa', 'some feature']);

    expect(result.options.provider).toBe('claude');
  });
});

describe('EXAMPLES', () => {
  it('is a non-empty string', () => {
    expect(typeof EXAMPLES).toBe('string');
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it('contains usage examples with $ lisa prefix', () => {
    expect(EXAMPLES).toContain('$ lisa');
  });

  it('demonstrates all major features', () => {
    expect(EXAMPLES).toContain('user authentication');
    expect(EXAMPLES).toContain('--provider');
    expect(EXAMPLES).toContain('--context');
    expect(EXAMPLES).toContain('--first-principles');
    expect(EXAMPLES).toContain('--resume');
  });

  it('includes descriptions for each example', () => {
    expect(EXAMPLES).toContain('Start a new interview');
    expect(EXAMPLES).toContain('Use Claude as the AI provider');
    expect(EXAMPLES).toContain('Include reference documentation');
    expect(EXAMPLES).toContain('Continue a previously interrupted');
  });
});

describe('DESCRIPTION', () => {
  it('is a non-empty string', () => {
    expect(typeof DESCRIPTION).toBe('string');
    expect(DESCRIPTION.length).toBeGreaterThan(0);
  });

  it('explains what Lisa does', () => {
    expect(DESCRIPTION).toContain('AI-Powered Planning Interview Tool');
    expect(DESCRIPTION).toContain('interactive interviews');
  });

  it('mentions output formats', () => {
    expect(DESCRIPTION).toContain('Markdown');
    expect(DESCRIPTION).toContain('JSON');
  });

  it('explains output location', () => {
    expect(DESCRIPTION).toContain('./lisa/');
    expect(DESCRIPTION).toContain('{slug}.md');
    expect(DESCRIPTION).toContain('{slug}.json');
  });
});

describe('PROVIDERS', () => {
  it('contains all supported providers', () => {
    expect(PROVIDERS).toContain('claude');
    expect(PROVIDERS).toContain('opencode');
    expect(PROVIDERS).toContain('cursor');
    expect(PROVIDERS).toContain('codex');
    expect(PROVIDERS).toContain('copilot');
  });

  it('has exactly 5 providers', () => {
    expect(PROVIDERS.length).toBe(5);
  });

  it('is a const array', () => {
    // TypeScript's "as const" creates a readonly tuple type
    // This is compile-time readonly, not runtime frozen
    expect(Array.isArray(PROVIDERS)).toBe(true);
  });
});

describe('isValidProvider', () => {
  it('returns true for valid providers', () => {
    expect(isValidProvider('claude')).toBe(true);
    expect(isValidProvider('opencode')).toBe(true);
    expect(isValidProvider('cursor')).toBe(true);
    expect(isValidProvider('codex')).toBe(true);
    expect(isValidProvider('copilot')).toBe(true);
  });

  it('returns false for invalid providers', () => {
    expect(isValidProvider('invalid')).toBe(false);
    expect(isValidProvider('')).toBe(false);
    expect(isValidProvider('gpt4')).toBe(false);
    expect(isValidProvider('CLAUDE')).toBe(false);
  });
});

describe('getHelpText', () => {
  it('returns help text as a string', () => {
    const helpText = getHelpText();
    expect(typeof helpText).toBe('string');
    expect(helpText.length).toBeGreaterThan(0);
  });

  it('includes program name', () => {
    const helpText = getHelpText();
    expect(helpText).toContain('lisa');
  });

  it('includes all options', () => {
    const helpText = getHelpText();
    expect(helpText).toContain('--resume');
    expect(helpText).toContain('--first-principles');
    expect(helpText).toContain('--context');
    expect(helpText).toContain('--provider');
    expect(helpText).toContain('--version');
    expect(helpText).toContain('--help');
  });

  it('includes usage section', () => {
    const helpText = getHelpText();
    expect(helpText).toContain('Usage:');
  });

  it('includes options section', () => {
    const helpText = getHelpText();
    expect(helpText).toContain('Options:');
  });

  it('shows help for command option', () => {
    const helpText = getHelpText();
    expect(helpText).toContain('--help');
    expect(helpText).toContain('display help for command');
  });
});
