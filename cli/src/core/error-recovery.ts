/**
 * Error Recovery System for Lisa CLI
 * Handles graceful error recovery with state preservation
 */

import { saveState, type InterviewState } from './state.js';

/**
 * Error categories for interview errors
 */
export type ErrorCategory =
  | 'network'
  | 'provider'
  | 'process'
  | 'state'
  | 'validation'
  | 'timeout'
  | 'user_cancelled'
  | 'unknown';

/**
 * Detailed interview error with recovery information
 */
export class InterviewError extends Error {
  /** Error category for classification */
  readonly category: ErrorCategory;
  /** Whether the interview can be resumed after this error */
  readonly recoverable: boolean;
  /** Original error that caused this error */
  readonly cause?: Error;
  /** Timestamp when the error occurred */
  readonly timestamp: string;
  /** Additional context about the error */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    category: ErrorCategory,
    options: {
      recoverable?: boolean;
      cause?: Error;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'InterviewError';
    this.category = category;
    this.recoverable = options.recoverable ?? true;
    this.cause = options.cause;
    this.timestamp = new Date().toISOString();
    this.context = options.context;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const messages: Record<ErrorCategory, string> = {
      network: 'A network error occurred. Please check your internet connection.',
      provider: 'The AI provider encountered an error. Please try again.',
      process: 'The AI process terminated unexpectedly.',
      state: 'Failed to save or load interview state.',
      validation: 'Invalid data received.',
      timeout: 'The operation timed out. Please try again.',
      user_cancelled: 'Interview was cancelled.',
      unknown: 'An unexpected error occurred.',
    };
    return messages[this.category];
  }

  /**
   * Get recovery instructions
   */
  getRecoveryInstructions(): string {
    if (!this.recoverable) {
      return 'This error cannot be recovered from automatically. Please start a new interview.';
    }

    const instructions: Record<ErrorCategory, string> = {
      network: 'Your progress has been saved. Run "lisa --resume" to continue where you left off.',
      provider: 'Your progress has been saved. Run "lisa --resume" to continue where you left off.',
      process: 'Your progress has been saved. Run "lisa --resume" to continue where you left off.',
      state: 'Please check disk space and file permissions, then try again.',
      validation: 'Please check your input and try again.',
      timeout: 'Your progress has been saved. Run "lisa --resume" to continue where you left off.',
      user_cancelled: 'Your progress has been saved. Run "lisa --resume" to continue where you left off.',
      unknown: 'Your progress may have been saved. Run "lisa --resume" to attempt to continue.',
    };
    return instructions[this.category];
  }

  /**
   * Format the error for display
   */
  format(): string {
    const parts: string[] = [];
    parts.push(`Error: ${this.message}`);
    parts.push('');
    parts.push(this.getUserMessage());
    parts.push('');
    parts.push(this.getRecoveryInstructions());
    return parts.join('\n');
  }
}

/**
 * Network-related error (connection issues, DNS failures, etc.)
 */
export class NetworkError extends InterviewError {
  constructor(message: string, cause?: Error) {
    super(message, 'network', { recoverable: true, cause });
    this.name = 'NetworkError';
  }
}

/**
 * Provider-related error (AI service errors, rate limits, etc.)
 */
export class ProviderError extends InterviewError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, 'provider', { recoverable: true, cause, context });
    this.name = 'ProviderError';
  }
}

/**
 * Process-related error (crashed process, signals, etc.)
 */
export class ProcessError extends InterviewError {
  readonly exitCode?: number;
  readonly signal?: string;

  constructor(
    message: string,
    options: { exitCode?: number; signal?: string; cause?: Error } = {}
  ) {
    super(message, 'process', { recoverable: true, cause: options.cause });
    this.name = 'ProcessError';
    this.exitCode = options.exitCode;
    this.signal = options.signal;
  }
}

/**
 * State-related error (save/load failures)
 */
export class StateError extends InterviewError {
  constructor(message: string, cause?: Error) {
    super(message, 'state', { recoverable: false, cause });
    this.name = 'StateError';
  }
}

/**
 * Timeout error (AI response took too long)
 */
export class TimeoutError extends InterviewError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 'timeout', { recoverable: true, context: { timeoutMs } });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * User cancelled the interview
 */
export class UserCancelledError extends InterviewError {
  constructor(message: string = 'Interview cancelled by user') {
    super(message, 'user_cancelled', { recoverable: true });
    this.name = 'UserCancelledError';
  }
}

/**
 * Result of a state save attempt
 */
export interface StateSaveResult {
  success: boolean;
  path?: string;
  error?: Error;
}

/**
 * Options for the error recovery wrapper
 */
export interface ErrorRecoveryOptions {
  /** State to save before operation */
  state?: InterviewState;
  /** Base directory for state file */
  baseDir?: string;
  /** Whether to save state before operation (default: true when state provided) */
  saveStateBefore?: boolean;
  /** Whether to save state on error (default: true when state provided) */
  saveStateOnError?: boolean;
  /** Custom error transformer */
  transformError?: (error: unknown) => InterviewError;
}

/**
 * Result of an error-wrapped operation
 */
export interface ErrorRecoveryResult<T> {
  success: boolean;
  result?: T;
  error?: InterviewError;
  stateSaved?: StateSaveResult;
}

/**
 * Classify an error into an appropriate InterviewError
 */
