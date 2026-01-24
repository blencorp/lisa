/**
 * AI Provider abstraction layer
 * Provides interface and registry for AI CLI tool integrations
 */

// Import types needed for this module
import {
  type ProviderName,
  type ProviderConfig,
  type AIProvider,
  type ProviderFactory,
  ProviderNotFoundError,
  ProviderNotAvailableError,
} from './base.js';

// Re-export all base types, interfaces, classes, and errors
export {
  type ProviderName,
  type ProviderConfig,
  type ProviderMessage,
  type ProviderResponse,
  type AIProvider,
  type ProviderFactory,
  BaseProvider,
  ProviderNotFoundError,
  ProviderNotAvailableError,
  ProviderStateError,
} from './base.js';

/**
 * Provider Registry - manages registration and retrieval of AI providers
 */
export class ProviderRegistry {
  private providers: Map<ProviderName, ProviderFactory> = new Map();

  /**
   * Register a new provider factory
   * @param name The unique name for the provider
   * @param factory Factory function that creates provider instances
   */
  register(name: ProviderName, factory: ProviderFactory): void {
    this.providers.set(name, factory);
  }

  /**
   * Unregister a provider
   * @param name The name of the provider to remove
   * @returns true if provider was removed, false if it wasn't registered
   */
  unregister(name: ProviderName): boolean {
    return this.providers.delete(name);
  }

  /**
   * Check if a provider is registered
   * @param name The provider name to check
   */
  has(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  /**
   * Get a provider instance by name
   * @param name The provider name
   * @param config Optional configuration to pass to the factory
   * @throws ProviderNotFoundError if provider is not registered
   */
  get(name: ProviderName, config?: Partial<ProviderConfig>): AIProvider {
    const factory = this.providers.get(name);
    if (!factory) {
      throw new ProviderNotFoundError(name);
    }
    return factory(config);
  }

  /**
   * Get list of all registered provider names
   */
  list(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check which registered providers are available (have CLI tools installed)
   * @returns Map of provider names to their availability status
   */
  async checkAvailability(): Promise<Map<ProviderName, boolean>> {
    const results = new Map<ProviderName, boolean>();

    for (const name of this.providers.keys()) {
      const provider = this.get(name);
      results.set(name, await provider.isAvailable());
    }

    return results;
  }

  /**
   * Get the first available provider
   * @param preferredOrder Optional array of provider names to try in order
   * @returns The first available provider, or null if none available
   */
  async getFirstAvailable(preferredOrder?: ProviderName[]): Promise<AIProvider | null> {
    const order = preferredOrder ?? this.list();

    for (const name of order) {
      if (!this.has(name)) continue;

      const provider = this.get(name);
      if (await provider.isAvailable()) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.providers.clear();
  }
}

/**
 * Global provider registry instance
 */
export const providerRegistry = new ProviderRegistry();

/**
 * Validate that a provider CLI is available
 * @param provider The provider to validate
 * @throws ProviderNotAvailableError if CLI is not available
 */
export async function validateProvider(provider: AIProvider): Promise<void> {
  if (!(await provider.isAvailable())) {
    throw new ProviderNotAvailableError(provider.name, provider.command);
  }
}

/**
 * Get a validated provider ready for use
 * @param name The provider name
 * @param config Optional configuration
 * @throws ProviderNotFoundError if provider is not registered
 * @throws ProviderNotAvailableError if CLI is not available
 */
export async function getValidatedProvider(
  name: ProviderName,
  config?: Partial<ProviderConfig>
): Promise<AIProvider> {
  const provider = providerRegistry.get(name, config);
  await validateProvider(provider);
  return provider;
}

// Re-export provider implementations
export { ClaudeProvider, createClaudeProvider } from './claude.js';
export { OpenCodeProvider, createOpenCodeProvider } from './opencode.js';
export { CursorProvider, createCursorProvider } from './cursor.js';
export { CodexProvider, createCodexProvider } from './codex.js';
export { CopilotProvider, createCopilotProvider } from './copilot.js';

// Register built-in providers synchronously after they're imported
// This is done in a separate module to avoid circular dependency issues
import { createClaudeProvider } from './claude.js';
import { createOpenCodeProvider } from './opencode.js';
import { createCursorProvider } from './cursor.js';
import { createCodexProvider } from './codex.js';
import { createCopilotProvider } from './copilot.js';

providerRegistry.register('claude', createClaudeProvider);
providerRegistry.register('opencode', createOpenCodeProvider);
providerRegistry.register('cursor', createCursorProvider);
providerRegistry.register('codex', createCodexProvider);
providerRegistry.register('copilot', createCopilotProvider);
