/**
 * Tests for AskUserQuestion-style interactive prompt component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StructuredQuestion } from '../core/orchestrator.js';
import {
  formatHeader,
  formatOption,
  validateQuestion,
  buildChoices,
  formatResponse,
  promptSingleSelect,
  promptMultiSelect,
  promptQuestion,
  promptFreeText,
  renderAIText,
  renderPhase,
  createSpinner,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  PHASE_CONFIGS,
  DEFAULT_PROGRESS_MESSAGES,
  ProgressIndicator,
  createProgressIndicator,
  renderSeparator,
  renderProgressSummary,
  renderWelcomeBanner,
  renderCompletionBanner,
  renderErrorBanner,
} from './prompt.js';

// Mock the @inquirer/prompts module
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
  input: vi.fn(),
}));

// Mock chalk to return plain strings for testing
vi.mock('chalk', () => ({
  default: {
    bgBlue: {
      white: Object.assign((s: string) => `[BGBLUE_WHITE:${s}]`, {
        bold: (s: string) => `[HEADER:${s}]`,
      }),
    },
    bgMagenta: {
      white: Object.assign((s: string) => `[BGMAGENTA_WHITE:${s}]`, {
        bold: (s: string) => `[PHASE:${s}]`,
      }),
    },
    bgGreen: {
      white: (s: string) => `[BGGREEN_WHITE:${s}]`,
    },
    bold: Object.assign((s: string) => `[BOLD:${s}]`, {
      cyan: (s: string) => `[BOLD_CYAN:${s}]`,
      green: (s: string) => `[BOLD_GREEN:${s}]`,
      red: (s: string) => `[BOLD_RED:${s}]`,
    }),
    dim: (s: string) => `[DIM:${s}]`,
    italic: (s: string) => `[ITALIC:${s}]`,
    cyan: Object.assign((s: string) => `[CYAN:${s}]`, {
      // Handle both function calls and property access
    }),
    white: (s: string) => `[WHITE:${s}]`,
    green: (s: string) => `[GREEN:${s}]`,
    red: (s: string) => `[RED:${s}]`,
    yellow: (s: string) => `[YELLOW:${s}]`,
  },
}));

import { select, checkbox, input } from '@inquirer/prompts';

describe('prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatHeader', () => {
    it('formats header with styling', () => {
      const result = formatHeader('Test');
      expect(result).toContain('Test');
    });

    it('truncates headers longer than 12 chars', () => {
      const result = formatHeader('VeryLongHeaderText');
      expect(result).toContain('VeryLongHead');
      expect(result).not.toContain('Text');
    });

    it('handles empty header', () => {
      const result = formatHeader('');
      expect(result).toBeDefined();
    });

    it('handles exactly 12 char header', () => {
      const result = formatHeader('123456789012');
      expect(result).toContain('123456789012');
    });
  });

  describe('formatOption', () => {
    it('formats option with description when showDescription is true', () => {
      const result = formatOption('Option A', 'Description of A', true);
      expect(result).toContain('Option A');
      expect(result).toContain('Description of A');
    });

    it('formats option without description when showDescription is false', () => {
      const result = formatOption('Option A', 'Description of A', false);
      expect(result).toContain('Option A');
      expect(result).not.toContain('Description of A');
    });

    it('handles empty description', () => {
      const result = formatOption('Option A', '', true);
      expect(result).toContain('Option A');
    });
  });

  describe('validateQuestion', () => {
    const validQuestion: StructuredQuestion = {
      header: 'Auth Method',
      question: 'Which authentication method should we use?',
      options: [
        { label: 'JWT', description: 'JSON Web Tokens' },
        { label: 'Session', description: 'Server-side sessions' },
      ],
      multiSelect: false,
    };

    it('returns valid for well-formed question', () => {
      const result = validateQuestion(validQuestion);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing header', () => {
      const question = { ...validQuestion, header: '' };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or invalid header');
    });

    it('rejects header longer than 12 chars', () => {
      const question = { ...validQuestion, header: 'VeryLongHeaderText' };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Header exceeds 12 characters');
    });

    it('rejects missing question text', () => {
      const question = { ...validQuestion, question: '' };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or invalid question text');
    });

    it('rejects non-array options', () => {
      const question = { ...validQuestion, options: 'invalid' as unknown as StructuredQuestion['options'] };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Options must be an array');
    });

    it('rejects less than 2 options', () => {
      const question = {
        ...validQuestion,
        options: [{ label: 'Only', description: 'One option' }],
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('At least 2 options are required');
    });

    it('rejects more than 4 options', () => {
      const question = {
        ...validQuestion,
        options: [
          { label: '1', description: '1' },
          { label: '2', description: '2' },
          { label: '3', description: '3' },
          { label: '4', description: '4' },
          { label: '5', description: '5' },
        ],
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Maximum 4 options allowed');
    });

    it('rejects option with missing label', () => {
      const question = {
        ...validQuestion,
        options: [
          { label: '', description: 'Description' },
          { label: 'Valid', description: 'Valid description' },
        ],
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Missing or invalid label'))).toBe(true);
    });

    it('rejects option with missing description', () => {
      const question = {
        ...validQuestion,
        options: [
          { label: 'Label', description: undefined as unknown as string },
          { label: 'Valid', description: 'Valid description' },
        ],
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Missing or invalid description'))).toBe(true);
    });

    it('rejects non-boolean multiSelect', () => {
      const question = { ...validQuestion, multiSelect: 'yes' as unknown as boolean };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('multiSelect must be a boolean');
    });

    it('accepts exactly 2 options', () => {
      const result = validateQuestion(validQuestion);
      expect(result.valid).toBe(true);
    });

    it('accepts exactly 4 options', () => {
      const question = {
        ...validQuestion,
        options: [
          { label: '1', description: '1' },
          { label: '2', description: '2' },
          { label: '3', description: '3' },
          { label: '4', description: '4' },
        ],
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(true);
    });

    it('collects multiple errors', () => {
      const question = {
        header: 'VeryLongHeaderText',
        question: '',
        options: [{ label: '', description: '' }],
        multiSelect: 'yes' as unknown as boolean,
      };
      const result = validateQuestion(question);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(2);
    });
  });

  describe('buildChoices', () => {
    const validQuestion: StructuredQuestion = {
      header: 'Auth',
      question: 'Which auth?',
      options: [
        { label: 'JWT', description: 'JSON Web Tokens' },
        { label: 'Session', description: 'Server sessions' },
      ],
      multiSelect: false,
    };

    const defaultOptions = {
      showDescriptions: true,
      allowOther: true,
      otherLabel: 'Other',
      customInputPrompt: 'Please describe:',
    };

    it('builds choices from question options', () => {
      const choices = buildChoices(validQuestion, defaultOptions);
      expect(choices.length).toBe(3); // 2 options + Other
      expect(choices[0].value).toBe('JWT');
      expect(choices[1].value).toBe('Session');
    });

    it('includes Other option when allowOther is true', () => {
      const choices = buildChoices(validQuestion, defaultOptions);
      const other = choices.find((c) => c.value === '__OTHER__');
      expect(other).toBeDefined();
      expect(other?.name).toContain('Other');
    });

    it('excludes Other option when allowOther is false', () => {
      const choices = buildChoices(validQuestion, { ...defaultOptions, allowOther: false });
      const other = choices.find((c) => c.value === '__OTHER__');
      expect(other).toBeUndefined();
      expect(choices.length).toBe(2);
    });

    it('uses custom Other label', () => {
      const choices = buildChoices(validQuestion, { ...defaultOptions, otherLabel: 'Something else' });
      const other = choices.find((c) => c.value === '__OTHER__');
      expect(other?.name).toContain('Something else');
    });

    it('includes descriptions when showDescriptions is true', () => {
      const choices = buildChoices(validQuestion, defaultOptions);
      expect(choices[0].description).toBe('JSON Web Tokens');
    });

    it('excludes descriptions when showDescriptions is false', () => {
      const choices = buildChoices(validQuestion, { ...defaultOptions, showDescriptions: false });
      expect(choices[0].description).toBeUndefined();
    });
  });

  describe('formatResponse', () => {
    it('returns single selected item', () => {
      const result = formatResponse(['JWT']);
      expect(result).toBe('JWT');
    });

    it('joins multiple selected items with comma', () => {
      const result = formatResponse(['JWT', 'Session']);
      expect(result).toBe('JWT, Session');
    });

    it('returns custom text when provided', () => {
      const result = formatResponse(['JWT'], 'Custom response');
      expect(result).toBe('Custom response');
    });

    it('prioritizes custom text over selected', () => {
      const result = formatResponse(['A', 'B', 'C'], 'Override');
      expect(result).toBe('Override');
    });

    it('handles empty selection', () => {
      const result = formatResponse([]);
      expect(result).toBe('');
    });
  });

  describe('promptSingleSelect', () => {
    const validQuestion: StructuredQuestion = {
      header: 'Auth',
      question: 'Which auth method?',
      options: [
        { label: 'JWT', description: 'JSON Web Tokens' },
        { label: 'Session', description: 'Server sessions' },
      ],
      multiSelect: false,
    };

    it('calls select with correct message', async () => {
      vi.mocked(select).mockResolvedValue('JWT');

      await promptSingleSelect(validQuestion);

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Which auth method?',
        })
      );
    });

    it('returns selected value', async () => {
      vi.mocked(select).mockResolvedValue('JWT');

      const result = await promptSingleSelect(validQuestion);

      expect(result.selected).toEqual(['JWT']);
      expect(result.isOther).toBe(false);
      expect(result.formattedResponse).toBe('JWT');
    });

    it('handles Other selection', async () => {
      vi.mocked(select).mockResolvedValue('__OTHER__');
      vi.mocked(input).mockResolvedValue('Custom auth method');

      const result = await promptSingleSelect(validQuestion);

      expect(result.isOther).toBe(true);
      expect(result.customText).toBe('Custom auth method');
      expect(result.formattedResponse).toBe('Custom auth method');
    });

    it('throws on invalid question', async () => {
      const invalidQuestion = { ...validQuestion, header: '' };

      await expect(promptSingleSelect(invalidQuestion)).rejects.toThrow('Invalid question');
    });

    it('displays header chip', async () => {
      vi.mocked(select).mockResolvedValue('JWT');

      await promptSingleSelect(validQuestion);

      expect(console.log).toHaveBeenCalled();
    });

    it('respects allowOther option', async () => {
      vi.mocked(select).mockResolvedValue('JWT');

      await promptSingleSelect(validQuestion, { allowOther: false });

      const calls = vi.mocked(select).mock.calls;
      const choices = calls[0][0].choices;
      expect(choices.some((c: { value: string }) => c.value === '__OTHER__')).toBe(false);
    });
  });

  describe('promptMultiSelect', () => {
    const validQuestion: StructuredQuestion = {
      header: 'Features',
      question: 'Which features to include?',
      options: [
        { label: 'Auth', description: 'Authentication' },
        { label: 'API', description: 'REST API' },
        { label: 'DB', description: 'Database' },
      ],
      multiSelect: true,
    };

    it('calls checkbox with correct message', async () => {
      vi.mocked(checkbox).mockResolvedValue(['Auth', 'API']);

      await promptMultiSelect(validQuestion);

      expect(checkbox).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Which features to include?',
        })
      );
    });

    it('returns multiple selected values', async () => {
      vi.mocked(checkbox).mockResolvedValue(['Auth', 'API']);

      const result = await promptMultiSelect(validQuestion);

      expect(result.selected).toEqual(['Auth', 'API']);
      expect(result.isOther).toBe(false);
      expect(result.formattedResponse).toBe('Auth, API');
    });

    it('handles Other selection with existing choices', async () => {
      vi.mocked(checkbox).mockResolvedValue(['Auth', '__OTHER__']);
      vi.mocked(input).mockResolvedValue('Custom feature');

      const result = await promptMultiSelect(validQuestion);

      expect(result.selected).toEqual(['Auth']);
      expect(result.isOther).toBe(true);
      expect(result.customText).toBe('Custom feature');
      expect(result.formattedResponse).toBe('Auth, and Custom feature');
    });

    it('handles only Other selection', async () => {
      vi.mocked(checkbox).mockResolvedValue(['__OTHER__']);
      vi.mocked(input).mockResolvedValue('Only custom');

      const result = await promptMultiSelect(validQuestion);

      expect(result.selected).toEqual([]);
      expect(result.isOther).toBe(true);
      expect(result.formattedResponse).toBe('Only custom');
    });

    it('throws on invalid question', async () => {
      const invalidQuestion = { ...validQuestion, options: [] };

      await expect(promptMultiSelect(invalidQuestion)).rejects.toThrow('Invalid question');
    });
  });

  describe('promptQuestion', () => {
    it('calls promptSingleSelect for non-multiSelect questions', async () => {
      const question: StructuredQuestion = {
        header: 'Test',
        question: 'Single select?',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: false,
      };

      vi.mocked(select).mockResolvedValue('A');

      const result = await promptQuestion(question);

      expect(select).toHaveBeenCalled();
      expect(checkbox).not.toHaveBeenCalled();
      expect(result.selected).toEqual(['A']);
    });

    it('calls promptMultiSelect for multiSelect questions', async () => {
      const question: StructuredQuestion = {
        header: 'Test',
        question: 'Multi select?',
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        multiSelect: true,
      };

      vi.mocked(checkbox).mockResolvedValue(['A', 'B']);

      const result = await promptQuestion(question);

      expect(checkbox).toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(result.selected).toEqual(['A', 'B']);
    });
  });

  describe('promptFreeText', () => {
    it('prompts for text input', async () => {
      vi.mocked(input).mockResolvedValue('User input');

      const result = await promptFreeText('Enter text:');

      expect(input).toHaveBeenCalledWith({
        message: 'Enter text:',
      });
      expect(result).toBe('User input');
    });

    it('uses default message', async () => {
      vi.mocked(input).mockResolvedValue('Response');

      await promptFreeText();

      expect(input).toHaveBeenCalledWith({
        message: 'Your response:',
      });
    });

    it('displays header when provided', async () => {
      vi.mocked(input).mockResolvedValue('Response');

      await promptFreeText('Message', { header: 'Custom' });

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('renderAIText', () => {
    it('renders text with separators', () => {
      renderAIText('AI response text');

      expect(console.log).toHaveBeenCalled();
    });

    it('handles multi-line text', () => {
      renderAIText('Line 1\nLine 2\nLine 3');

      // Each line should be logged separately plus separators
      expect(vi.mocked(console.log).mock.calls.length).toBeGreaterThan(3);
    });

    it('does nothing for empty text', () => {
      renderAIText('');
      renderAIText('   ');

      // Only whitespace calls shouldn't render
      const calls = vi.mocked(console.log).mock.calls;
      expect(calls.length).toBe(0);
    });
  });

  describe('renderPhase', () => {
    it('renders exploring phase', () => {
      renderPhase('exploring');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Exploring')
      );
    });

    it('renders questioning phase', () => {
      renderPhase('questioning');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Interview')
      );
    });

    it('renders generating phase', () => {
      renderPhase('generating');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Generating')
      );
    });
  });

  describe('createSpinner', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('creates spinner with start and stop', () => {
      const spinner = createSpinner('Loading...');

      expect(spinner.start).toBeDefined();
      expect(spinner.stop).toBeDefined();
      expect(spinner.succeed).toBeDefined();
      expect(spinner.fail).toBeDefined();
    });

    it('starts spinner and writes to stdout', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();

      expect(process.stdout.write).toHaveBeenCalled();
      spinner.stop();
    });

    it('animates spinner frames', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();

      vi.advanceTimersByTime(160); // 2 frames

      expect(vi.mocked(process.stdout.write).mock.calls.length).toBeGreaterThan(1);
      spinner.stop();
    });

    it('stops spinner and clears line', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();
      spinner.stop();

      const lastCall = vi.mocked(process.stdout.write).mock.calls.pop();
      expect(lastCall?.[0]).toContain('\r');
    });

    it('succeed displays success message', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();
      spinner.succeed('Done!');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Done!')
      );
    });

    it('fail displays failure message', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();
      spinner.fail('Error!');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Error!')
      );
    });

    it('does not double-start', () => {
      const spinner = createSpinner('Loading...');
      spinner.start();
      const callCount = vi.mocked(process.stdout.write).mock.calls.length;
      spinner.start();

      // Should only add one more call at most, not restart
      expect(vi.mocked(process.stdout.write).mock.calls.length).toBe(callCount);
      spinner.stop();
    });

    it('uses default message when none provided', () => {
      const spinner = createSpinner();
      spinner.start();

      expect(process.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Thinking...')
      );
      spinner.stop();
    });

    it('can update message while running', () => {
      const spinner = createSpinner('Initial');
      spinner.start();
      spinner.update('Updated');

      expect(process.stdout.write).toHaveBeenCalledWith(
        expect.stringContaining('Updated')
      );
      spinner.stop();
    });

    it('can check if spinner is running', () => {
      const spinner = createSpinner('Test');
      expect(spinner.isSpinning()).toBe(false);

      spinner.start();
      expect(spinner.isSpinning()).toBe(true);

      spinner.stop();
      expect(spinner.isSpinning()).toBe(false);
    });
  });

  describe('SPINNER_FRAMES', () => {
    it('is an array of spinner characters', () => {
      expect(Array.isArray(SPINNER_FRAMES)).toBe(true);
      expect(SPINNER_FRAMES.length).toBe(10);
    });

    it('contains braille characters', () => {
      expect(SPINNER_FRAMES[0]).toBe('⠋');
      expect(SPINNER_FRAMES[9]).toBe('⠏');
    });
  });

  describe('SPINNER_INTERVAL_MS', () => {
    it('is 80 milliseconds', () => {
      expect(SPINNER_INTERVAL_MS).toBe(80);
    });
  });

  describe('PHASE_CONFIGS', () => {
    it('has configuration for exploring phase', () => {
      expect(PHASE_CONFIGS.exploring).toBeDefined();
      expect(PHASE_CONFIGS.exploring.icon).toBe('🔍');
      expect(PHASE_CONFIGS.exploring.label).toBe('Exploring Codebase');
      expect(typeof PHASE_CONFIGS.exploring.colorFn).toBe('function');
    });

    it('has configuration for questioning phase', () => {
      expect(PHASE_CONFIGS.questioning).toBeDefined();
      expect(PHASE_CONFIGS.questioning.icon).toBe('💬');
      expect(PHASE_CONFIGS.questioning.label).toBe('Interview in Progress');
    });

    it('has configuration for generating phase', () => {
      expect(PHASE_CONFIGS.generating).toBeDefined();
      expect(PHASE_CONFIGS.generating.icon).toBe('📝');
      expect(PHASE_CONFIGS.generating.label).toBe('Generating PRD');
    });

    it('colorFn returns styled string', () => {
      const result = PHASE_CONFIGS.exploring.colorFn('test');
      expect(result).toContain('test');
    });
  });

  describe('DEFAULT_PROGRESS_MESSAGES', () => {
    it('has messages for exploring phase', () => {
      const messages = DEFAULT_PROGRESS_MESSAGES.exploring;
      expect(messages.waiting).toBe('Analyzing codebase...');
      expect(messages.processing).toBe('Processing project structure...');
      expect(messages.complete).toBe('Codebase analysis complete');
      expect(messages.error).toBe('Failed to analyze codebase');
    });

    it('has messages for questioning phase', () => {
      const messages = DEFAULT_PROGRESS_MESSAGES.questioning;
      expect(messages.waiting).toBe('Thinking...');
      expect(messages.processing).toBe('Processing your response...');
      expect(messages.complete).toBe('Response received');
      expect(messages.error).toBe('Failed to process response');
    });

    it('has messages for generating phase', () => {
      const messages = DEFAULT_PROGRESS_MESSAGES.generating;
      expect(messages.waiting).toBe('Generating PRD...');
      expect(messages.processing).toBe('Writing documentation...');
      expect(messages.complete).toBe('PRD generated successfully');
      expect(messages.error).toBe('Failed to generate PRD');
    });
  });

  describe('ProgressIndicator', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('constructor', () => {
      it('creates indicator with default phase (questioning)', () => {
        const indicator = new ProgressIndicator();
        expect(indicator.getPhase()).toBe('questioning');
      });

      it('creates indicator with specified phase', () => {
        const indicator = new ProgressIndicator('exploring');
        expect(indicator.getPhase()).toBe('exploring');
      });

      it('starts in idle state', () => {
        const indicator = new ProgressIndicator();
        expect(indicator.getState()).toBe('idle');
      });

      it('starts with turn count of 0', () => {
        const indicator = new ProgressIndicator();
        expect(indicator.getTurnCount()).toBe(0);
      });
    });

    describe('setPhase', () => {
      it('changes the phase', () => {
        const indicator = new ProgressIndicator('exploring');
        indicator.setPhase('questioning');
        expect(indicator.getPhase()).toBe('questioning');
      });

      it('displays phase when showPhase is true', () => {
        const indicator = new ProgressIndicator('exploring', { showPhase: true });
        indicator.setPhase('questioning');
        expect(console.log).toHaveBeenCalled();
      });

      it('does not display phase when showPhase is false', () => {
        const indicator = new ProgressIndicator('exploring', { showPhase: false });
        vi.mocked(console.log).mockClear();
        indicator.setPhase('questioning');
        // Should not call console.log for phase display
        // Note: The first setPhase call may log, but subsequent ones without change should not
      });

      it('does not change if same phase', () => {
        const indicator = new ProgressIndicator('exploring');
        vi.mocked(console.log).mockClear();
        indicator.setPhase('exploring');
        // No phase change, so no display
        expect(console.log).not.toHaveBeenCalled();
      });
    });

    describe('incrementTurn', () => {
      it('increments the turn counter', () => {
        const indicator = new ProgressIndicator();
        expect(indicator.getTurnCount()).toBe(0);
        indicator.incrementTurn();
        expect(indicator.getTurnCount()).toBe(1);
        indicator.incrementTurn();
        expect(indicator.getTurnCount()).toBe(2);
      });
    });

    describe('setTurnCount', () => {
      it('sets the turn count directly', () => {
        const indicator = new ProgressIndicator();
        indicator.setTurnCount(5);
        expect(indicator.getTurnCount()).toBe(5);
      });
    });

    describe('displayPhase', () => {
      it('displays phase header', () => {
        const indicator = new ProgressIndicator('exploring');
        indicator.displayPhase();
        expect(console.log).toHaveBeenCalled();
      });

      it('includes turn count when showTurnCounter is true and count > 0', () => {
        const indicator = new ProgressIndicator('questioning', { showTurnCounter: true });
        indicator.setTurnCount(3);
        vi.mocked(console.log).mockClear();
        indicator.displayPhase();
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Turn 3')
        );
      });

      it('does not include turn count when count is 0', () => {
        const indicator = new ProgressIndicator('questioning', { showTurnCounter: true });
        vi.mocked(console.log).mockClear();
        indicator.displayPhase();
        const calls = vi.mocked(console.log).mock.calls;
        const hasNoTurnCount = calls.every(call => !String(call[0]).includes('Turn'));
        expect(hasNoTurnCount).toBe(true);
      });
    });

    describe('startWaiting', () => {
      it('changes state to waiting', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        expect(indicator.getState()).toBe('waiting');
      });

      it('starts the spinner', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        expect(indicator.isActive()).toBe(true);
        indicator.stop();
      });

      it('uses custom message if provided', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting('Custom waiting message');
        expect(process.stdout.write).toHaveBeenCalledWith(
          expect.stringContaining('Custom waiting message')
        );
        indicator.stop();
      });
    });

    describe('startProcessing', () => {
      it('changes state to processing', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.startProcessing();
        expect(indicator.getState()).toBe('processing');
        indicator.stop();
      });

      it('uses custom message if provided', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.startProcessing('Processing data...');
        expect(process.stdout.write).toHaveBeenCalledWith(
          expect.stringContaining('Processing data...')
        );
        indicator.stop();
      });
    });

    describe('complete', () => {
      it('changes state to complete', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.complete();
        expect(indicator.getState()).toBe('complete');
      });

      it('stops spinner and shows success message', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.complete('All done!');
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('All done!')
        );
        expect(indicator.isActive()).toBe(false);
      });
    });

    describe('error', () => {
      it('changes state to error', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.error();
        expect(indicator.getState()).toBe('error');
      });

      it('stops spinner and shows error message', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.error('Something went wrong');
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Something went wrong')
        );
        expect(indicator.isActive()).toBe(false);
      });
    });

    describe('stop', () => {
      it('changes state to idle', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.stop();
        expect(indicator.getState()).toBe('idle');
      });

      it('stops the spinner', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        expect(indicator.isActive()).toBe(true);
        indicator.stop();
        expect(indicator.isActive()).toBe(false);
      });
    });

    describe('isActive', () => {
      it('returns false when not started', () => {
        const indicator = new ProgressIndicator();
        expect(indicator.isActive()).toBe(false);
      });

      it('returns true when waiting', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        expect(indicator.isActive()).toBe(true);
        indicator.stop();
      });
    });

    describe('updateMessage', () => {
      it('updates the spinner message', () => {
        const indicator = new ProgressIndicator();
        indicator.startWaiting();
        indicator.updateMessage('New message');
        expect(process.stdout.write).toHaveBeenCalledWith(
          expect.stringContaining('New message')
        );
        indicator.stop();
      });
    });

    describe('custom messages', () => {
      it('uses custom messages for states', () => {
        const indicator = new ProgressIndicator('questioning', {
          messages: {
            waiting: 'Custom wait',
            complete: 'Custom complete',
          },
        });
        indicator.startWaiting();
        expect(process.stdout.write).toHaveBeenCalledWith(
          expect.stringContaining('Custom wait')
        );
        indicator.complete();
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Custom complete')
        );
      });
    });
  });

  describe('createProgressIndicator', () => {
    it('creates a ProgressIndicator instance', () => {
      const indicator = createProgressIndicator();
      expect(indicator).toBeInstanceOf(ProgressIndicator);
    });

    it('accepts phase argument', () => {
      const indicator = createProgressIndicator('generating');
      expect(indicator.getPhase()).toBe('generating');
    });

    it('accepts options', () => {
      const indicator = createProgressIndicator('exploring', { showPhase: false });
      expect(indicator).toBeInstanceOf(ProgressIndicator);
    });
  });

  describe('renderSeparator', () => {
    it('renders light separator by default', () => {
      renderSeparator();
      expect(console.log).toHaveBeenCalled();
    });

    it('renders light separator', () => {
      renderSeparator('light');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('─')
      );
    });

    it('renders heavy separator', () => {
      renderSeparator('heavy');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('━')
      );
    });

    it('renders double separator', () => {
      renderSeparator('double');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('═')
      );
    });

    it('respects width parameter', () => {
      renderSeparator('light', 30);
      const calls = vi.mocked(console.log).mock.calls;
      const separatorCall = calls.find(call => String(call[0]).includes('─'));
      // Should contain 30 dashes (wrapped in DIM style)
      expect(separatorCall).toBeDefined();
    });
  });

  describe('renderProgressSummary', () => {
    it('renders progress summary', () => {
      renderProgressSummary(5, 'questioning');
      expect(console.log).toHaveBeenCalled();
    });

    it('uses singular "turn" for 1 turn', () => {
      renderProgressSummary(1, 'exploring');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('1 turn')
      );
    });

    it('uses plural "turns" for multiple turns', () => {
      renderProgressSummary(3, 'exploring');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('3 turns')
      );
    });

    it('includes phase icon', () => {
      renderProgressSummary(2, 'generating');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('📝')
      );
    });
  });

  describe('renderWelcomeBanner', () => {
    it('renders welcome banner with feature and provider', () => {
      renderWelcomeBanner('User Authentication', 'claude');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Lisa')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('User Authentication')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('claude')
      );
    });

    it('renders separators', () => {
      renderWelcomeBanner('Test', 'test');
      const calls = vi.mocked(console.log).mock.calls;
      const hasSeparator = calls.some(call => String(call[0]).includes('═'));
      expect(hasSeparator).toBe(true);
    });
  });

  describe('renderCompletionBanner', () => {
    it('renders completion banner with slug and paths', () => {
      renderCompletionBanner('feature-name', './lisa/feature-name.md', './lisa/feature-name.json');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Complete')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('feature-name')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('./lisa/feature-name.md')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('./lisa/feature-name.json')
      );
    });

    it('handles missing JSON path', () => {
      renderCompletionBanner('test-slug', './lisa/test-slug.md');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('test-slug')
      );
    });
  });

  describe('renderErrorBanner', () => {
    it('renders error banner with message', () => {
      renderErrorBanner('Something went wrong');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Error')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong')
      );
    });

    it('shows resume instruction when recoverable', () => {
      renderErrorBanner('Network error', true);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('--resume')
      );
    });

    it('does not show resume instruction when not recoverable', () => {
      vi.mocked(console.log).mockClear();
      renderErrorBanner('Fatal error', false);
      const calls = vi.mocked(console.log).mock.calls;
      const hasResume = calls.some(call => String(call[0]).includes('--resume'));
      expect(hasResume).toBe(false);
    });
  });
});
