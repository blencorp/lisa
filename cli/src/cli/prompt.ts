/**
 * AskUserQuestion-style interactive prompt component
 * Renders AI questions as multiple-choice selections using Inquirer.js
 */

import { select, checkbox, input } from '@inquirer/prompts';
import chalk from 'chalk';
import type { StructuredQuestion } from '../core/orchestrator.js';

/**
 * Result from a prompt interaction
 */
export interface PromptResult {
  /** The selected option labels */
  selected: string[];
  /** Whether "Other" was selected */
  isOther: boolean;
  /** Custom text if "Other" was selected */
  customText?: string;
  /** Formatted response string to send to AI */
  formattedResponse: string;
}

/**
 * Options for configuring the prompt display
 */
export interface PromptOptions {
  /** Whether to show descriptions for options (default: true) */
  showDescriptions?: boolean;
  /** Whether to add "Other" option (default: true) */
  allowOther?: boolean;
  /** Custom "Other" option label (default: "Other") */
  otherLabel?: string;
  /** Custom prompt for custom input (default: "Please describe:") */
  customInputPrompt?: string;
}

const DEFAULT_OPTIONS: Required<PromptOptions> = {
  showDescriptions: true,
  allowOther: true,
  otherLabel: 'Other',
  customInputPrompt: 'Please describe:',
};

/**
 * Format the header chip display (max 12 chars)
 */
export function formatHeader(header: string): string {
  const truncated = header.slice(0, 12);
  return chalk.bgBlue.white.bold(` ${truncated} `);
}

/**
 * Format an option for display
 */
export function formatOption(label: string, description: string, showDescription: boolean): string {
  if (showDescription && description) {
    return `${chalk.bold(label)} ${chalk.dim('- ' + description)}`;
  }
  return chalk.bold(label);
}

/**
 * Validate a structured question has required fields
 */
export function validateQuestion(question: StructuredQuestion): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!question.header || typeof question.header !== 'string') {
    errors.push('Missing or invalid header');
  } else if (question.header.length > 12) {
    errors.push('Header exceeds 12 characters');
  }

  if (!question.question || typeof question.question !== 'string') {
    errors.push('Missing or invalid question text');
  }

  if (!Array.isArray(question.options)) {
    errors.push('Options must be an array');
  } else if (question.options.length < 2) {
    errors.push('At least 2 options are required');
  } else if (question.options.length > 4) {
    errors.push('Maximum 4 options allowed');
  } else {
    question.options.forEach((opt, i) => {
      if (!opt.label || typeof opt.label !== 'string') {
        errors.push(`Option ${i + 1}: Missing or invalid label`);
      }
      if (typeof opt.description !== 'string') {
        errors.push(`Option ${i + 1}: Missing or invalid description`);
      }
    });
  }

  if (typeof question.multiSelect !== 'boolean') {
    errors.push('multiSelect must be a boolean');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build choices array for Inquirer from structured question
 */
export function buildChoices(
  question: StructuredQuestion,
  options: Required<PromptOptions>
): Array<{ name: string; value: string; description?: string }> {
  const choices = question.options.map((opt) => ({
    name: formatOption(opt.label, opt.description, options.showDescriptions),
    value: opt.label,
    description: options.showDescriptions ? opt.description : undefined,
  }));

  if (options.allowOther) {
    choices.push({
      name: chalk.italic(options.otherLabel),
      value: '__OTHER__',
      description: 'Provide a custom response',
    });
  }

  return choices;
}

/**
 * Format the selected answers into a response string for the AI
 */
export function formatResponse(selected: string[], customText?: string): string {
  if (customText) {
    return customText;
  }
  if (selected.length === 1) {
    return selected[0];
  }
  return selected.join(', ');
}

/**
 * Display a single-select prompt for a structured question
 */
export async function promptSingleSelect(
  question: StructuredQuestion,
  options: PromptOptions = {}
): Promise<PromptResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const validation = validateQuestion(question);

  if (!validation.valid) {
    throw new Error(`Invalid question: ${validation.errors.join(', ')}`);
  }

  // Display header chip
  console.log(`\n${formatHeader(question.header)}`);

  const choices = buildChoices(question, opts);

  const answer = await select({
    message: question.question,
    choices,
  });

  if (answer === '__OTHER__') {
    const customText = await input({
      message: opts.customInputPrompt,
    });

    return {
      selected: [],
      isOther: true,
      customText,
      formattedResponse: formatResponse([], customText),
    };
  }

  return {
    selected: [answer],
    isOther: false,
    formattedResponse: formatResponse([answer]),
  };
}

