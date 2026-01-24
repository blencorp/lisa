/**
 * Tests for AI provider abstraction layer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  type ProviderName,
  type ProviderConfig,
  type ProviderMessage,
  type ProviderResponse,
  BaseProvider,
  ProviderRegistry,
  ProviderNotFoundError,
  ProviderNotAvailableError,
  ProviderStateError,
  providerRegistry,
  validateProvider,
  getValidatedProvider,
} from './index.js';

/**
 * Mock provider for testing - simulates a CLI tool
 */
class MockProvider extends BaseProvider {
  readonly name: ProviderName = 'claude';
  readonly displayName = 'Mock Claude';
  readonly command = 'mock-cli';

  private _isAvailable = true;
  private _version: string | null = '1.0.0';
  private _spawned = false;
  private _messages: ProviderMessage[] = [];
  private _responses: ProviderResponse[] = [];

  setAvailable(available: boolean): void {
    this._isAvailable = available;
  }

  setVersion(version: string | null): void {
    this._version = version;
  }

  queueResponse(response: ProviderResponse): void {
    this._responses.push(response);
  }

  getMessages(): ProviderMessage[] {
    return [...this._messages];
  }

  override async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  override async getVersion(): Promise<string | null> {
    return this._version;
  }

  async spawn(systemPrompt: string): Promise<void> {
    if (!this._isAvailable) {
      throw new ProviderNotAvailableError(this.name, this.command);
    }
    this._spawned = true;
    this._messages.push({ content: systemPrompt, metadata: { type: 'system' } });
  }

  async send(message: ProviderMessage): Promise<void> {
    if (!this._spawned) {
      throw new ProviderStateError('Provider not spawned');
    }
    this._messages.push(message);
  }

  async receive(): Promise<ProviderResponse> {
    if (!this._spawned) {
      throw new ProviderStateError('Provider not spawned');
    }
    const response = this._responses.shift();
    if (!response) {
      return { content: 'Mock response', isComplete: false };
    }
    return response;
  }

  override isRunning(): boolean {
    return this._spawned;
  }

  override async cleanup(): Promise<void> {
    this._spawned = false;
    this._messages = [];
    this._responses = [];
  }
}

/**
 * Another mock provider for testing multiple providers
 */
class AnotherMockProvider extends BaseProvider {
  readonly name: ProviderName = 'opencode';
  readonly displayName = 'Mock OpenCode';
  readonly command = 'another-mock-cli';

  private _isAvailable = true;

  setAvailable(available: boolean): void {
    this._isAvailable = available;
  }

  override async isAvailable(): Promise<boolean> {
    return this._isAvailable;
  }

  async spawn(): Promise<void> {
    // No-op for tests
  }

  async send(): Promise<void> {
    // No-op for tests
  }

  async receive(): Promise<ProviderResponse> {
    return { content: 'Mock response', isComplete: false };
  }
}

