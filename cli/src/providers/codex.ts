/**
 * Codex CLI Provider
 * Implements the AIProvider interface for OpenAI Codex CLI
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';
import {
  BaseProvider,
  type ProviderConfig,
  type ProviderMessage,
  type ProviderResponse,
  type ProviderName,
  ProviderStateError,
  ProviderNotAvailableError,
} from './base.js';

const exec = promisify(execCallback);

/**
 * Buffer for accumulating stdout data
 */
interface OutputBuffer {
  data: string;
  resolve: ((value: ProviderResponse) => void) | null;
  reject: ((error: Error) => void) | null;
}

/**
 * Codex event types from JSON Lines output format
 *
 * Codex outputs newline-delimited JSON events with types:
 * - thread.started - Session started
 * - turn.started - AI turn started
 * - turn.completed - AI turn completed with response
 * - turn.failed - AI turn failed
 * - item.started / item.completed - Individual items (messages, tools, etc.)
 * - error - Error occurred
 */
interface CodexEvent {
  type: string;
  id?: string;
  status?: string;
  text?: string;
  content?: string;
  message?: string;
  result?: string;
  error?: string;
  input_tokens?: number;
  output_tokens?: number;
  // Additional fields for different event types
  [key: string]: unknown;
}

/**
 * Codex CLI Provider
 *
 * Spawns and communicates with the OpenAI Codex CLI tool.
 * Uses the `codex exec` command for non-interactive mode.
 *
 * Codex supports:
 * - Non-interactive mode via `codex exec "prompt"`
 * - JSON Lines output with `--json` flag
 * - Full auto mode with `--full-auto` flag
 */
export class CodexProvider extends BaseProvider {
  readonly name: ProviderName = 'codex';
  readonly displayName = 'Codex';
  readonly command = 'codex';

  private outputBuffer: OutputBuffer = {
    data: '',
    resolve: null,
    reject: null,
  };

