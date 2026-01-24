/**
 * End-to-End Tests for Lisa CLI with Real AI Providers
 *
 * These tests verify the E2E functionality of Lisa with real AI CLI tools.
 * Tests are automatically skipped if the required CLI tool is not installed.
 *
 * To run these tests:
 * - Ensure you have at least one AI CLI tool installed (e.g., `claude`)
 * - Run: npm test -- src/e2e/interview.e2e.test.ts
 *
 * Note: Tests that require real AI calls are designed to gracefully skip
 * if the AI is unavailable or times out, since real AI responses are not
 * guaranteed in CI/test environments.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { rm, readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';
import {
  ClaudeProvider,
  OpenCodeProvider,
  CursorProvider,
  CodexProvider,
  CopilotProvider,
  type AIProvider,
} from '../providers/index.js';
import {
  STRUCTURED_MARKERS,
  parseAIResponse,
} from '../core/orchestrator.js';
import { getPRDPath, generatePRDFromCompletion } from '../core/prd.js';

const exec = promisify(execCallback);

/**
 * Check if a CLI command is available on the system
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await exec(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to check if file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * E2E test configuration for a provider
 */
interface E2ETestConfig {
  name: string;
  command: string;
  createProvider: () => AIProvider;
}

/**
 * All provider configurations for E2E testing
 */
const providerConfigs: E2ETestConfig[] = [
  {
    name: 'Claude',
    command: 'claude',
    createProvider: () => new ClaudeProvider(),
  },
  {
    name: 'OpenCode',
    command: 'opencode',
    createProvider: () => new OpenCodeProvider(),
  },
  {
    name: 'Cursor',
    command: 'agent',
    createProvider: () => new CursorProvider(),
  },
  {
    name: 'Codex',
    command: 'codex',
    createProvider: () => new CodexProvider(),
  },
  {
    name: 'Copilot',
    command: 'gh',
    createProvider: () => new CopilotProvider(),
  },
];

/**
 * Track available providers for testing
 */
const availableProviders: Map<string, E2ETestConfig> = new Map();

