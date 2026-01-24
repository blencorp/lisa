/**
 * Base classes and interfaces for AI providers
 */

import { type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';

const exec = promisify(execCallback);

export type ProviderName = 'claude' | 'opencode' | 'cursor' | 'codex' | 'copilot';

export interface ProviderConfig {
  /** Command to run the CLI tool */
  command: string;
  /** Arguments to pass to the CLI */
  args?: string[];
  /** Environment variables to set */
  env?: Record<string, string>;
}

export interface ProviderMessage {
  /** The content of the message */
  content: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface ProviderResponse {
  /** The response content from the AI */
  content: string;
  /** Whether the response indicates completion */
  isComplete: boolean;
  /** Structured data if the AI output structured content */
  structured?: unknown;
}

/**
 * Interface that all AI providers must implement
 */
export interface AIProvider {
  /** Unique name of the provider */
  readonly name: ProviderName;

  /** Human-readable display name */
  readonly displayName: string;

  /** Command used to invoke the CLI */
  readonly command: string;

  /**
   * Check if the CLI tool is installed and available
   * @returns Promise resolving to true if available, false otherwise
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the version of the installed CLI tool
   * @returns Promise resolving to version string, or null if not available
   */
  getVersion(): Promise<string | null>;

  /**
   * Spawn the CLI process and prepare for interaction
   * @param systemPrompt Initial system prompt to send to the AI
   * @throws Error if CLI is not available or fails to start
   */
  spawn(systemPrompt: string): Promise<void>;

  /**
   * Send a message to the AI
   * @param message The message to send
   * @throws Error if provider is not spawned
   */
  send(message: ProviderMessage): Promise<void>;

  /**
   * Receive a response from the AI
   * @returns Promise resolving to the AI's response
   * @throws Error if provider is not spawned or communication fails
   */
  receive(): Promise<ProviderResponse>;

  /**
   * Check if the provider process is currently running
   */
  isRunning(): boolean;

  /**
   * Clean up resources and terminate the process
   */
  cleanup(): Promise<void>;
}

/**
 * Base class for AI providers with common functionality
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: ProviderName;
  abstract readonly displayName: string;
  abstract readonly command: string;

  protected process: ChildProcess | null = null;
  protected config: ProviderConfig;

  constructor(config?: Partial<ProviderConfig>) {
    // Note: this.command is set after abstract property initialization
    // We use an empty string here and override in subclasses if needed
    this.config = {
      command: config?.command ?? '',
      args: config?.args ?? [],
      env: config?.env ?? {},
    };
  }

  /**
   * Get the effective command to use (config override or default)
   */
  protected getCommand(): string {
    return this.config.command || this.command;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await exec(`which ${this.getCommand()}`);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await exec(`${this.getCommand()} --version`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async cleanup(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Give it a moment to clean up gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.process = null;
    }
  }

  abstract spawn(systemPrompt: string): Promise<void>;
  abstract send(message: ProviderMessage): Promise<void>;
  abstract receive(): Promise<ProviderResponse>;
}

/**
 * Error thrown when a provider is not found in the registry
 */
export class ProviderNotFoundError extends Error {
  constructor(name: string) {
    super(`Provider "${name}" is not registered`);
    this.name = 'ProviderNotFoundError';
  }
}

/**
 * Error thrown when a provider CLI tool is not available
 */
export class ProviderNotAvailableError extends Error {
  constructor(name: string, command: string) {
    super(`Provider "${name}" CLI tool "${command}" is not installed or not in PATH`);
    this.name = 'ProviderNotAvailableError';
  }
}

/**
 * Error thrown when provider is not in expected state
 */
export class ProviderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderStateError';
  }
}

/**
 * Factory function type for creating provider instances
 */
export type ProviderFactory = (config?: Partial<ProviderConfig>) => AIProvider;