/**
 * Display a multi-select prompt for a structured question
 */
export async function promptMultiSelect(
  question: StructuredQuestion,
  options: PromptOptions = {}
): Promise<PromptResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const validation = validateQuestion(question);

  if (!validation.valid) {
    throw new Error(`Invalid question: ${validation.errors.join(', ')}`);
  }

  // Display header chip
  console.log(`\n${formatHeader(question.header)}`);

  const choices = buildChoices(question, opts);

  const answers = await checkbox({
    message: question.question,
    choices,
  });

  const hasOther = answers.includes('__OTHER__');
  const selected = answers.filter((a) => a !== '__OTHER__');

  if (hasOther) {
    const customText = await input({
      message: opts.customInputPrompt,
    });

    return {
      selected,
      isOther: true,
      customText,
      formattedResponse: formatResponse(
        selected,
        selected.length > 0 ? `${selected.join(', ')}, and ${customText}` : customText
      ),
    };
  }

  return {
    selected,
    isOther: false,
    formattedResponse: formatResponse(selected),
  };
}

/**
 * Display a prompt for a structured question (auto-detects single vs multi)
 * This is the main entry point for rendering questions
 */
export async function promptQuestion(
  question: StructuredQuestion,
  options: PromptOptions = {}
): Promise<PromptResult> {
  if (question.multiSelect) {
    return promptMultiSelect(question, options);
  }
  return promptSingleSelect(question, options);
}

/**
 * Display a free-text input prompt (for when AI doesn't provide structured question)
 */
export async function promptFreeText(
  message: string = 'Your response:',
  options: { header?: string } = {}
): Promise<string> {
  if (options.header) {
    console.log(`\n${formatHeader(options.header)}`);
  }

  const answer = await input({
    message,
  });

  return answer;
}

/**
 * Render AI text with proper formatting
 */
export function renderAIText(text: string): void {
  if (!text.trim()) return;

  console.log();
  console.log(chalk.cyan('─'.repeat(60)));
  const lines = text.split('\n');
  for (const line of lines) {
    console.log(chalk.white(line));
  }
  console.log(chalk.cyan('─'.repeat(60)));
  console.log();
}

/**
 * Render a phase indicator
 */
export function renderPhase(phase: 'exploring' | 'questioning' | 'generating'): void {
  const phaseLabels: Record<string, string> = {
    exploring: '🔍 Exploring Codebase',
    questioning: '💬 Interview in Progress',
    generating: '📝 Generating PRD',
  };

  const label = phaseLabels[phase] || phase;
  console.log(chalk.bgMagenta.white.bold(` ${label} `));
}

/**
 * Spinner frames for animation
 */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/**
 * Default spinner interval in milliseconds
 */
export const SPINNER_INTERVAL_MS = 80;

/**
 * Spinner interface for async operations
 */
export interface Spinner {
  /** Start the spinner animation */
  start: () => void;
  /** Stop the spinner and clear the line */
  stop: () => void;
  /** Stop spinner and show success message */
  succeed: (text?: string) => void;
  /** Stop spinner and show failure message */
  fail: (text?: string) => void;
  /** Update the spinner message */
  update: (message: string) => void;
  /** Check if spinner is currently running */
  isSpinning: () => boolean;
}

/**
 * Create a simple spinner for async operations
 * Returns start and stop functions
 */
export function createSpinner(message: string = 'Thinking...'): Spinner {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;
  let currentMessage = message;

  return {
    start: () => {
      if (intervalId) return;
      process.stdout.write(`\r${chalk.cyan(SPINNER_FRAMES[0])} ${currentMessage}`);
      intervalId = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        process.stdout.write(`\r${chalk.cyan(SPINNER_FRAMES[frameIndex])} ${currentMessage}`);
      }, SPINNER_INTERVAL_MS);
    },
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        process.stdout.write('\r' + ' '.repeat(currentMessage.length + 3) + '\r');
      }
    },
    succeed: (text?: string) => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      console.log(`\r${chalk.green('✔')} ${text || currentMessage}`);
    },
    fail: (text?: string) => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      console.log(`\r${chalk.red('✖')} ${text || currentMessage}`);
    },
    update: (newMessage: string) => {
      const wasSpinning = intervalId !== null;
      if (wasSpinning) {
        // Clear current line before updating
        process.stdout.write('\r' + ' '.repeat(currentMessage.length + 3) + '\r');
      }
      currentMessage = newMessage;
      if (wasSpinning) {
        process.stdout.write(`\r${chalk.cyan(SPINNER_FRAMES[frameIndex])} ${currentMessage}`);
      }
    },
    isSpinning: () => intervalId !== null,
  };
}