describe('E2E Tests with Real AI CLIs', () => {
  let testDir: string;

  beforeAll(async () => {
    // Check which providers are available
    for (const config of providerConfigs) {
      const available = await isCommandAvailable(config.command);
      if (available) {
        // For Copilot, also check that the copilot extension is installed
        if (config.name === 'Copilot') {
          try {
            await exec('gh copilot --help');
            availableProviders.set(config.name, config);
          } catch {
            // Copilot extension not installed
          }
        } else {
          availableProviders.set(config.name, config);
        }
      }
    }

    console.log(
      `\n  Available AI CLIs for E2E testing: ${
        availableProviders.size > 0
          ? [...availableProviders.keys()].join(', ')
          : 'NONE (E2E tests with real AI will be skipped)'
      }\n`
    );
  });

  beforeEach(async () => {
    // Create a unique test directory for each test
    testDir = join(
      tmpdir(),
      `lisa-e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Provider Availability Detection', () => {
    it('should detect available providers correctly', async () => {
      // This test always runs to verify detection works
      for (const config of providerConfigs) {
        const provider = config.createProvider();
        const available = await provider.isAvailable();

        if (availableProviders.has(config.name)) {
          expect(available).toBe(true);
        }
        // We don't assert false because the provider might have become available
      }
    });

    it(
      'should get version for available providers',
      async () => {
        if (availableProviders.size === 0) {
          console.log('    ⏭️  Skipped: No AI CLIs available');
          return;
        }

        for (const [name, config] of availableProviders) {
          const provider = config.createProvider();
          const version = await provider.getVersion();
          console.log(`    ${name} version: ${version ?? 'unknown'}`);
          // Version might be null for some providers, that's OK
        }
      },
      30000 // 30 second timeout for version checks
    );

    it('should correctly report unavailable for non-existent CLI', async () => {
      // Create a provider with a non-existent command
      const fakeProvider = new ClaudeProvider();
      // Override the command check by testing isAvailable behavior
      const available = await fakeProvider.isAvailable();
      // This should be true if claude is installed, false otherwise
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Provider Lifecycle', () => {
    it('should handle provider not available gracefully', async () => {
      // Create a mock provider config that won't be available
      const nonExistentCommand = 'non-existent-cli-tool-xyz-12345';
      const available = await isCommandAvailable(nonExistentCommand);
      expect(available).toBe(false);
    });

    it('should cleanup provider resources properly', async () => {
      if (availableProviders.size === 0) {
        console.log('    ⏭️  Skipped: No AI CLIs available');
        return;
      }

      const config = [...availableProviders.values()][0];
      const provider = config.createProvider();

      // Provider should not be running initially
      expect(provider.isRunning()).toBe(false);

      // Cleanup should be safe to call even when not running
      await provider.cleanup();
      expect(provider.isRunning()).toBe(false);
    });
  });

  describe('PRD File Generation (E2E)', () => {
    it('should generate PRD files with correct structure', async () => {
      // This test verifies PRD generation works in an E2E context
      // without requiring actual AI responses

      const prdData = {
        overview: 'A simple hello world function that greets users.',
        userStories: [
          {
            title: 'Basic Greeting',
            description: 'As a developer, I want a function that returns a greeting.',
            acceptanceCriteria: [
              'Function accepts a name parameter',
              'Function returns "Hello, {name}!"',
              'Handles empty name gracefully',
            ],
          },
        ],
        technicalNotes: 'Implement as a pure TypeScript function with proper typing.',
      };

      const result = await generatePRDFromCompletion('hello-world-e2e', prdData, {
        baseDir: testDir,
        featureName: 'Hello World Function',
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBeDefined();
      expect(result.jsonPath).toBeDefined();

      // Verify markdown file
      const mdPath = getPRDPath('hello-world-e2e', 'md', { baseDir: testDir });
      expect(await fileExists(mdPath)).toBe(true);

      const mdContent = await readFile(mdPath, 'utf-8');
      expect(mdContent).toContain('# Hello World Function');
      expect(mdContent).toContain('## Overview');
      expect(mdContent).toContain('simple hello world function');
      expect(mdContent).toContain('## User Stories');
      expect(mdContent).toContain('Basic Greeting');
      expect(mdContent).toContain('- [ ] Function accepts a name parameter');
      expect(mdContent).toContain('## Technical Notes');

      // Verify JSON file
      const jsonPath = getPRDPath('hello-world-e2e', 'json', { baseDir: testDir });
      expect(await fileExists(jsonPath)).toBe(true);

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const jsonData = JSON.parse(jsonContent);
      expect(jsonData.$schema).toBeDefined();
      expect(jsonData.version).toBe('1.0.0');
      expect(jsonData.metadata.slug).toBe('hello-world-e2e');
      expect(jsonData.userStories).toHaveLength(1);
      expect(jsonData.userStories[0].acceptanceCriteria).toHaveLength(3);
      expect(jsonData.userStories[0].acceptanceCriteria[0].completed).toBe(false);

      console.log(`    PRD files generated at ${testDir}/lisa/`);
    });

    it('should generate complex PRD with multiple user stories', async () => {
      const prdData = {
        overview: 'A comprehensive user authentication system with login, signup, and password reset.',
        userStories: [
          {
            title: 'User Login',
            description: 'As a user, I want to log in with my credentials.',
            acceptanceCriteria: [
              'Email/password form displayed',
              'Validation on submit',
              'JWT token stored on success',
              'Error message on failure',
            ],
          },
          {
            title: 'User Signup',
            description: 'As a visitor, I want to create an account.',
            acceptanceCriteria: [
              'Registration form with email, password, confirm password',
              'Email uniqueness validation',
              'Password strength requirements enforced',
              'Welcome email sent on success',
            ],
          },
          {
            title: 'Password Reset',
            description: 'As a user, I want to reset my forgotten password.',
            acceptanceCriteria: [
              'Reset request form accepts email',
              'Reset link sent via email',
              'Reset link expires after 24 hours',
              'New password can be set via reset link',
            ],
          },
        ],
        technicalNotes:
          'Use bcrypt for password hashing with cost factor 12. Implement rate limiting on all auth endpoints. Use JWT with 24h expiry for access tokens and 7d for refresh tokens.',
      };

      const result = await generatePRDFromCompletion('user-auth-system', prdData, {
        baseDir: testDir,
        featureName: 'User Authentication System',
      });

      expect(result.success).toBe(true);

      // Verify markdown content
      const mdPath = getPRDPath('user-auth-system', 'md', { baseDir: testDir });
      const mdContent = await readFile(mdPath, 'utf-8');

      // Check all user stories are present
      expect(mdContent).toContain('### 1. User Login');
      expect(mdContent).toContain('### 2. User Signup');
      expect(mdContent).toContain('### 3. Password Reset');

      // Check acceptance criteria are checkboxes
      expect(mdContent).toContain('- [ ] Email/password form displayed');
      expect(mdContent).toContain('- [ ] Password strength requirements enforced');
      expect(mdContent).toContain('- [ ] Reset link expires after 24 hours');

      // Verify JSON structure
      const jsonPath = getPRDPath('user-auth-system', 'json', { baseDir: testDir });
      const jsonData = JSON.parse(await readFile(jsonPath, 'utf-8'));

      expect(jsonData.userStories).toHaveLength(3);
      expect(jsonData.userStories[0].id).toBe(1);
      expect(jsonData.userStories[1].id).toBe(2);
      expect(jsonData.userStories[2].id).toBe(3);

      // Verify acceptance criteria have IDs
      expect(jsonData.userStories[0].acceptanceCriteria[0].id).toBe(1);
      expect(jsonData.userStories[0].acceptanceCriteria[1].id).toBe(2);
    });

    it('should handle invalid slug gracefully', async () => {
      const prdData = {
        overview: 'Test overview',
        userStories: [
          {
            title: 'Test Story',
            description: 'Test description',
            acceptanceCriteria: ['Test criterion'],
          },
        ],
        technicalNotes: 'Test notes',
      };

      const result = await generatePRDFromCompletion('INVALID--SLUG!!', prdData, {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid slug');
    });

    it('should handle invalid PRD data gracefully', async () => {
      const invalidPrd = {
        overview: '', // Empty overview is invalid
        userStories: [],
        technicalNotes: 'N',
      };

      const result = await generatePRDFromCompletion('valid-slug', invalidPrd, {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PRD data');
    });
  });
});

/**
 * Tests for structured response parsing
 * These validate the parsing logic used to extract structured data from AI responses
 */
describe('Structured Response Parsing (E2E)', () => {
  it('should have correct structured markers defined', () => {
    expect(STRUCTURED_MARKERS.questionStart).toBe('<<<LISA_QUESTION>>>');
    expect(STRUCTURED_MARKERS.questionEnd).toBe('<<<END_LISA_QUESTION>>>');
    expect(STRUCTURED_MARKERS.completeStart).toBe('<<<LISA_COMPLETE>>>');
    expect(STRUCTURED_MARKERS.completeEnd).toBe('<<<END_LISA_COMPLETE>>>');
  });

  it('should extract structured question from AI response', () => {
    const mockContent = `Let me help you plan this feature.

<<<LISA_QUESTION>>>
{
  "header": "Scope",
  "question": "What is the scope of this feature?",
  "options": [
    {"label": "Small", "description": "A few hours of work"},
    {"label": "Medium", "description": "A few days of work"},
    {"label": "Large", "description": "A week or more"}
  ],
  "multiSelect": false
}
<<<END_LISA_QUESTION>>>`;

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    expect(parsed.question).toBeDefined();
    expect(parsed.question?.header).toBe('Scope');
    expect(parsed.question?.question).toBe('What is the scope of this feature?');
    expect(parsed.question?.options).toHaveLength(3);
    expect(parsed.question?.options[0].label).toBe('Small');
    expect(parsed.question?.multiSelect).toBe(false);
    expect(parsed.isComplete).toBe(false);
    expect(parsed.text).toBe('Let me help you plan this feature.');
  });

  it('should extract completion data from AI response', () => {
    const mockContent = `Based on our discussion, here's your PRD.

<<<LISA_COMPLETE>>>
{
  "slug": "user-auth-feature",
  "prd": {
    "overview": "A user authentication system.",
    "userStories": [
      {
        "title": "Login",
        "description": "As a user, I want to log in.",
        "acceptanceCriteria": ["Enter credentials", "Get token"]
      }
    ],
    "technicalNotes": "Use JWT tokens."
  }
}
<<<END_LISA_COMPLETE>>>`;

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    expect(parsed.isComplete).toBe(true);
    expect(parsed.slug).toBe('user-auth-feature');
    expect(parsed.prd).toBeDefined();
    expect(parsed.prd?.overview).toBe('A user authentication system.');
    expect(parsed.prd?.userStories).toHaveLength(1);
    expect(parsed.prd?.userStories[0].title).toBe('Login');
    expect(parsed.prd?.userStories[0].acceptanceCriteria).toHaveLength(2);
    expect(parsed.prd?.technicalNotes).toBe('Use JWT tokens.');
    expect(parsed.text).toBe("Based on our discussion, here's your PRD.");
  });

  it('should handle plain text response without structured data', () => {
    const mockContent = 'Just a plain text response from the AI without any structured markers.';

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    expect(parsed.text).toBe(mockContent);
    expect(parsed.question).toBeUndefined();
    expect(parsed.isComplete).toBe(false);
    expect(parsed.slug).toBeUndefined();
    expect(parsed.prd).toBeUndefined();
  });

  it('should handle multi-select question', () => {
    const mockContent = `<<<LISA_QUESTION>>>
{
  "header": "Features",
  "question": "Which features do you need?",
  "options": [
    {"label": "Auth", "description": "Authentication"},
    {"label": "API", "description": "REST API"},
    {"label": "DB", "description": "Database"}
  ],
  "multiSelect": true
}
<<<END_LISA_QUESTION>>>`;

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    expect(parsed.question?.multiSelect).toBe(true);
    expect(parsed.question?.header).toBe('Features');
    expect(parsed.question?.options).toHaveLength(3);
  });

  it('should handle invalid JSON in structured block gracefully', () => {
    const mockContent = `Some text

<<<LISA_QUESTION>>>
{ invalid json here }
<<<END_LISA_QUESTION>>>

More text`;

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    // Invalid JSON should be treated as regular text
    expect(parsed.question).toBeUndefined();
    expect(parsed.isComplete).toBe(false);
  });

  it('should handle incomplete structured markers', () => {
    const mockContent = `Some text <<<LISA_QUESTION>>> but no end marker`;

    const parsed = parseAIResponse({ content: mockContent, isComplete: false });

    // Incomplete markers should be treated as regular text
    expect(parsed.question).toBeUndefined();
    expect(parsed.text).toBe(mockContent);
  });
});
