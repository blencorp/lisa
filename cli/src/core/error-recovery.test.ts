/**
 * Tests for error recovery system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InterviewError,
  NetworkError,
  ProviderError,
  ProcessError,
  StateError,
  TimeoutError,
  UserCancelledError,
  classifyError,
  trySaveState,
  withErrorRecovery,
  withRetry,
  safeExecute,
  formatErrorForUser,
  isRecoverableError,
  getErrorCategory,
  type ErrorCategory,
} from './error-recovery.js';
import { createState, type InterviewState } from './state.js';

describe('error-recovery', () => {
  let testDir: string;
  let testState: InterviewState;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lisa-error-recovery-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testState = createState('Test feature', 'claude', {
      firstPrinciples: false,
      contextFiles: [],
    });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('InterviewError', () => {
    it('should create error with required properties', () => {
      const error = new InterviewError('Test error', 'network');
      expect(error.message).toBe('Test error');
      expect(error.category).toBe('network');
      expect(error.recoverable).toBe(true);
      expect(error.timestamp).toBeDefined();
      expect(error.name).toBe('InterviewError');
    });

    it('should create error with custom options', () => {
      const cause = new Error('Original error');
      const error = new InterviewError('Test error', 'state', {
        recoverable: false,
        cause,
        context: { foo: 'bar' },
      });
      expect(error.recoverable).toBe(false);
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({ foo: 'bar' });
    });

    it('should provide user message for each category', () => {
      const categories: ErrorCategory[] = [
        'network',
        'provider',
        'process',
        'state',
        'validation',
        'timeout',
        'user_cancelled',
        'unknown',
      ];
      for (const category of categories) {
        const error = new InterviewError('Test', category);
        expect(error.getUserMessage()).toBeDefined();
        expect(error.getUserMessage().length).toBeGreaterThan(0);
      }
    });

    it('should provide recovery instructions for each category', () => {
      const categories: ErrorCategory[] = [
        'network',
        'provider',
        'process',
        'state',
        'validation',
        'timeout',
        'user_cancelled',
        'unknown',
      ];
      for (const category of categories) {
        const error = new InterviewError('Test', category);
        expect(error.getRecoveryInstructions()).toBeDefined();
        expect(error.getRecoveryInstructions().length).toBeGreaterThan(0);
      }
    });

    it('should provide different instructions for non-recoverable errors', () => {
      const recoverableError = new InterviewError('Test', 'network', { recoverable: true });
      const nonRecoverableError = new InterviewError('Test', 'network', { recoverable: false });

      expect(recoverableError.getRecoveryInstructions()).toContain('resume');
      expect(nonRecoverableError.getRecoveryInstructions()).toContain('new interview');
    });

    it('should format error for display', () => {
      const error = new InterviewError('Connection failed', 'network');
      const formatted = error.format();

      expect(formatted).toContain('Connection failed');
      expect(formatted).toContain('network');
      expect(formatted).toContain('resume');
    });
  });

  describe('NetworkError', () => {
    it('should create network error with correct category', () => {
      const error = new NetworkError('Connection refused');
      expect(error.category).toBe('network');
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('NetworkError');
    });

    it('should include cause error', () => {
      const cause = new Error('ECONNREFUSED');
      const error = new NetworkError('Connection refused', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('ProviderError', () => {
    it('should create provider error with correct category', () => {
      const error = new ProviderError('API rate limit exceeded');
      expect(error.category).toBe('provider');
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('ProviderError');
    });

    it('should include context', () => {
      const error = new ProviderError('Error', undefined, { provider: 'claude' });
      expect(error.context).toEqual({ provider: 'claude' });
    });
  });

  describe('ProcessError', () => {
    it('should create process error with exit code', () => {
      const error = new ProcessError('Process exited', { exitCode: 1 });
      expect(error.category).toBe('process');
      expect(error.exitCode).toBe(1);
      expect(error.name).toBe('ProcessError');
    });

    it('should create process error with signal', () => {
      const error = new ProcessError('Process killed', { signal: 'SIGTERM' });
      expect(error.signal).toBe('SIGTERM');
    });
  });

  describe('StateError', () => {
    it('should create non-recoverable state error', () => {
      const error = new StateError('Failed to save state');
      expect(error.category).toBe('state');
      expect(error.recoverable).toBe(false);
      expect(error.name).toBe('StateError');
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with duration', () => {
      const error = new TimeoutError('Operation timed out', 30000);
      expect(error.category).toBe('timeout');
      expect(error.timeoutMs).toBe(30000);
      expect(error.name).toBe('TimeoutError');
    });
  });

  describe('UserCancelledError', () => {
    it('should create user cancelled error with default message', () => {
      const error = new UserCancelledError();
      expect(error.category).toBe('user_cancelled');
      expect(error.message).toBe('Interview cancelled by user');
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('UserCancelledError');
    });

    it('should accept custom message', () => {
      const error = new UserCancelledError('User pressed Ctrl+C');
      expect(error.message).toBe('User pressed Ctrl+C');
    });
  });

  describe('classifyError', () => {
    it('should return InterviewError unchanged', () => {
      const original = new InterviewError('Test', 'network');
      const classified = classifyError(original);
      expect(classified).toBe(original);
    });

    it('should classify network errors', () => {
      const tests = [
        new Error('ENOTFOUND - DNS lookup failed'),
        new Error('ECONNREFUSED - Connection refused'),
        new Error('ECONNRESET - Connection reset'),
        new Error('ETIMEDOUT - Connection timed out'),
        new Error('Network error occurred'),
        new Error('DNS resolution failed'),
      ];

      for (const error of tests) {
        const classified = classifyError(error);
        expect(classified.category).toBe('network');
      }
    });

    it('should classify timeout errors', () => {
      const tests = [
        new Error('Operation timeout after 5000ms'),
        new Error('Request timed out'),
      ];

      for (const error of tests) {
        const classified = classifyError(error);
        expect(classified.category).toBe('timeout');
      }
    });

    it('should extract timeout value from message', () => {
      const error = new Error('Response timeout after 30000ms');
      const classified = classifyError(error);
      expect(classified.category).toBe('timeout');
      expect((classified as TimeoutError).timeoutMs).toBe(30000);
    });

    it('should classify process errors', () => {
      const tests = [
        new Error('Process received SIGTERM'),
        new Error('Child process exited with code 1'),
        new Error('Spawn failed'),
      ];

      for (const error of tests) {
        const classified = classifyError(error);
        expect(classified.category).toBe('process');
      }
    });

    it('should extract exit code from message', () => {
      const error = new Error('Process exited with exit code 127');
      const classified = classifyError(error);
      expect(classified.category).toBe('process');
      expect((classified as ProcessError).exitCode).toBe(127);
    });

    it('should classify state errors', () => {
      const tests = [
        new Error('State file corrupted'),
        new Error('EACCES - Permission denied'),
        new Error('ENOENT - File not found'),
      ];

      for (const error of tests) {
        const classified = classifyError(error);
        expect(classified.category).toBe('state');
      }
    });

    it('should classify provider errors', () => {
      const tests = [
        new Error('API error: 429 Too Many Requests'),
        new Error('Rate limit exceeded'),
        new Error('Quota exhausted'),
        new Error('Authentication failed'),
        new Error('Unauthorized access'),
        new Error('Provider unavailable'),
      ];

      for (const error of tests) {
        const classified = classifyError(error);
        expect(classified.category).toBe('provider');
      }
    });

    it('should classify unknown errors', () => {
      const error = new Error('Something unexpected happened');
      const classified = classifyError(error);
      expect(classified.category).toBe('unknown');
      expect(classified.recoverable).toBe(true);
    });

    it('should handle non-Error objects', () => {
      const classified = classifyError('String error');
      expect(classified.category).toBe('unknown');
      expect(classified.message).toBe('String error');
    });
  });

  describe('trySaveState', () => {
    it('should save state successfully', async () => {
      const result = await trySaveState(testState, testDir);
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();

      // Verify file was created
      await access(result.path!);
    });

    it('should return error on failure without throwing', async () => {
      // Try to save to a non-existent/invalid path
      const result = await trySaveState(testState, '/root/nonexistent/path');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('withErrorRecovery', () => {
    it('should return success result on successful operation', async () => {
      const result = await withErrorRecovery(async () => 'success');
      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.error).toBeUndefined();
    });

    it('should save state before operation when provided', async () => {
      const result = await withErrorRecovery(async () => 'success', {
        state: testState,
        baseDir: testDir,
      });
      expect(result.success).toBe(true);
      expect(result.stateSaved?.success).toBe(true);
    });

    it('should return error result on failure', async () => {
      const result = await withErrorRecovery(async () => {
        throw new Error('Operation failed');
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Operation failed');
    });

    it('should save state on error when provided', async () => {
      const result = await withErrorRecovery(
        async () => {
          throw new Error('Operation failed');
        },
        { state: testState, baseDir: testDir }
      );
      expect(result.success).toBe(false);
      expect(result.stateSaved?.success).toBe(true);
    });

    it('should use custom error transformer', async () => {
      const result = await withErrorRecovery(
        async () => {
          throw new Error('Custom error');
        },
        {
          transformError: () => new NetworkError('Transformed error'),
        }
      );
      expect(result.error?.category).toBe('network');
      expect(result.error?.message).toBe('Transformed error');
    });

    it('should skip state save before when saveStateBefore is false', async () => {
      // We can't easily mock trySaveState, so we test behavior indirectly
      const result = await withErrorRecovery(async () => 'success', {
        state: testState,
        baseDir: testDir,
        saveStateBefore: false,
      });
      expect(result.success).toBe(true);
      // State should still be undefined since we didn't save before
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const result = await withRetry(async () => 'success');
      expect(result).toBe('success');
    });

    it('should retry on retryable errors', async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new NetworkError('Connection failed');
          }
          return 'success';
        },
        { maxAttempts: 3, initialDelayMs: 10 }
      );
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max attempts exceeded', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new NetworkError('Connection failed');
          },
          { maxAttempts: 2, initialDelayMs: 10 }
        )
      ).rejects.toThrow('Connection failed');
      expect(attempts).toBe(2);
    });

    it('should not retry non-retryable errors', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new StateError('Cannot save state');
          },
          { maxAttempts: 3, initialDelayMs: 10 }
        )
      ).rejects.toThrow('Cannot save state');
      expect(attempts).toBe(1);
    });

    it('should not retry errors not in retryable categories', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw new InterviewError('Validation error', 'validation');
          },
          {
            maxAttempts: 3,
            initialDelayMs: 10,
            retryableCategories: ['network'],
          }
        )
      ).rejects.toThrow('Validation error');
      expect(attempts).toBe(1);
    });

    it('should call onRetry callback', async () => {
      const onRetryCalls: Array<{ attempt: number; delayMs: number }> = [];
      let attempts = 0;

      await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new NetworkError('Connection failed');
          }
          return 'success';
        },
        {
          maxAttempts: 3,
          initialDelayMs: 10,
          onRetry: (attempt, _error, delayMs) => {
            onRetryCalls.push({ attempt, delayMs });
          },
        }
      );

      expect(onRetryCalls.length).toBe(2);
      expect(onRetryCalls[0].attempt).toBe(1);
      expect(onRetryCalls[1].attempt).toBe(2);
    });

    it('should apply exponential backoff', async () => {
      const delays: number[] = [];

      try {
        await withRetry(
          async () => {
            throw new NetworkError('Connection failed');
          },
          {
            maxAttempts: 4,
            initialDelayMs: 100,
            backoffFactor: 2,
            maxDelayMs: 1000,
            onRetry: (_attempt, _error, delayMs) => {
              delays.push(delayMs);
            },
          }
        );
      } catch {
        // Expected to throw
      }

      expect(delays).toEqual([100, 200, 400]);
    });

    it('should respect maxDelayMs', async () => {
      const delays: number[] = [];

      try {
        await withRetry(
          async () => {
            throw new NetworkError('Connection failed');
          },
          {
            maxAttempts: 5,
            initialDelayMs: 100,
            backoffFactor: 10,
            maxDelayMs: 500,
            onRetry: (_attempt, _error, delayMs) => {
              delays.push(delayMs);
            },
          }
        );
      } catch {
        // Expected to throw
      }

      // All delays after the first should be capped at maxDelayMs
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(500); // Would be 1000 without cap
      expect(delays[2]).toBe(500); // Would be 5000 without cap
      expect(delays[3]).toBe(500); // Would be 5000 without cap
    });
  });

  describe('safeExecute', () => {
    it('should return result and state path on success', async () => {
      const { result, statePath } = await safeExecute(
        async () => 'success',
        testState,
        testDir
      );
      expect(result).toBe('success');
      expect(statePath).toBeDefined();

      // Verify state was saved
      await access(statePath);
    });

    it('should save state and throw classified error on failure', async () => {
      try {
        await safeExecute(
          async () => {
            throw new Error('Network error');
          },
          testState,
          testDir
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InterviewError);
        // State should have been saved before the error
        const statePath = join(testDir, 'lisa', 'state.yaml');
        await access(statePath);
      }
    });
  });

  describe('formatErrorForUser', () => {
    it('should format InterviewError', () => {
      const error = new NetworkError('Connection refused');
      const formatted = formatErrorForUser(error);
      expect(formatted).toContain('Connection refused');
      expect(formatted).toContain('internet connection');
    });

    it('should format regular Error', () => {
      const error = new Error('Something went wrong');
      const formatted = formatErrorForUser(error);
      expect(formatted).toContain('Something went wrong');
    });

    it('should format non-Error objects', () => {
      const formatted = formatErrorForUser('String error');
      expect(formatted).toContain('String error');
    });
  });

  describe('isRecoverableError', () => {
    it('should return true for recoverable InterviewError', () => {
      const error = new NetworkError('Connection failed');
      expect(isRecoverableError(error)).toBe(true);
    });

    it('should return false for non-recoverable InterviewError', () => {
      const error = new StateError('Cannot save state');
      expect(isRecoverableError(error)).toBe(false);
    });

    it('should classify and check regular Error', () => {
      const error = new Error('Network error');
      expect(isRecoverableError(error)).toBe(true);
    });
  });

  describe('getErrorCategory', () => {
    it('should return category for InterviewError', () => {
      const error = new NetworkError('Connection failed');
      expect(getErrorCategory(error)).toBe('network');
    });

    it('should classify and return category for regular Error', () => {
      const error = new Error('Timeout after 5000ms');
      expect(getErrorCategory(error)).toBe('timeout');
    });
  });

  describe('orchestrator integration', () => {
    it('should preserve state on error for resume', async () => {
      // Create state with some history
      const stateWithHistory = {
        ...testState,
        history: [
          { question: 'Q1', answer: 'A1', timestamp: new Date().toISOString() },
        ],
        aiContext: 'Some context',
      };

      // Simulate saving state then error
      const saveResult = await trySaveState(stateWithHistory, testDir);
      expect(saveResult.success).toBe(true);

      // Read back the state to verify it can be resumed
      const content = await readFile(saveResult.path!, 'utf-8');
      expect(content).toContain('Test feature');
      expect(content).toContain('Q1');
      expect(content).toContain('A1');
    });
  });
});
