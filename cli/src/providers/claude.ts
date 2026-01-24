/**
 * Claude Code CLI Provider
 * Implements the AIProvider interface for Claude Code CLI
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
 * Claude Code CLI Provider
 *
 * Spawns and communicates with the Claude Code CLI tool.
 * Uses stdin/stdout for communication with the claude process.
 */
export class ClaudeProvider extends BaseProvider {
  readonly name: ProviderName = 'claude';
  readonly displayName = 'Claude Code';
  readonly command = 'claude';

  private outputBuffer: OutputBuffer = {
    data: '',
    resolve: null,
    reject: null,
  };

  private responseTimeout = 300000; // 5 minutes default timeout

  constructor(config?: Partial<ProviderConfig>) {
    super(config);
    // Override command if provided in config
    if (config?.command) {
      (this as { command: string }).command = config.command;
    }
  }

  /**
   * Check if the Claude CLI is installed and available
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
   * Get the Claude CLI version
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
   * Spawn the Claude CLI process with the given system prompt
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

    // Build command arguments
    const args = [
      '--print', // Print mode for non-interactive output
      '--output-format', 'stream-json', // Stream JSON for structured output
      '--verbose', // Enable verbose mode for more context
      ...(this.config.args ?? []),
    ];

    // Spawn the claude process
    this.process = spawn(this.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.config.env,
      },
    });

    // Set up event handlers
    this.setupEventHandlers();

    // Send the system prompt as the first message
    await this.sendRaw(systemPrompt);
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
      if (this.outputBuffer.reject && (code !== 0 || signal)) {
        this.outputBuffer.reject(
          new ProviderStateError(`Process exited with code ${code}, signal ${signal}`)
        );
        this.outputBuffer.resolve = null;
        this.outputBuffer.reject = null;
      }
    });
  }

  /**
   * Handle stdout data from the claude process
   */
  private handleStdout(data: string): void {
    this.outputBuffer.data += data;

    // Try to parse complete JSON messages
    // Claude outputs stream-json format with one JSON object per line
    const lines = this.outputBuffer.data.split('\n');

    // Keep the last incomplete line in the buffer
    this.outputBuffer.data = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = this.parseStreamJson(line);
        if (parsed && this.outputBuffer.resolve) {
          this.outputBuffer.resolve(parsed);
          this.outputBuffer.resolve = null;
          this.outputBuffer.reject = null;
        }
      } catch {
        // Line wasn't valid JSON, continue accumulating
      }
    }
  }

  /**
   * Handle stderr data from the claude process
   */
  private handleStderr(data: string): void {
    // Log stderr but don't treat it as an error unless it's critical
    if (data.includes('error') || data.includes('Error')) {
      console.error('[Claude stderr]:', data);
    }
  }

  /**
   * Parse a stream-json formatted line from Claude
   *
   * Claude's stream-json format includes various message types:
   * - {"type": "assistant", "message": {...}}
   * - {"type": "result", "result": "..."}
   * - {"type": "error", "error": {...}}
   */
  private parseStreamJson(line: string): ProviderResponse | null {
    const json = JSON.parse(line);

    // Handle different message types
    if (json.type === 'result') {
      return {
        content: typeof json.result === 'string' ? json.result : JSON.stringify(json.result),
        isComplete: true,
        structured: json.result,
      };
    }

    if (json.type === 'assistant') {
      const message = json.message;
      // Extract content from assistant message
      const content = this.extractAssistantContent(message);
      return {
        content,
        isComplete: false,
        structured: message,
      };
    }

    if (json.type === 'content_block_delta') {
      // Streaming delta
      const delta = json.delta;
      if (delta?.type === 'text_delta' && delta?.text) {
        return {
          content: delta.text,
          isComplete: false,
        };
      }
    }

    if (json.type === 'message_stop' || json.type === 'content_block_stop') {
      // End of message
      return {
        content: '',
        isComplete: true,
      };
    }

    if (json.type === 'error') {
      throw new ProviderStateError(`Claude error: ${JSON.stringify(json.error)}`);
    }

    // Unknown type, return raw content
    return null;
  }

  /**
   * Extract text content from an assistant message
   */
  private extractAssistantContent(message: unknown): string {
    if (!message || typeof message !== 'object') {
      return '';
    }

    const msg = message as Record<string, unknown>;

    // Handle content array (Claude's format)
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((block: unknown) => {
          const b = block as Record<string, unknown>;
          return b.type === 'text' && typeof b.text === 'string';
        })
        .map((block: unknown) => (block as Record<string, unknown>).text as string)
        .join('');
    }

    // Handle direct content string
    if (typeof msg.content === 'string') {
      return msg.content;
    }

    return '';
  }

  /**
   * Send a message to the Claude process
   *
   * @param message The message to send
   * @throws ProviderStateError if process is not running
   */
  async send(message: ProviderMessage): Promise<void> {
    if (!this.isRunning()) {
      throw new ProviderStateError('Provider is not running');
    }

    await this.sendRaw(message.content);
  }

  /**
   * Send raw text to the process stdin
   */
  private sendRaw(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new ProviderStateError('Process stdin is not available'));
        return;
      }

      this.process.stdin.write(text + '\n', 'utf-8', (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Receive a response from Claude
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
        reject(new ProviderStateError('Timeout waiting for Claude response'));
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
            const parsed = this.parseStreamJson(line);
            if (parsed) {
              clearTimeout(timeoutId);
              this.outputBuffer.data = '';
              this.outputBuffer.resolve = null;
              this.outputBuffer.reject = null;
              resolve(parsed);
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

    // Call parent cleanup
    await super.cleanup();
  }
}

/**
 * Factory function for creating ClaudeProvider instances
 */
export function createClaudeProvider(config?: Partial<ProviderConfig>): ClaudeProvider {
  return new ClaudeProvider(config);
}