  private responseTimeout = 300000; // 5 minutes default timeout
  private accumulatedContent = ''; // Accumulate streaming content

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // Override command if provided in config
    if (config?.command) {
      (this as { command: string }).command = config.command;
    }
  }

  /**
   * Check if the Codex CLI is installed and available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await exec(`which ${this.command}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the Codex CLI version
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await exec(`${this.command} --version`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Spawn the Codex CLI process with the given system prompt
   *
   * @param systemPrompt Initial system prompt for the conversation
   * @throws ProviderNotAvailableError if CLI is not installed
   * @throws ProviderStateError if already running
   */
  async spawn(systemPrompt: string): Promise<void> {
    if (this.isRunning()) {
      throw new ProviderStateError('Provider is already running');
    }

    if (!(await this.isAvailable())) {
      throw new ProviderNotAvailableError(this.name, this.command);
    }

    // Build command arguments for non-interactive mode
    // codex exec "prompt" --json
    const args = [
      'exec',
      systemPrompt,
      '--json', // JSON Lines output for structured parsing
      ...(this.config.args ?? []),
    ];

    // Spawn the codex process
    this.process = spawn(this.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.config.env,
      },
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for the child process
   */
  private setupEventHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString('utf-8'));
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.handleStderr(chunk.toString('utf-8'));
    });

    this.process.on('error', (error: Error) => {
      if (this.outputBuffer.reject) {
        this.outputBuffer.reject(error);
        this.outputBuffer.resolve = null;
        this.outputBuffer.reject = null;
      }
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      // For Codex, exit with code 0 is normal completion
      // Resolve with accumulated content if we have any
      if (code === 0 && this.outputBuffer.resolve) {
        this.outputBuffer.resolve({
          content: this.accumulatedContent,
          isComplete: true,
        });
        this.outputBuffer.resolve = null;
        this.outputBuffer.reject = null;
        this.accumulatedContent = '';
      } else if (this.outputBuffer.reject && (code !== 0 || signal)) {
        this.outputBuffer.reject(
          new ProviderStateError(`Process exited with code ${code}, signal ${signal}`)
        );
        this.outputBuffer.resolve = null;
        this.outputBuffer.reject = null;
      }
    });
  }

  /**
   * Handle stdout data from the codex process
   */
  private handleStdout(data: string): void {
    this.outputBuffer.data += data;

    // Codex outputs JSON Lines format with one JSON object per line
    const lines = this.outputBuffer.data.split('\n');

    // Keep the last incomplete line in the buffer
    this.outputBuffer.data = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = this.parseCodexEvent(line);
        if (parsed && this.outputBuffer.resolve) {
          // Accumulate content for streaming
          if (parsed.content) {
            this.accumulatedContent += parsed.content;
          }

          // Resolve with current response (whether streaming or complete)
          if (parsed.isComplete) {
            this.outputBuffer.resolve({
              content: this.accumulatedContent || parsed.content,
              isComplete: true,
              structured: parsed.structured,
            });
            this.accumulatedContent = '';
          } else {
            this.outputBuffer.resolve(parsed);
          }
          this.outputBuffer.resolve = null;
          this.outputBuffer.reject = null;
        }
      } catch (error) {
        // If it's a ProviderStateError (from parseCodexEvent throwing on error type), reject
        if (error instanceof ProviderStateError && this.outputBuffer.reject) {
          this.outputBuffer.reject(error);
          this.outputBuffer.resolve = null;
          this.outputBuffer.reject = null;
        } else {
          // Line wasn't valid JSON, might be plain text output
          // Accumulate it as content
          this.accumulatedContent += line + '\n';
        }
      }
    }
  }

  /**
   * Handle stderr data from the codex process
   */
  private handleStderr(data: string): void {
    // Log stderr but don't treat it as an error unless it's critical
    if (data.includes('error') || data.includes('Error')) {
      console.error('[Codex stderr]:', data);
    }
  }

  /**
   * Parse a JSON Lines event from Codex
   *
   * Codex's JSON Lines format includes various event types:
   * - {"type": "thread.started"} - Session started
   * - {"type": "turn.started"} - AI turn started
   * - {"type": "turn.completed", "text": "..."} - AI response
   * - {"type": "turn.failed", "error": "..."} - Error
   * - {"type": "item.completed", "text": "..."} - Item completed
   * - {"type": "error", "message": "..."} - Error occurred
   */
  private parseCodexEvent(line: string): ProviderResponse | null {
    const event: CodexEvent = JSON.parse(line);

    // Handle turn.completed - the main response type
    if (event.type === 'turn.completed') {
      const content = event.text ?? event.content ?? event.message ?? '';
      return {
        content,
        isComplete: true,
        structured: event,
      };
    }

    // Handle item.completed - streaming updates
    if (event.type === 'item.completed') {
      const content = event.text ?? event.content ?? '';
      return {
        content,
        isComplete: false,
        structured: event,
      };
    }

    // Handle item.started - streaming indication
    if (event.type === 'item.started') {
      return {
        content: '',
        isComplete: false,
        structured: event,
      };
    }

    // Handle turn.failed
    if (event.type === 'turn.failed') {
      throw new ProviderStateError(`Codex turn failed: ${event.error ?? JSON.stringify(event)}`);
    }

    // Handle error event
    if (event.type === 'error') {
      throw new ProviderStateError(`Codex error: ${event.message ?? event.error ?? JSON.stringify(event)}`);
    }

    // Handle thread.started - session beginning
    if (event.type === 'thread.started') {
      return {
        content: '',
        isComplete: false,
        structured: event,
      };
    }

    // Handle turn.started - turn beginning
    if (event.type === 'turn.started') {
      return {
        content: '',
        isComplete: false,
        structured: event,
      };
    }

    // Handle direct text/content fields (for compatibility)
    if (event.text || event.content) {
      return {
        content: event.text ?? event.content ?? '',
        isComplete: false,
        structured: event,
      };
    }

    // Handle result field (for final results)
    if (event.result) {
      return {
        content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
        isComplete: true,
        structured: event,
      };
    }

    // Handle message field
    if (event.message && event.type !== 'error') {
      return {
        content: event.message,
        isComplete: true,
        structured: event,
      };
    }

    // Unknown type, return null
    return null;
  }

  /**
   * Send a message to the Codex process
   *
   * Note: Codex's `exec` command takes the prompt as an argument.
   * For multi-turn conversations, we spawn a new process for each message.
   *
   * @param message The message to send
   * @throws ProviderStateError if process is not running
   */
  async send(message: ProviderMessage): Promise<void> {
    // For Codex, each message starts a new exec command
    // First cleanup the existing process if running
    if (this.isRunning()) {
      await this.cleanup();
    }

    if (!(await this.isAvailable())) {
      throw new ProviderNotAvailableError(this.name, this.command);
    }

    // Reset accumulated content
    this.accumulatedContent = '';

    // Build command arguments for the new prompt
    const args = [
      'exec',
      message.content,
      '--json',
      ...(this.config.args ?? []),
    ];

    // Spawn new codex process
    this.process = spawn(this.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.config.env,
      },
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Receive a response from Codex
   *
   * @returns Promise resolving to the AI's response
   * @throws ProviderStateError if process is not running or times out
   */
  async receive(): Promise<ProviderResponse> {
    if (!this.isRunning()) {
      throw new ProviderStateError('Provider is not running');
    }

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.outputBuffer.resolve = null;
        this.outputBuffer.reject = null;
        reject(new ProviderStateError('Timeout waiting for Codex response'));
      }, this.responseTimeout);

      // Store the resolve/reject for when data arrives
      this.outputBuffer.resolve = (response: ProviderResponse) => {
        clearTimeout(timeoutId);
        resolve(response);
      };

      this.outputBuffer.reject = (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      };

      // Check if we already have complete data in the buffer
      if (this.outputBuffer.data.trim()) {
        const lines = this.outputBuffer.data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = this.parseCodexEvent(line);
            if (parsed && parsed.isComplete) {
              clearTimeout(timeoutId);
              this.outputBuffer.data = '';
              this.outputBuffer.resolve = null;
              this.outputBuffer.reject = null;
              resolve({
                content: this.accumulatedContent || parsed.content,
                isComplete: true,
                structured: parsed.structured,
              });
              this.accumulatedContent = '';
              return;
            }
          } catch {
            // Continue to wait for more data
          }
        }
      }
    });
  }

  /**
   * Set the response timeout
   *
   * @param timeoutMs Timeout in milliseconds
   */
  setResponseTimeout(timeoutMs: number): void {
    this.responseTimeout = timeoutMs;
  }

  /**
   * Clean up resources and terminate the process
   */
  async cleanup(): Promise<void> {
    // Clear any pending promises
    if (this.outputBuffer.reject) {
      this.outputBuffer.reject(new ProviderStateError('Provider cleanup initiated'));
    }
    this.outputBuffer = {
      data: '',
      resolve: null,
      reject: null,
    };
    this.accumulatedContent = '';

    // Call parent cleanup
    await super.cleanup();
  }
}

/**
 * Factory function for creating CodexProvider instances
 */
export function createCodexProvider(config?: Partial<ProviderConfig>): CodexProvider {
  return new CodexProvider(config);
}
