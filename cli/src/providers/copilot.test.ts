/**
 * Tests for GitHub Copilot CLI Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotProvider, createCopilotProvider } from './copilot.js';
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

describe('CopilotProvider', () => {
  let provider: CopilotProvider;
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CopilotProvider();
    mockProcess = createMockProcess();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe('constructor', () => {
    it('should create provider with default settings', () => {
      expect(provider.name).toBe('copilot');
      expect(provider.displayName).toBe('GitHub Copilot');
      expect(provider.command).toBe('gh');
    });

    it('should accept custom config', () => {
      const customProvider = new CopilotProvider({
        command: 'custom-gh',
        args: ['--custom-arg'],
        env: { CUSTOM_VAR: 'value' },
      });

      expect(customProvider.command).toBe('custom-gh');
    });
  });

  describe('isAvailable', () => {
    it('should return true when gh CLI and copilot extension are available', async () => {
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot - GitHub Copilot in the CLI', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('should return false when gh CLI is not available', async () => {
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

    it('should return false when copilot extension is not installed', async () => {
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(new Error('extension not found'), { stdout: '', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return copilot version when available', async () => {
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('copilot --version')) {
              callback(null, { stdout: 'gh copilot 1.0.0\n', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBe('gh copilot 1.0.0');
    });

    it('should fallback to gh version when copilot version fails', async () => {
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('copilot --version')) {
              callback(new Error('command failed'), { stdout: '', stderr: '' });
            } else if (cmd.includes('--version')) {
              callback(null, { stdout: 'gh version 2.40.0\nother info', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      const version = await provider.getVersion();
      expect(version).toBe('gh gh version 2.40.0');
    });

    it('should return null when all version checks fail', async () => {
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
    it('should spawn copilot process with correct arguments', async () => {
      // Mock isAvailable to return true
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot - GitHub Copilot', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);

      await provider.spawn('You are a helpful assistant');

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['copilot', 'suggest', '-t', 'shell', 'You are a helpful assistant']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should throw ProviderStateError if already running', async () => {
      vi.mocked(exec).mockImplementation(
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot', stderr: '' });
            }
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
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot', stderr: '' });
            }
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
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot', stderr: '' });
            }
          }
          return {} as ReturnType<typeof exec>;
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ChildProcess);
      await provider.spawn('System prompt');
    });

    it('should spawn new process for each message (copilot command pattern)', async () => {
      await provider.send({ content: 'Hello, Copilot!' });

      // send() should spawn a new process with the message as prompt
      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['copilot', 'suggest', '-t', 'shell', 'Hello, Copilot!']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should use explain subcommand for explain requests', async () => {
      await provider.send({ content: 'Explain how this works' });

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['copilot', 'explain', 'Explain how this works']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should use explain subcommand for "what does" requests', async () => {
      await provider.send({ content: 'What does this command do?' });

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['copilot', 'explain']),
        expect.anything()
      );
    });

    it('should use explain subcommand for "how does" requests', async () => {
      await provider.send({ content: 'How does this function work?' });

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['copilot', 'explain']),
        expect.anything()
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
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot', stderr: '' });
            }
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

    it('should parse suggestion message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"suggestion":"ls -la"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('ls -la');
      expect(response.isComplete).toBe(true);
    });

    it('should parse explanation message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"explanation":"This command lists all files"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('This command lists all files');
      expect(response.isComplete).toBe(true);
    });

    it('should parse result type message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"result","text":"Result text"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Result text');
      expect(response.isComplete).toBe(true);
    });

    it('should parse complete type message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"complete","content":"Complete content"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Complete content');
      expect(response.isComplete).toBe(true);
    });

    it('should parse done type message', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"done","message":"Done message"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Done message');
      expect(response.isComplete).toBe(true);
    });

    it('should parse text type as streaming update', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"text","text":"Streaming text..."}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Streaming text...');
      expect(response.isComplete).toBe(false);
    });

    it('should parse content type as streaming update', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"content","content":"Streaming content..."}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Streaming content...');
      expect(response.isComplete).toBe(false);
    });

    it('should parse message type as streaming update', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"message","message":"Streaming message..."}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Streaming message...');
      expect(response.isComplete).toBe(false);
    });

    it('should parse direct text field', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"text":"Direct text content"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Direct text content');
      expect(response.isComplete).toBe(false);
    });

    it('should parse direct content field', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"content":"Direct content field"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Direct content field');
      expect(response.isComplete).toBe(false);
    });

    it('should parse result field as complete response', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"result":"Final result from Copilot"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Final result from Copilot');
      expect(response.isComplete).toBe(true);
    });

    it('should parse message field as complete response', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"message":"Final message from Copilot"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('Final message from Copilot');
      expect(response.isComplete).toBe(true);
    });

    it('should handle status field as informational', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"status":"processing"}\n')
      );

      const response = await receivePromise;

      expect(response.content).toBe('');
      expect(response.isComplete).toBe(false);
    });

    it('should timeout if no response received', async () => {
      provider.setResponseTimeout(100); // Very short timeout

      await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      await expect(provider.receive()).rejects.toThrow(
        'Timeout waiting for Copilot response'
      );
    });

    it('should handle error type event', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"type":"error","error":"Something went wrong"}\n')
      );

      await expect(receivePromise).rejects.toThrow(ProviderStateError);
      await expect(receivePromise).rejects.toThrow('Copilot error');
    });

    it('should handle error field in event', async () => {
      const receivePromise = provider.receive();

      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('{"error":"Error in error field"}\n')
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

    it('should accumulate streaming content', async () => {
      // Emit some content that gets accumulated
      mockProcess._stdoutEmitter.emit(
        'data',
        Buffer.from('Plain text line 1\n')
      );

      // Wait for processing
      await new Promise(resolve => setImmediate(resolve));

      const receivePromise = provider.receive();

      // Exit successfully
      mockProcess._processEmitter.emit('exit', 0, null);

      const response = await receivePromise;

      expect(response.content).toContain('Plain text line 1');
      expect(response.isComplete).toBe(true);
    });

    it('should handle plain text output (non-JSON)', async () => {
      // Some copilot outputs might be plain text
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
        (cmd: string, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (callback) {
            if (cmd.includes('which')) {
              callback(null, { stdout: '/usr/local/bin/gh', stderr: '' });
            } else if (cmd.includes('copilot --help')) {
              callback(null, { stdout: 'copilot', stderr: '' });
            }
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
        Buffer.from('{"suggestion":"Fresh response"}\n')
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

describe('createCopilotProvider', () => {
  it('should create a CopilotProvider instance', () => {
    const provider = createCopilotProvider();
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it('should pass config to the provider', () => {
    const provider = createCopilotProvider({
      args: ['--custom'],
    });
    expect(provider).toBeInstanceOf(CopilotProvider);
  });
});

describe('CopilotProvider registration', () => {
  it('should be registered in the global provider registry', () => {
    expect(providerRegistry.has('copilot')).toBe(true);
  });

  it('should create CopilotProvider through registry', () => {
    const provider = providerRegistry.get('copilot');
    expect(provider).toBeInstanceOf(CopilotProvider);
    expect(provider.name).toBe('copilot');
  });
});
