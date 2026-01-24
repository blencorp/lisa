/**
 * Cursor CLI Provider
 * Implements the AIProvider interface for Cursor CLI (agent command)
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
 * Cursor event types from JSON output format
 */
interface CursorEvent {
  type: string;
  content?: string;
  text?: string;
  message?: string;
  result?: string;
  error?: string;
  // Additional fields for different event types
  [key: string]: unknown;
}

/**
 * Cursor CLI Provider
 *
 * Spawns and communicates with the Cursor CLI agent tool.
 * Uses stdin/stdout for communication with the cursor process.
 *
 * Cursor supports:
 * - Non-interactive mode via `agent -p "prompt"` or `agent "prompt"`
 * - JSON output format with `--output-format json`
 * - Different modes: agent (default), plan, ask
 */
export class CursorProvider extends BaseProvider {
  readonly name: ProviderName = 'cursor';
  readonly displayName = 'Cursor';
  readonly command = 'agent';

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
   * Check if the Cursor CLI is installed and available
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
   * Get the Cursor CLI version
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
   * Spawn the Cursor CLI process with the given system prompt
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
    // agent -p "prompt" --output-format json
    const args = [
      '-p', // Print mode for non-interactive output
      systemPrompt,
      '--output-format', 'json', // JSON output for structured parsing
      ...(this.config.args ?? []),
    ];

    // Spawn the cursor agent process
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
      // For Cursor, exit with code 0 is normal completion
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
   * Handle stdout data from the cursor process
   */
  private handleStdout(data: string): void {
    this.outputBuffer.data += data;

    // Cursor outputs JSON events with one JSON object per line
    const lines = this.outputBuffer.data.split('\n');

    // Keep the last incomplete line in the buffer
    this.outputBuffer.data = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = this.parseCursorEvent(line);
        if (parsed && this.outputBuffer.resolve) {
          // Accumulate content for streaming
          if (parsed.content) {
            this.accumulatedContent += parsed.content;
          }

          // Resolve with current response (whether streaming or complete)
          // If complete, use accumulated content; otherwise return the parsed response
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
        // If it's a ProviderStateError (from parseCursorEvent throwing on error type), reject
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
   * Handle stderr data from the cursor process
   */
  private handleStderr(data: string): void {
    // Log stderr but don't treat it as an error unless it's critical
    if (data.includes('error') || data.includes('Error')) {
      console.error('[Cursor stderr]:', data);
    }
  }

  /**
   * Parse a JSON event from Cursor
   *
   * Cursor's JSON format includes various event types:
   * - {"type": "text", "content": "..."} - Text content
   * - {"type": "result", "result": "..."} - Final result
   * - {"type": "error", "error": "..."} - Error occurred
   * - {"type": "complete"} - Completion signal
   */
  private parseCursorEvent(line: string): ProviderResponse | null {
    const event: CursorEvent = JSON.parse(line);

    // Handle different event types
    if (event.type === 'text' || event.type === 'content') {
      const content = event.content ?? event.text ?? '';
      return {
        content,
        isComplete: false,
        structured: event,
      };
    }

    if (event.type === 'result') {
      const content = typeof event.result === 'string'
        ? event.result
        : JSON.stringify(event.result);
      return {
        content,
        isComplete: true,
        structured: event,
      };
    }

    if (event.type === 'complete' || event.type === 'done' || event.type === 'end') {
      return {
        content: '',
        isComplete: true,
        structured: event,
      };
    }

    if (event.type === 'error') {
      throw new ProviderStateError(`Cursor error: ${event.error ?? event.message ?? JSON.stringify(event)}`);
    }

    // Handle content/text fields directly (some versions output these directly)
    if (event.content || event.text) {
      return {
        content: event.content ?? event.text ?? '',
        isComplete: false,
        structured: event,
      };
    }

    // Handle message field (for final results)
    if (event.message) {
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
   * Send a message to the Cursor process
   *
   * Note: Cursor's agent command with -p takes the prompt as an argument.
   * For multi-turn conversations, we spawn a new process for each message.
   *
   * @param message The message to send
   * @throws ProviderStateError if process is not running
   */
  async send(message: ProviderMessage): Promise<void> {
    // For Cursor, each message starts a new agent command
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
      '-p',
      message.content,
      '--output-format', 'json',
      ...(this.config.args ?? []),
    ];

    // Spawn new cursor process
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
   * Receive a response from Cursor
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
        reject(new ProviderStateError('Timeout waiting for Cursor response'));
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
            const parsed = this.parseCursorEvent(line);
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
 * Factory function for creating CursorProvider instances
 */
export function createCursorProvider(config?: Partial<ProviderConfig>): CursorProvider {
  return new CursorProvider(config);
}
