/**
 * OpenCode CLI Provider
 * Implements the AIProvider interface for OpenCode CLI
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
 * OpenCode event types from JSON output format
 */
interface OpenCodeEvent {
  type: string;
  timestamp?: string;
  sessionID?: string;
  text?: string;
  tool?: string;
  output?: string;
  error?: string;
  // Additional fields for different event types
  [key: string]: unknown;
}

/**
 * OpenCode CLI Provider
 *
 * Spawns and communicates with the OpenCode CLI tool.
 * Uses stdin/stdout for communication with the opencode process.
 *
 * OpenCode supports:
 * - Non-interactive mode via `opencode run "prompt"` or `opencode -p "prompt"`
 * - JSON output format with `-f json` or `--format json`
 * - Quiet mode (no spinner) with `-q` or `--quiet`
 */
export class OpenCodeProvider extends BaseProvider {
  readonly name: ProviderName = 'opencode';
  readonly displayName = 'OpenCode';
  readonly command = 'opencode';

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
   * Check if the OpenCode CLI is installed and available
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
   * Get the OpenCode CLI version
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
   * Spawn the OpenCode CLI process with the given system prompt
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
    // opencode run "prompt" --format json --quiet
    const args = [
      'run',
      systemPrompt,
      '--format', 'json', // JSON output for structured parsing
      '--quiet', // No spinner for automation
      ...(this.config.args ?? []),
    ];

    // Spawn the opencode process
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
      // For OpenCode, exit with code 0 is normal completion
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
   * Handle stdout data from the opencode process
   */
  private handleStdout(data: string): void {
    this.outputBuffer.data += data;

    // OpenCode outputs JSON events with one JSON object per line
    const lines = this.outputBuffer.data.split('\n');

    // Keep the last incomplete line in the buffer
    this.outputBuffer.data = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = this.parseOpenCodeEvent(line);
        if (parsed) {
          // Accumulate content for streaming
          if (parsed.content) {
            this.accumulatedContent += parsed.content;
          }

          // If complete, resolve immediately
          if (parsed.isComplete && this.outputBuffer.resolve) {
            this.outputBuffer.resolve({
              content: this.accumulatedContent || parsed.content,
              isComplete: true,
              structured: parsed.structured,
            });
            this.outputBuffer.resolve = null;
            this.outputBuffer.reject = null;
            this.accumulatedContent = '';
          }
        }
      } catch {
        // Line wasn't valid JSON, continue accumulating
      }
    }
  }

  /**
   * Handle stderr data from the opencode process
   */
  private handleStderr(data: string): void {
    // Log stderr but don't treat it as an error unless it's critical
    if (data.includes('error') || data.includes('Error')) {
      console.error('[OpenCode stderr]:', data);
    }
  }

  /**
   * Parse a JSON event from OpenCode
   *
   * OpenCode's JSON format includes various event types:
   * - message.part.updated - Text or tool output updates
   * - session.idle - Session completed
   * - session.error - Error occurred
   * - permission.asked - Permission request
   */
  private parseOpenCodeEvent(line: string): ProviderResponse | null {
    const event: OpenCodeEvent = JSON.parse(line);

    // Handle different event types
    if (event.type === 'message.part.updated') {
      // Text content update
      if (event.text) {
        return {
          content: event.text,
          isComplete: false,
          structured: event,
        };
      }
      // Tool output
      if (event.tool && event.output) {
        return {
          content: `[${event.tool}]: ${event.output}`,
          isComplete: false,
          structured: event,
        };
      }
    }

    if (event.type === 'session.idle') {
      // Session completed
      return {
        content: '',
        isComplete: true,
        structured: event,
      };
    }

    if (event.type === 'session.error') {
      throw new ProviderStateError(`OpenCode error: ${event.error ?? JSON.stringify(event)}`);
    }

    // Handle text content directly (some OpenCode versions output text directly)
    if (event.text) {
      return {
        content: event.text,
        isComplete: false,
        structured: event,
      };
    }

    // Handle output field (for final results)
    if (event.output) {
      return {
        content: event.output,
        isComplete: true,
        structured: event,
      };
    }

    // Unknown type, return null
    return null;
  }

  /**
   * Send a message to the OpenCode process
   *
   * Note: OpenCode's `run` command takes the prompt as an argument.
   * For multi-turn conversations, we spawn a new process for each message.
   *
   * @param message The message to send
   * @throws ProviderStateError if process is not running
   */
  async send(message: ProviderMessage): Promise<void> {
    // For OpenCode, each message starts a new run command
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
      'run',
      message.content,
      '--format', 'json',
      '--quiet',
      ...(this.config.args ?? []),
    ];

    // Spawn new opencode process
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
   * Receive a response from OpenCode
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
        reject(new ProviderStateError('Timeout waiting for OpenCode response'));
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
            const parsed = this.parseOpenCodeEvent(line);
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
 * Factory function for creating OpenCodeProvider instances
 */
export function createOpenCodeProvider(config?: Partial<ProviderConfig>): OpenCodeProvider {
  return new OpenCodeProvider(config);
}
