/**
 * Tests for OpenCode CLI Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeProvider, createOpenCodeProvider } from './opencode.js';
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
  _processEmitter: EventEmitter;
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

  // Track killed state
  let isKilled = false;

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
    kill: vi.fn((_signal?: string) => {
      isKilled = true;
      // Emit exit event asynchronously to simulate real process behavior
      setImmediate(() => {
        processEmitter.emit('exit', 0, null);
      });
      return true;
    }),
    get killed() {
      return isKilled;
    },
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
    _processEmitter: EventEmitter;
  };

  return mockProcess;
}

describe('OpenCodeProvider', () => {
  let provider: OpenCodeProvider;
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenCodeProvider();
    mockProcess = createMockProcess();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe('constructor', () => {
    it('should create provider with default settings', () => {
      expect(provider.name).toBe('opencode');
      expect(provider.displayName).toBe('OpenCode');
      expect(provider.command).toBe('opencode');
    });

    it('should accept custom config', () => {
      const customProvider = new OpenCodeProvider({
        command: 'custom-opencode',
        args: ['--custom-arg'],
        env: { CUSTOM_VAR: 'value' },
      });

      expect(customProvider.command).toBe('custom-opencode');
    });
  });

  describe('isAvailable', () => {
    it('should return true when opencode CLI is available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when opencode CLI is not available', async () => {
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
            callback(null, { stdout: 'opencode version 1.0.0\n', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBe('opencode version 1.0.0');
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
    it('should spawn opencode process with correct arguments', async () => {
      // Mock isAvailable to return true
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('You are a helpful assistant');

      expect(spawn).toHaveBeenCalledWith(
        'opencode',
        expect.arrayContaining(['run', 'You are a helpful assistant', '--format', 'json', '--quiet']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should throw ProviderStateError if already running', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
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
  });

  describe('isRunning', () => {
    it('should return false when not spawned', () => {
      expect(provider.isRunning()).toBe(false);
    });

    it('should return true when spawned and not killed', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
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
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
    });

    it('should spawn new process for each message', async () => {
      await provider.spawn('System prompt');

      // Create new mock for second spawn
      const secondMockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(secondMockProcess as unknown as ChildProcess);

      await provider.send({ content: 'Hello, OpenCode!' });

      // Should have spawned twice (initial + send)
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(spawn).toHaveBeenLastCalledWith(
        'opencode',
        expect.arrayContaining(['run', 'Hello, OpenCode!', '--format', 'json', '--quiet']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should throw ProviderNotAvailableError if CLI not available', async () => {
      await provider.spawn('System prompt');

      // Make CLI unavailable for send
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      await expect(provider.send({ content: 'Test' })).rejects.toThrow(
        ProviderNotAvailableError
      );
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
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

    it('should parse message.part.updated with text', async () => {
      const receivePromise = provider.receive();

      // Simulate stdout data with session.idle to complete
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message.part.updated","text":"Hello from OpenCode!"}\n')
      );
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.idle"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Hello from OpenCode!');
      expect(response.isComplete).toBe(true);
    });

    it('should parse message.part.updated with tool output', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message.part.updated","tool":"bash","output":"ls -la result"}\n')
      );
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.idle"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toContain('[bash]: ls -la result');
      expect(response.isComplete).toBe(true);
    });

    it('should parse session.idle as complete', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.idle"}\n')
      );

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should timeout if no response received', async () => {
      provider.setResponseTimeout(100); // Very short timeout

      await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      await expect(provider.receive()).rejects.toThrow(
        'Timeout waiting for OpenCode response'
      );
    });

    it('should handle session.error message type', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.error","error":"Something went wrong"}\n')
      );

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });

    it('should handle process exit with error', async () => {
      const receivePromise = provider.receive();

      // Simulate process exit with error code
      mockProcess._processEmitter.emit('exit', 1, null);

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });

    it('should handle process exit with success and accumulated content', async () => {
      const receivePromise = provider.receive();

      // Simulate some content then successful exit
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message.part.updated","text":"Some content"}\n')
      );

      // Simulate successful exit (code 0)
      mockProcess._processEmitter.emit('exit', 0, null);

      const response = await receivePromise;

      expect(response.content).toBe('Some content');
      expect(response.isComplete).toBe(true);
    });

    it('should accumulate streaming content', async () => {
      const receivePromise = provider.receive();

      // Simulate multiple streaming updates
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message.part.updated","text":"Hello "}\n')
      );
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message.part.updated","text":"World"}\n')
      );
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.idle"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Hello World');
      expect(response.isComplete).toBe(true);
    });

    it('should handle text field directly in event', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"text":"Direct text response"}\n')
      );
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"session.idle"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Direct text response');
      expect(response.isComplete).toBe(true);
    });

    it('should handle output field as final result', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"output":"Final output result"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Final output result');
      expect(response.isComplete).toBe(true);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/opencode', stderr: '' });
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

describe('createOpenCodeProvider', () => {
  it('should create an OpenCodeProvider instance', () => {
    const provider = createOpenCodeProvider();
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });

  it('should pass config to the provider', () => {
    const provider = createOpenCodeProvider({
      args: ['--custom'],
    });
    expect(provider).toBeInstanceOf(OpenCodeProvider);
  });
});

describe('OpenCodeProvider registration', () => {
  it('should be registered in the global provider registry', () => {
    expect(providerRegistry.has('opencode')).toBe(true);
  });

  it('should create OpenCodeProvider through registry', () => {
    const provider = providerRegistry.get('opencode');
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe('opencode');
  });
});
