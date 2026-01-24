/**
 * Tests for Claude Code Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeProvider, createClaudeProvider } from './claude.js';
import { ProviderStateError, ProviderNotAvailableError } from './base.js';
import { providerRegistry } from './index.js';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { type Readable, type Writable } from 'node:stream';

// Mock child_process module
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
    exec: vi.fn(),
  };
});

// Import the mocked module
import { spawn, exec } from 'node:child_process';

// Helper to create mock process
function createMockProcess(): ChildProcess & {
  stdin: Writable & { write: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: Readable;
  _stdoutEmitter: EventEmitter;
  _stderrEmitter: EventEmitter;
} {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const processEmitter = new EventEmitter();

  const mockWrite = vi.fn(
    (
      _data: string,
      _encoding: BufferEncoding,
      callback?: (error?: Error | null) => void
    ) => {
      if (callback) callback(null);
      return true;
    }
  );

  const mockProcess = {
    stdin: {
      write: mockWrite,
      writable: true,
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      end: vi.fn(),
    } as unknown as Writable & { write: ReturnType<typeof vi.fn> },
    stdout: {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        stdoutEmitter.on(event, handler),
      once: (event: string, handler: (...args: unknown[]) => void) =>
        stdoutEmitter.once(event, handler),
      pipe: vi.fn(),
      readable: true,
    } as unknown as Readable,
    stderr: {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        stderrEmitter.on(event, handler),
      once: (event: string, handler: (...args: unknown[]) => void) =>
        stderrEmitter.once(event, handler),
      pipe: vi.fn(),
      readable: true,
    } as unknown as Readable,
    on: (event: string, handler: (...args: unknown[]) => void) =>
      processEmitter.on(event, handler),
    once: (event: string, handler: (...args: unknown[]) => void) =>
      processEmitter.once(event, handler),
    emit: (event: string, ...args: unknown[]) => processEmitter.emit(event, ...args),
    kill: vi.fn(() => true),
    killed: false,
    pid: 12345,
    _stdoutEmitter: stdoutEmitter,
    _stderrEmitter: stderrEmitter,
    _processEmitter: processEmitter,
  } as unknown as ChildProcess & {
    stdin: Writable & { write: ReturnType<typeof vi.fn> };
    stdout: Readable;
    stderr: Readable;
    _stdoutEmitter: EventEmitter;
    _stderrEmitter: EventEmitter;
  };

  return mockProcess;
}

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeProvider();
    mockProcess = createMockProcess();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe('constructor', () => {
    it('should create provider with default settings', () => {
      expect(provider.name).toBe('claude');
      expect(provider.displayName).toBe('Claude Code');
      expect(provider.command).toBe('claude');
    });

    it('should accept custom config', () => {
      const customProvider = new ClaudeProvider({
        command: 'custom-claude',
        args: ['--custom-arg'],
        env: { CUSTOM_VAR: 'value' },
      });

      expect(customProvider.command).toBe('custom-claude');
    });
  });

  describe('isAvailable', () => {
    it('should return true when claude CLI is available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when claude CLI is not available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version when available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: 'claude-code 1.2.3\n', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBe('claude-code 1.2.3');
    });

    it('should return null when version check fails', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('command failed'), { stdout: '', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBeNull();
    });
  });

  describe('spawn', () => {
    it('should spawn claude process with correct arguments', async () => {
      // Mock isAvailable to return true
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('You are a helpful assistant');

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--print', '--output-format', 'stream-json', '--verbose']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should throw ProviderStateError if already running', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('First spawn');

      await expect(provider.spawn('Second spawn')).rejects.toThrow(ProviderStateError);
      await expect(provider.spawn('Second spawn')).rejects.toThrow(
        'Provider is already running'
      );
    });

    it('should throw ProviderNotAvailableError if CLI not available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      await expect(provider.spawn('Test prompt')).rejects.toThrow(
        ProviderNotAvailableError
      );
    });

    it('should send system prompt after spawning', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('You are a helpful assistant');

      expect(mockProcess.stdin.write).toHaveBeenCalledWith(
        'You are a helpful assistant\n',
        'utf-8',
        expect.any(Function)
      );
    });
  });

  describe('isRunning', () => {
    it('should return false when not spawned', () => {
      expect(provider.isRunning()).toBe(false);
    });

    it('should return true when spawned and not killed', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('Test');

      expect(provider.isRunning()).toBe(true);
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
      await provider.spawn('System prompt');
    });

    it('should send message to stdin', async () => {
      await provider.send({ content: 'Hello, Claude!' });

      expect(mockProcess.stdin.write).toHaveBeenCalledWith(
        'Hello, Claude!\n',
        'utf-8',
        expect.any(Function)
      );
    });

    it('should throw ProviderStateError if not running', async () => {
      await provider.cleanup();

      await expect(provider.send({ content: 'Test' })).rejects.toThrow(
        ProviderStateError
      );
      await expect(provider.send({ content: 'Test' })).rejects.toThrow(
        'Provider is not running'
      );
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
      await provider.spawn('System prompt');
      provider.setResponseTimeout(1000); // Short timeout for tests
    });

    it('should throw ProviderStateError if not running', async () => {
      await provider.cleanup();

      await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      await expect(provider.receive()).rejects.toThrow('Provider is not running');
    });

    it('should parse result message', async () => {
      const receivePromise = provider.receive();

      // Simulate stdout data
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"result","result":"Hello, I am Claude!"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Hello, I am Claude!');
      expect(response.isComplete).toBe(true);
    });

    it('should parse assistant message with content array', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from(
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}\n'
        )
      );

      const response = await receivePromise;

      expect(response.content).toBe('Hello!');
      expect(response.isComplete).toBe(false);
    });

    it('should parse content_block_delta message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"content_block_delta","delta":{"type":"text_delta","text":"streaming text"}}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('streaming text');
      expect(response.isComplete).toBe(false);
    });

    it('should parse message_stop as complete', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message_stop"}\n')
      );

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should timeout if no response received', async () => {
      provider.setResponseTimeout(100); // Very short timeout

      await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      await expect(provider.receive()).rejects.toThrow(
        'Timeout waiting for Claude response'
      );
    });

    it('should handle error message type', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"error","error":{"message":"Something went wrong"}}\n')
      );

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });

    it('should handle process exit with error', async () => {
      const receivePromise = provider.receive();

      // Simulate process exit with error code
      (mockProcess as unknown as EventEmitter).emit('exit', 1, null);

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/claude', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
      await provider.spawn('System prompt');
    });

    it('should kill the process', async () => {
      await provider.cleanup();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should clear pending promises', async () => {
      const receivePromise = provider.receive();

      // Catch the rejection to prevent unhandled rejection warning
      receivePromise.catch(() => {
        // Expected rejection, ignore
      });

      await provider.cleanup();

      await expect(receivePromise).rejects.toThrow('Provider cleanup initiated');
    });

    it('should handle cleanup when not running', async () => {
      await provider.cleanup();

      // Should not throw
      await expect(provider.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('setResponseTimeout', () => {
    it('should update the response timeout', () => {
      provider.setResponseTimeout(60000);
      // The timeout is used internally, we can verify it was set by testing receive behavior
      // For now, just verify no error is thrown
      expect(() => provider.setResponseTimeout(60000)).not.toThrow();
    });
  });
});

describe('createClaudeProvider', () => {
  it('should create a ClaudeProvider instance', () => {
    const provider = createClaudeProvider();
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it('should pass config to the provider', () => {
    const provider = createClaudeProvider({
      args: ['--custom'],
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });
});

describe('ClaudeProvider registration', () => {
  it('should be registered in the global provider registry', () => {
    expect(providerRegistry.has('claude')).toBe(true);
  });

  it('should create ClaudeProvider through registry', () => {
    const provider = providerRegistry.get('claude');
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.name).toBe('claude');
  });
});
