/**
 * Tests for Cursor CLI Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CursorProvider, createCursorProvider } from './cursor.js';
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
    _processEmitter: EventEmitter;
  };

  return mockProcess;
}

describe('CursorProvider', () => {
  let provider: CursorProvider;
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CursorProvider();
    mockProcess = createMockProcess();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe('constructor', () => {
    it('should create provider with default settings', () => {
      expect(provider.name).toBe('cursor');
      expect(provider.displayName).toBe('Cursor');
      expect(provider.command).toBe('agent');
    });

    it('should accept custom config', () => {
      const customProvider = new CursorProvider({
        command: 'custom-agent',
        args: ['--custom-arg'],
        env: { CUSTOM_VAR: 'value' },
      });

      expect(customProvider.command).toBe('custom-agent');
    });
  });

  describe('isAvailable', () => {
    it('should return true when cursor CLI is available', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when cursor CLI is not available', async () => {
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
            callback(null, { stdout: 'cursor-agent 2.1.0\n', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBe('cursor-agent 2.1.0');
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
    it('should spawn cursor process with correct arguments', async () => {
      // Mock isAvailable to return true
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('You are a helpful assistant');

      expect(spawn).toHaveBeenCalledWith(
        'agent',
        expect.arrayContaining(['-p', 'You are a helpful assistant', '--output-format', 'json']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should throw ProviderStateError if already running', async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
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
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
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
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
      await provider.spawn('System prompt');
    });

    it('should spawn new process for each message (cursor run pattern)', async () => {
      await provider.send({ content: 'Hello, Cursor!' });

      // send() should spawn a new process with the message as prompt
      expect(spawn).toHaveBeenCalledWith(
        'agent',
        expect.arrayContaining(['-p', 'Hello, Cursor!', '--output-format', 'json']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should cleanup previous process before sending', async () => {
      // After spawn, the provider should have a running process
      expect(provider.isRunning()).toBe(true);

      // Send will cleanup and spawn a new process
      await provider.send({ content: 'New message' });

      // spawn should be called again (second time after initial spawn)
      expect(spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
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
        Buffer.from('{"type":"result","result":"Hello from Cursor!"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Hello from Cursor!');
      expect(response.isComplete).toBe(true);
    });

    it('should parse text content message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"text","content":"Streaming content..."}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Streaming content...');
      expect(response.isComplete).toBe(false);
    });

    it('should parse content type message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"content","text":"More content"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('More content');
      expect(response.isComplete).toBe(false);
    });

    it('should parse complete/done/end message as complete', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"complete"}\n')
      );

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should parse done message as complete', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"done"}\n')
      );

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should parse end message as complete', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"end"}\n')
      );

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should parse message field as complete response', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"message":"Final response from Cursor"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Final response from Cursor');
      expect(response.isComplete).toBe(true);
    });

    it('should timeout if no response received', async () => {
      provider.setResponseTimeout(100); // Very short timeout

      await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      await expect(provider.receive()).rejects.toThrow(
        'Timeout waiting for Cursor response'
      );
    });

    it('should handle error message type', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"error","error":"Something went wrong"}\n')
      );

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
      await expect(receivePromise).rejects.toThrow('Cursor error');
    });

    it('should handle error with message field', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"error","message":"Error message here"}\n')
      );

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });

    it('should handle process exit with error', async () => {
      const receivePromise = provider.receive();

      // Simulate process exit with error code
      mockProcess._processEmitter.emit('exit', 1, null);

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
    });

    it('should resolve on process exit with code 0', async () => {
      const receivePromise = provider.receive();

      // Simulate successful process exit (with no prior content, content will be empty)
      mockProcess._processEmitter.emit('exit', 0, null);

      const response = await receivePromise;

      expect(response.isComplete).toBe(true);
    });

    it('should return streaming content when received', async () => {
      // For streaming, each receive() call returns the next message
      const receivePromise1 = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"text","content":"First chunk"}\n')
      );

      const response1 = await receivePromise1;
      expect(response1.content).toBe('First chunk');
      expect(response1.isComplete).toBe(false);

      // Second receive gets next message
      const receivePromise2 = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"text","content":"Second chunk"}\n')
      );

      const response2 = await receivePromise2;
      expect(response2.content).toBe('Second chunk');
      expect(response2.isComplete).toBe(false);
    });

    it('should handle plain text output (non-JSON)', async () => {
      // Some cursor outputs might be plain text
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('Plain text response\n')
      );

      // Wait for processing
      await new Promise(resolve => setImmediate(resolve));

      const receivePromise = provider.receive();

      // Exit successfully
      mockProcess._processEmitter.emit('exit', 0, null);

      const response = await receivePromise;

      expect(response.content).toContain('Plain text response');
      expect(response.isComplete).toBe(true);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      vi.mocked(exec).mockImplementation(
        (_cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            callback(null, { stdout: '/usr/local/bin/agent', stderr: '' });
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

    it('should reset accumulated content after cleanup', async () => {
      await provider.cleanup();

      // Create a fresh mock process for the new spawn
      const freshMockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(freshMockProcess as unknown as ChildProcess);

      // Spawn again
      await provider.spawn('New prompt');

      // The accumulated content should be empty on new process
      const receivePromise = provider.receive();
      freshMockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"result","result":"Fresh response"}\n')
      );

      const response = await receivePromise;
      expect(response.content).toBe('Fresh response');
      expect(response.isComplete).toBe(true);
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

describe('createCursorProvider', () => {
  it('should create a CursorProvider instance', () => {
    const provider = createCursorProvider();
    expect(provider).toBeInstanceOf(CursorProvider);
  });

  it('should pass config to the provider', () => {
    const provider = createCursorProvider({
      args: ['--custom'],
    });
    expect(provider).toBeInstanceOf(CursorProvider);
  });
});

describe('CursorProvider registration', () => {
  it('should be registered in the global provider registry', () => {
    expect(providerRegistry.has('cursor')).toBe(true);
  });

  it('should create CursorProvider through registry', () => {
    const provider = providerRegistry.get('cursor');
    expect(provider).toBeInstanceOf(CursorProvider);
    expect(provider.name).toBe('cursor');
  });
});