describe('providers', () => {
  describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
      registry = new ProviderRegistry();
    });

    describe('register', () => {
      it('registers a provider factory', () => {
        const factory = () => new MockProvider();
        registry.register('claude', factory);
        expect(registry.has('claude')).toBe(true);
      });

      it('overwrites existing registration', () => {
        const factory1 = () => new MockProvider();
        const factory2 = () => {
          const p = new MockProvider();
          p.setVersion('2.0.0');
          return p;
        };

        registry.register('claude', factory1);
        registry.register('claude', factory2);

        const provider = registry.get('claude');
        expect(provider).toBeDefined();
      });
    });

    describe('unregister', () => {
      it('removes a registered provider', () => {
        registry.register('claude', () => new MockProvider());
        expect(registry.unregister('claude')).toBe(true);
        expect(registry.has('claude')).toBe(false);
      });

      it('returns false for non-existent provider', () => {
        expect(registry.unregister('claude')).toBe(false);
      });
    });

    describe('has', () => {
      it('returns true for registered provider', () => {
        registry.register('claude', () => new MockProvider());
        expect(registry.has('claude')).toBe(true);
      });

      it('returns false for unregistered provider', () => {
        expect(registry.has('claude')).toBe(false);
      });
    });

    describe('get', () => {
      it('returns provider instance', () => {
        registry.register('claude', () => new MockProvider());
        const provider = registry.get('claude');
        expect(provider.name).toBe('claude');
        expect(provider.displayName).toBe('Mock Claude');
      });

      it('throws ProviderNotFoundError for unregistered provider', () => {
        expect(() => registry.get('claude')).toThrow(ProviderNotFoundError);
        expect(() => registry.get('claude')).toThrow('Provider "claude" is not registered');
      });

      it('passes config to factory', () => {
        const factory = vi.fn((config?: Partial<ProviderConfig>) => new MockProvider(config));
        registry.register('claude', factory);

        const config = { args: ['--test'] };
        registry.get('claude', config);

        expect(factory).toHaveBeenCalledWith(config);
      });

      it('creates new instance each time', () => {
        registry.register('claude', () => new MockProvider());
        const provider1 = registry.get('claude');
        const provider2 = registry.get('claude');
        expect(provider1).not.toBe(provider2);
      });
    });

    describe('list', () => {
      it('returns empty array when no providers registered', () => {
        expect(registry.list()).toEqual([]);
      });

      it('returns all registered provider names', () => {
        registry.register('claude', () => new MockProvider());
        registry.register('opencode', () => new AnotherMockProvider());

        const names = registry.list();
        expect(names).toHaveLength(2);
        expect(names).toContain('claude');
        expect(names).toContain('opencode');
      });
    });

    describe('checkAvailability', () => {
      it('returns availability status for all providers', async () => {
        const mockProvider = new MockProvider();
        mockProvider.setAvailable(true);

        const anotherProvider = new AnotherMockProvider();
        anotherProvider.setAvailable(false);

        registry.register('claude', () => {
          const p = new MockProvider();
          p.setAvailable(true);
          return p;
        });
        registry.register('opencode', () => {
          const p = new AnotherMockProvider();
          p.setAvailable(false);
          return p;
        });

        const availability = await registry.checkAvailability();

        expect(availability.get('claude')).toBe(true);
        expect(availability.get('opencode')).toBe(false);
      });

      it('returns empty map when no providers registered', async () => {
        const availability = await registry.checkAvailability();
        expect(availability.size).toBe(0);
      });
    });

    describe('getFirstAvailable', () => {
      it('returns first available provider', async () => {
        registry.register('claude', () => {
          const p = new MockProvider();
          p.setAvailable(false);
          return p;
        });
        registry.register('opencode', () => {
          const p = new AnotherMockProvider();
          p.setAvailable(true);
          return p;
        });

        const provider = await registry.getFirstAvailable();
        expect(provider?.name).toBe('opencode');
      });

      it('respects preferred order', async () => {
        registry.register('claude', () => {
          const p = new MockProvider();
          p.setAvailable(true);
          return p;
        });
        registry.register('opencode', () => {
          const p = new AnotherMockProvider();
          p.setAvailable(true);
          return p;
        });

        const provider = await registry.getFirstAvailable(['opencode', 'claude']);
        expect(provider?.name).toBe('opencode');
      });

      it('returns null when no providers available', async () => {
        registry.register('claude', () => {
          const p = new MockProvider();
          p.setAvailable(false);
          return p;
        });

        const provider = await registry.getFirstAvailable();
        expect(provider).toBeNull();
      });

      it('returns null when no providers registered', async () => {
        const provider = await registry.getFirstAvailable();
        expect(provider).toBeNull();
      });

      it('skips non-registered providers in preferred order', async () => {
        registry.register('opencode', () => {
          const p = new AnotherMockProvider();
          p.setAvailable(true);
          return p;
        });

        const provider = await registry.getFirstAvailable(['claude', 'opencode']);
        expect(provider?.name).toBe('opencode');
      });
    });

    describe('clear', () => {
      it('removes all registered providers', () => {
        registry.register('claude', () => new MockProvider());
        registry.register('opencode', () => new AnotherMockProvider());

        registry.clear();

        expect(registry.list()).toEqual([]);
        expect(registry.has('claude')).toBe(false);
        expect(registry.has('opencode')).toBe(false);
      });
    });
  });

  describe('MockProvider (BaseProvider tests)', () => {
    let provider: MockProvider;

    beforeEach(() => {
      provider = new MockProvider();
    });

    afterEach(async () => {
      await provider.cleanup();
    });

    describe('isAvailable', () => {
      it('returns true when available', async () => {
        provider.setAvailable(true);
        expect(await provider.isAvailable()).toBe(true);
      });

      it('returns false when not available', async () => {
        provider.setAvailable(false);
        expect(await provider.isAvailable()).toBe(false);
      });
    });

    describe('getVersion', () => {
      it('returns version string when available', async () => {
        provider.setVersion('1.2.3');
        expect(await provider.getVersion()).toBe('1.2.3');
      });

      it('returns null when version unavailable', async () => {
        provider.setVersion(null);
        expect(await provider.getVersion()).toBeNull();
      });
    });

    describe('spawn', () => {
      it('initializes provider with system prompt', async () => {
        await provider.spawn('You are a helpful assistant');
        expect(provider.isRunning()).toBe(true);
        expect(provider.getMessages()).toHaveLength(1);
        expect(provider.getMessages()[0].content).toBe('You are a helpful assistant');
      });

      it('throws when not available', async () => {
        provider.setAvailable(false);
        await expect(provider.spawn('test')).rejects.toThrow(ProviderNotAvailableError);
      });
    });

    describe('send', () => {
      it('sends message to provider', async () => {
        await provider.spawn('system');
        await provider.send({ content: 'Hello' });

        const messages = provider.getMessages();
        expect(messages).toHaveLength(2);
        expect(messages[1].content).toBe('Hello');
      });

      it('throws when not spawned', async () => {
        await expect(provider.send({ content: 'Hello' })).rejects.toThrow(ProviderStateError);
      });
    });

    describe('receive', () => {
      it('returns queued response', async () => {
        await provider.spawn('system');
        provider.queueResponse({ content: 'Hello back', isComplete: false });

        const response = await provider.receive();
        expect(response.content).toBe('Hello back');
        expect(response.isComplete).toBe(false);
      });

      it('returns default response when no queue', async () => {
        await provider.spawn('system');
        const response = await provider.receive();
        expect(response.content).toBe('Mock response');
      });

      it('throws when not spawned', async () => {
        await expect(provider.receive()).rejects.toThrow(ProviderStateError);
      });
    });

    describe('isRunning', () => {
      it('returns false before spawn', () => {
        expect(provider.isRunning()).toBe(false);
      });

      it('returns true after spawn', async () => {
        await provider.spawn('system');
        expect(provider.isRunning()).toBe(true);
      });

      it('returns false after cleanup', async () => {
        await provider.spawn('system');
        await provider.cleanup();
        expect(provider.isRunning()).toBe(false);
      });
    });

    describe('cleanup', () => {
      it('resets provider state', async () => {
        await provider.spawn('system');
        await provider.send({ content: 'test' });
        provider.queueResponse({ content: 'response', isComplete: false });

        await provider.cleanup();

        expect(provider.isRunning()).toBe(false);
        expect(provider.getMessages()).toEqual([]);
      });

      it('can be called multiple times safely', async () => {
        await provider.spawn('system');
        await provider.cleanup();
        await provider.cleanup();
        expect(provider.isRunning()).toBe(false);
      });
    });
  });

  describe('Error classes', () => {
    describe('ProviderNotFoundError', () => {
      it('has correct name and message', () => {
        const error = new ProviderNotFoundError('test-provider');
        expect(error.name).toBe('ProviderNotFoundError');
        expect(error.message).toBe('Provider "test-provider" is not registered');
      });
    });

    describe('ProviderNotAvailableError', () => {
      it('has correct name and message', () => {
        const error = new ProviderNotAvailableError('claude', 'claude-cli');
        expect(error.name).toBe('ProviderNotAvailableError');
        expect(error.message).toBe(
          'Provider "claude" CLI tool "claude-cli" is not installed or not in PATH'
        );
      });
    });

    describe('ProviderStateError', () => {
      it('has correct name and message', () => {
        const error = new ProviderStateError('Provider not spawned');
        expect(error.name).toBe('ProviderStateError');
        expect(error.message).toBe('Provider not spawned');
      });
    });
  });

  describe('validateProvider', () => {
    it('does not throw when provider is available', async () => {
      const provider = new MockProvider();
      provider.setAvailable(true);
      await expect(validateProvider(provider)).resolves.toBeUndefined();
    });

    it('throws ProviderNotAvailableError when not available', async () => {
      const provider = new MockProvider();
      provider.setAvailable(false);
      await expect(validateProvider(provider)).rejects.toThrow(ProviderNotAvailableError);
    });
  });

  describe('getValidatedProvider', () => {
    beforeEach(() => {
      // Clear the global registry before each test
      providerRegistry.clear();
    });

    it('returns provider when available', async () => {
      providerRegistry.register('claude', () => {
        const p = new MockProvider();
        p.setAvailable(true);
        return p;
      });

      const provider = await getValidatedProvider('claude');
      expect(provider.name).toBe('claude');
    });

    it('throws ProviderNotFoundError for unregistered provider', async () => {
      await expect(getValidatedProvider('claude')).rejects.toThrow(ProviderNotFoundError);
    });

    it('throws ProviderNotAvailableError when CLI not available', async () => {
      providerRegistry.register('claude', () => {
        const p = new MockProvider();
        p.setAvailable(false);
        return p;
      });

      await expect(getValidatedProvider('claude')).rejects.toThrow(ProviderNotAvailableError);
    });

    it('passes config to provider factory', async () => {
      const factory = vi.fn(() => {
        const p = new MockProvider();
        p.setAvailable(true);
        return p;
      });
      providerRegistry.register('claude', factory);

      const config = { args: ['--verbose'] };
      await getValidatedProvider('claude', config);

      expect(factory).toHaveBeenCalledWith(config);
    });
  });

  describe('Global providerRegistry', () => {
    beforeEach(() => {
      providerRegistry.clear();
    });

    it('is a ProviderRegistry instance', () => {
      expect(providerRegistry).toBeInstanceOf(ProviderRegistry);
    });

    it('can register and retrieve providers', () => {
      providerRegistry.register('claude', () => new MockProvider());
      expect(providerRegistry.has('claude')).toBe(true);
      expect(providerRegistry.get('claude').name).toBe('claude');
    });
  });
});
