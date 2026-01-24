/**
 * GitHub Copilot CLI Provider
 * Implements the AIProvider interface for GitHub Copilot CLI
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
 * Copilot event types from JSON output
 *
 * GitHub Copilot CLI can output in various formats depending on the command.
 * The `gh copilot suggest` and `gh copilot explain` commands output structured JSON
 * when using the --json flag (if available) or plain text otherwise.
 */
interface CopilotEvent {
  type?: string;
  text?: string;
  content?: string;
  message?: string;
  result?: string;
  suggestion?: string;
  explanation?: string;
  error?: string;
  status?: string;
  // Additional fields for different event types
  [key: string]: unknown;
}

/**
 * GitHub Copilot CLI Provider
 *
 * Spawns and communicates with the GitHub Copilot CLI tool.
 * Uses the `gh copilot` command for interaction.
 *
 * GitHub Copilot CLI supports:
 * - `gh copilot suggest` - Get code suggestions
 * - `gh copilot explain` - Get code explanations
 * - Shell command suggestions with `-t shell`
 */
export class CopilotProvider extends BaseProvider {
  readonly name: ProviderName = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly command = 'gh';

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
   * Check if the GitHub Copilot CLI is installed and available
   * Requires both `gh` CLI and the copilot extension
   */
  async isAvailable(): Promise<boolean> {
    try {
      // First check if gh CLI is available
      await exec(`which ${this.command}`);
      // Then check if copilot extension is installed
      const { stdout } = await exec(`${this.command} copilot --help`);
      return stdout.includes('copilot');
    } catch {
      return false;
    }
  }

  /**
   * Get the GitHub Copilot CLI version
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await exec(`${this.command} copilot --version`);
      return stdout.trim();
    } catch {
      // If --version doesn't work, try to get gh version
      try {
        const { stdout } = await exec(`${this.command} --version`);
        return `gh ${stdout.trim().split('\n')[0]}`;
      } catch {
        return null;
      }
    }
  }

  /**
   * Spawn the Copilot CLI process with the given system prompt
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
    // gh copilot suggest "prompt" or gh copilot explain "prompt"
    // We use suggest for general prompts
    const args = [
      'copilot',
      'suggest',
      '-t', 'shell', // Target type (shell, git, or gh)
      systemPrompt,
      ...(this.config.args ?? []),
    ];

    // Spawn the gh copilot process
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
      // For Copilot, exit with code 0 is normal completion
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
   * Handle stdout data from the copilot process
   */
  private handleStdout(data: string): void {
    this.outputBuffer.data += data;

    // Copilot may output JSON Lines or plain text depending on configuration
    const lines = this.outputBuffer.data.split('\n');

    // Keep the last incomplete line in the buffer
    this.outputBuffer.data = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = this.parseCopilotEvent(line);
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
        // If it's a ProviderStateError (from parseCopilotEvent throwing on error type), reject
        if (error instanceof ProviderStateError && this.outputBuffer.reject) {
          this.outputBuffer.reject(error);
          this.outputBuffer.resolve = null;
          this.outputBuffer.reject = null;
        } else {
          // Line wasn't valid JSON, treat as plain text output
          // Accumulate it as content
          this.accumulatedContent += line + '\n';
        }
      }
    }
  }

  /**
   * Handle stderr data from the copilot process
   */
  private handleStderr(data: string): void {
    // Log stderr but don't treat it as an error unless it's critical
    if (data.includes('error') || data.includes('Error')) {
      console.error('[Copilot stderr]:', data);
    }
  }

  /**
   * Parse a JSON event from Copilot
   *
   * Copilot's output format can vary:
   * - Plain text suggestions
   * - JSON objects with suggestion/explanation fields
   * - Error messages
   */
  private parseCopilotEvent(line: string): ProviderResponse | null {
    const event: CopilotEvent = JSON.parse(line);

    // Handle error events
    if (event.type === 'error' || event.error) {
      throw new ProviderStateError(`Copilot error: ${event.error ?? event.message ?? JSON.stringify(event)}`);
    }

    // Handle result/complete message types
    if (event.type === 'result' || event.type === 'complete' || event.type === 'done') {
      const content = event.text ?? event.content ?? event.suggestion ?? event.explanation ?? event.message ?? '';
      return {
        content,
        isComplete: true,
        structured: event,
      };
    }

    // Handle suggestion field (primary Copilot output)
    if (event.suggestion) {
      return {
        content: event.suggestion,
        isComplete: true,
        structured: event,
      };
    }

    // Handle explanation field
    if (event.explanation) {
      return {
        content: event.explanation,
        isComplete: true,
        structured: event,
      };
    }

    // Handle streaming content types
    if (event.type === 'text' || event.type === 'content' || event.type === 'message') {
      const content = event.text ?? event.content ?? event.message ?? '';
      return {
        content,
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

    // Handle status field as informational
    if (event.status) {
      return {
        content: '',
        isComplete: false,
        structured: event,
      };
    }

    // Unknown type, return null
    return null;
  }

  /**
   * Send a message to the Copilot process
   *
   * Note: Copilot's CLI takes the prompt as an argument.
   * For multi-turn conversations, we spawn a new process for each message.
   *
   * @param message The message to send
   * @throws ProviderStateError if process is not running
   */
  async send(message: ProviderMessage): Promise<void> {
    // For Copilot, each message starts a new command
    // First cleanup the existing process if running
    if (this.isRunning()) {
      await this.cleanup();
    }

    if (!(await this.isAvailable())) {
      throw new ProviderNotAvailableError(this.name, this.command);
    }

    // Reset accumulated content
    this.accumulatedContent = '';

    // Determine if this is an explain or suggest request based on content
    const isExplain = message.content.toLowerCase().includes('explain') ||
                      message.content.toLowerCase().includes('what does') ||
                      message.content.toLowerCase().includes('how does');

    const subcommand = isExplain ? 'explain' : 'suggest';

    // Build command arguments for the new prompt
    const args = [
      'copilot',
      subcommand,
      ...(subcommand === 'suggest' ? ['-t', 'shell'] : []),
      message.content,
      ...(this.config.args ?? []),
    ];

    // Spawn new copilot process
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
   * Receive a response from Copilot
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
        reject(new ProviderStateError('Timeout waiting for Copilot response'));
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
            const parsed = this.parseCopilotEvent(line);
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
 * Factory function for creating CopilotProvider instances
 */
export function createCopilotProvider(config?: Partial<ProviderConfig>): CopilotProvider {
  return new CopilotProvider(config);
}