/**
 * Interview phase type
 */
export type InterviewPhaseType = 'exploring' | 'questioning' | 'generating';

/**
 * Progress indicator state
 */
export type ProgressState = 'idle' | 'waiting' | 'processing' | 'complete' | 'error';

/**
 * Phase display configuration
 */
export interface PhaseConfig {
  /** Emoji icon for the phase */
  icon: string;
  /** Display label for the phase */
  label: string;
  /** Color function for styling */
  colorFn: (s: string) => string;
}

/**
 * Phase configuration map
 */
export const PHASE_CONFIGS: Record<InterviewPhaseType, PhaseConfig> = {
  exploring: {
    icon: '🔍',
    label: 'Exploring Codebase',
    colorFn: (s: string) => chalk.bgBlue.white(s),
  },
  questioning: {
    icon: '💬',
    label: 'Interview in Progress',
    colorFn: (s: string) => chalk.bgMagenta.white(s),
  },
  generating: {
    icon: '📝',
    label: 'Generating PRD',
    colorFn: (s: string) => chalk.bgGreen.white(s),
  },
};

/**
 * Progress message configuration
 */
export interface ProgressMessages {
  /** Message while waiting for AI */
  waiting: string;
  /** Message while processing */
  processing: string;
  /** Message on completion */
  complete: string;
  /** Message on error */
  error: string;
}

/**
 * Default progress messages for each phase
 */
export const DEFAULT_PROGRESS_MESSAGES: Record<InterviewPhaseType, ProgressMessages> = {
  exploring: {
    waiting: 'Analyzing codebase...',
    processing: 'Processing project structure...',
    complete: 'Codebase analysis complete',
    error: 'Failed to analyze codebase',
  },
  questioning: {
    waiting: 'Thinking...',
    processing: 'Processing your response...',
    complete: 'Response received',
    error: 'Failed to process response',
  },
  generating: {
    waiting: 'Generating PRD...',
    processing: 'Writing documentation...',
    complete: 'PRD generated successfully',
    error: 'Failed to generate PRD',
  },
};

/**
 * Progress indicator options
 */
export interface ProgressIndicatorOptions {
  /** Custom messages for each state */
  messages?: Partial<ProgressMessages>;
  /** Whether to show phase header (default: true) */
  showPhase?: boolean;
  /** Whether to show turn counter (default: true) */
  showTurnCounter?: boolean;
}

/**
 * Progress indicator for interview operations
 * Combines spinner with phase and context information
 */
export class ProgressIndicator {
  private spinner: Spinner;
  private phase: InterviewPhaseType;
  private state: ProgressState = 'idle';
  private messages: ProgressMessages;
  private options: Required<ProgressIndicatorOptions>;
  private turnCount: number = 0;

  constructor(phase: InterviewPhaseType = 'questioning', options: ProgressIndicatorOptions = {}) {
    this.phase = phase;
    this.options = {
      messages: options.messages || {},
      showPhase: options.showPhase ?? true,
      showTurnCounter: options.showTurnCounter ?? true,
    };
    this.messages = {
      ...DEFAULT_PROGRESS_MESSAGES[phase],
      ...this.options.messages,
    };
    this.spinner = createSpinner(this.messages.waiting);
  }

  /**
   * Get the current phase
   */
  getPhase(): InterviewPhaseType {
    return this.phase;
  }

  /**
   * Get the current state
   */
  getState(): ProgressState {
    return this.state;
  }

  /**
   * Get the current turn count
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Set the current phase
   */
  setPhase(phase: InterviewPhaseType): void {
    if (this.phase !== phase) {
      this.phase = phase;
      this.messages = {
        ...DEFAULT_PROGRESS_MESSAGES[phase],
        ...this.options.messages,
      };
      // Display the new phase
      if (this.options.showPhase) {
        this.displayPhase();
      }
    }
  }