export function classifyError(error: unknown): InterviewError {
  if (error instanceof InterviewError) {
    return error;
  }

  if (!(error instanceof Error)) {
    return new InterviewError(String(error), 'unknown', { recoverable: true });
  }

  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('network') ||
    message.includes('dns')
  ) {
    return new NetworkError(error.message, error);
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    // Extract timeout value if present
    const timeoutMatch = message.match(/(\d+)\s*ms/);
    const timeoutMs = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 0;
    return new TimeoutError(error.message, timeoutMs);
  }

  // Process errors
  if (
    message.includes('sigterm') ||
    message.includes('sigkill') ||
    message.includes('process') ||
    message.includes('spawn') ||
    message.includes('exit code') ||
    message.includes('exited')
  ) {
    const exitCodeMatch = message.match(/exit code (\d+)/);
    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;
    return new ProcessError(error.message, { exitCode, cause: error });
  }

  // State errors
  if (
    message.includes('state') ||
    message.includes('eacces') ||
    message.includes('enoent') ||
    message.includes('corrupted')
  ) {
    return new StateError(error.message, error);
  }

  // Provider/AI errors
  if (
    message.includes('api') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('provider')
  ) {
    return new ProviderError(error.message, error);
  }

  // Unknown error
  return new InterviewError(error.message, 'unknown', {
    recoverable: true,
    cause: error,
  });
}

/**
 * Attempt to save state safely (won't throw)
 */
export async function trySaveState(
  state: InterviewState,
  baseDir?: string
): Promise<StateSaveResult> {
  try {
    const path = await saveState(state, baseDir);
    return { success: true, path };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Wrap an async operation with error recovery
 * - Saves state before the operation (if state provided)
 * - Catches and classifies errors
 * - Saves state on error (if state provided)
 * - Returns structured result
 */
export async function withErrorRecovery<T>(
  operation: () => Promise<T>,
  options: ErrorRecoveryOptions = {}
): Promise<ErrorRecoveryResult<T>> {
  const { state, baseDir, saveStateBefore = true, saveStateOnError = true, transformError } = options;

  let stateSaved: StateSaveResult | undefined;

  // Save state before operation if requested
  if (state && saveStateBefore) {
    stateSaved = await trySaveState(state, baseDir);
    if (!stateSaved.success) {
      // Log warning but don't fail - the operation may still succeed
      console.warn(`Warning: Could not save state before operation: ${stateSaved.error?.message}`);
    }
  }

  try {
    const result = await operation();
    return { success: true, result, stateSaved };
  } catch (error) {
    // Save state on error if requested
    if (state && saveStateOnError) {
      const errorStateSave = await trySaveState(state, baseDir);
      if (!errorStateSave.success) {
        console.warn(`Warning: Could not save state after error: ${errorStateSave.error?.message}`);
      }
      stateSaved = errorStateSave;
    }

    // Transform/classify the error
    const interviewError = transformError
      ? transformError(error)
      : classifyError(error);

    return { success: false, error: interviewError, stateSaved };
  }
}

/**
 * Create a retry wrapper with exponential backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay between retries in ms */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms */
  maxDelayMs?: number;
  /** Factor to multiply delay by after each attempt */
  backoffFactor?: number;
  /** Error categories that should be retried */
  retryableCategories?: ErrorCategory[];
  /** Callback when a retry is attempted */
  onRetry?: (attempt: number, error: InterviewError, delayMs: number) => void;
}

/**
 * Retry an operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    retryableCategories = ['network', 'timeout', 'provider'],
    onRetry,
  } = options;

  let lastError: InterviewError | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = classifyError(error);

      // Check if we should retry
      const shouldRetry =
        attempt < maxAttempts &&
        lastError.recoverable &&
        retryableCategories.includes(lastError.category);

      if (!shouldRetry) {
        throw lastError;
      }

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, lastError, delay);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Increase delay for next attempt
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  // Should never reach here, but just in case
  throw lastError ?? new InterviewError('Operation failed after retries', 'unknown');
}

/**
 * Safe operation executor that always saves state
 * This is the primary function to use in the orchestrator
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  state: InterviewState,
  baseDir?: string
): Promise<{ result: T; statePath: string }> {
  // Save state before operation
  const statePath = await saveState(state, baseDir);

  try {
    const result = await operation();
    return { result, statePath };
  } catch (error) {
    // Always attempt to save state on error
    try {
      await saveState(state, baseDir);
    } catch (saveError) {
      // Log but don't override the original error
      console.error('Warning: Failed to save state after error:', saveError);
    }

    // Rethrow as classified error
    throw classifyError(error);
  }
}

/**
 * Format an error for user display
 */
export function formatErrorForUser(error: unknown): string {
  if (error instanceof InterviewError) {
    return error.format();
  }

  if (error instanceof Error) {
    const classified = classifyError(error);
    return classified.format();
  }

  return `Error: ${String(error)}\n\nAn unexpected error occurred.`;
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof InterviewError) {
    return error.recoverable;
  }

  const classified = classifyError(error);
  return classified.recoverable;
}

/**
 * Get the error category
 */
export function getErrorCategory(error: unknown): ErrorCategory {
  if (error instanceof InterviewError) {
    return error.category;
  }

  const classified = classifyError(error);
  return classified.category;
}