  /**
   * Increment the turn counter
   */
  incrementTurn(): void {
    this.turnCount++;
  }

  /**
   * Set the turn count directly
   */
  setTurnCount(count: number): void {
    this.turnCount = count;
  }

  /**
   * Display the current phase header
   */
  displayPhase(): void {
    const config = PHASE_CONFIGS[this.phase];
    const turnInfo = this.options.showTurnCounter && this.turnCount > 0
      ? ` (Turn ${this.turnCount})`
      : '';
    console.log();
    console.log(config.colorFn(` ${config.icon} ${config.label}${turnInfo} `));
  }

  /**
   * Start showing progress (waiting for AI)
   */
  startWaiting(customMessage?: string): void {
    this.state = 'waiting';
    if (customMessage) {
      this.spinner.update(customMessage);
    } else {
      this.spinner.update(this.messages.waiting);
    }
    this.spinner.start();
  }

  /**
   * Update to processing state
   */
  startProcessing(customMessage?: string): void {
    this.state = 'processing';
    this.spinner.update(customMessage || this.messages.processing);
  }

  /**
   * Stop progress with success
   */
  complete(customMessage?: string): void {
    this.state = 'complete';
    this.spinner.succeed(customMessage || this.messages.complete);
  }

  /**
   * Stop progress with error
   */
  error(customMessage?: string): void {
    this.state = 'error';
    this.spinner.fail(customMessage || this.messages.error);
  }

  /**
   * Stop progress without message (clear spinner)
   */
  stop(): void {
    this.state = 'idle';
    this.spinner.stop();
  }

  /**
   * Check if currently showing progress
   */
  isActive(): boolean {
    return this.spinner.isSpinning();
  }

  /**
   * Update the spinner message while running
   */
  updateMessage(message: string): void {
    this.spinner.update(message);
  }
}

/**
 * Create a progress indicator for interview operations
 */
export function createProgressIndicator(
  phase: InterviewPhaseType = 'questioning',
  options: ProgressIndicatorOptions = {}
): ProgressIndicator {
  return new ProgressIndicator(phase, options);
}

/**
 * Display a visual separator line
 */
export function renderSeparator(style: 'light' | 'heavy' | 'double' = 'light', width: number = 60): void {
  const chars: Record<typeof style, string> = {
    light: '─',
    heavy: '━',
    double: '═',
  };
  console.log(chalk.dim(chars[style].repeat(width)));
}

/**
 * Display interview progress summary
 */
export function renderProgressSummary(turnCount: number, phase: InterviewPhaseType): void {
  const config = PHASE_CONFIGS[phase];
  const turnLabel = turnCount === 1 ? 'turn' : 'turns';
  console.log();
  console.log(chalk.dim(`${config.icon} ${turnCount} ${turnLabel} completed in ${config.label.toLowerCase()} phase`));
}

/**
 * Display welcome banner at start of interview
 */
export function renderWelcomeBanner(feature: string, provider: string): void {
  console.log();
  renderSeparator('double');
  console.log(chalk.bold.cyan('  🌸 Lisa - AI Planning Interview'));
  renderSeparator('double');
  console.log();
  console.log(chalk.dim('  Feature: ') + chalk.white(feature));
  console.log(chalk.dim('  Provider: ') + chalk.white(provider));
  console.log();
}

/**
 * Display completion banner at end of interview
 */
export function renderCompletionBanner(slug: string, markdownPath: string, jsonPath?: string): void {
  console.log();
  renderSeparator('double');
  console.log(chalk.bold.green('  ✨ Interview Complete!'));
  renderSeparator('double');
  console.log();
  console.log(chalk.dim('  Slug: ') + chalk.white(slug));
  console.log(chalk.dim('  Markdown: ') + chalk.cyan(markdownPath));
  if (jsonPath) {
    console.log(chalk.dim('  JSON: ') + chalk.cyan(jsonPath));
  }
  console.log();
}

/**
 * Display error banner
 */
export function renderErrorBanner(message: string, recoverable: boolean = false): void {
  console.log();
  renderSeparator('heavy');
  console.log(chalk.bold.red('  ❌ Error'));
  renderSeparator('heavy');
  console.log();
  console.log(chalk.red('  ' + message));
  if (recoverable) {
    console.log();
    console.log(chalk.yellow('  You can resume this interview with: lisa --resume'));
  }
  console.log();
}
