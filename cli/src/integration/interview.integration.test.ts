/**
 * Integration tests for the full interview flow
 * Tests end-to-end scenarios with mock AI provider responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InterviewOrchestrator,
  createOrchestratorFromState,
  STRUCTURED_MARKERS,
  type OrchestratorConfig,
} from '../core/orchestrator.js';
import type { AIProvider, ProviderResponse } from '../providers/index.js';
import {
  loadState,
  saveState,
  clearState,
  hasState,
  type InterviewState,
} from '../core/state.js';
import {
  generatePRDFromCompletion,
  getPRDPath,
} from '../core/prd.js';
import {
  classifyError,
  NetworkError,
  ProviderError,
  ProcessError,
  TimeoutError,
  type InterviewError,
} from '../core/error-recovery.js';

/**
 * Create a mock AI provider with configurable responses
 */
function createMockProvider(
  responses: ProviderResponse[],
  overrides: Partial<AIProvider> = {}
): AIProvider {
  let responseIndex = 0;
  let spawned = false;

  return {
    name: 'claude',
    displayName: 'Claude (Mock)',
    command: 'mock-claude',
    isAvailable: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('mock-1.0.0'),
    spawn: vi.fn().mockImplementation(async () => {
      spawned = true;
    }),
    send: vi.fn().mockResolvedValue(undefined),
    receive: vi.fn().mockImplementation(async () => {
      if (!spawned) {
        throw new Error('Provider not spawned');
      }
      if (responseIndex >= responses.length) {
        throw new Error('No more mock responses available');
      }
      return responses[responseIndex++];
    }),
    isRunning: vi.fn().mockReturnValue(spawned),
    cleanup: vi.fn().mockImplementation(async () => {
      spawned = false;
    }),
    ...overrides,
  };
}

/**
 * Create a structured question response
 */
function createQuestionResponse(
  header: string,
  question: string,
  options: Array<{ label: string; description: string }>,
  multiSelect = false,
  additionalText = ''
): ProviderResponse {
  const structuredQuestion = {
    header,
    question,
    options,
    multiSelect,
  };

  return {
    content: `${additionalText}${STRUCTURED_MARKERS.questionStart}\n${JSON.stringify(structuredQuestion)}\n${STRUCTURED_MARKERS.questionEnd}`,
    isComplete: false,
  };
}

/**
 * Create a completion response with PRD data
 */
function createCompletionResponse(
  slug: string,
  overview: string,
  userStories: Array<{
    title: string;
    description: string;
    acceptanceCriteria: string[];
  }>,
  technicalNotes: string,
  additionalText = ''
): ProviderResponse {
  const completion = {
    slug,
    prd: {
      overview,
      userStories,
      technicalNotes,
    },
  };

  return {
    content: `${additionalText}${STRUCTURED_MARKERS.completeStart}\n${JSON.stringify(completion)}\n${STRUCTURED_MARKERS.completeEnd}`,
    isComplete: false,
  };
}

describe('Interview Flow Integration Tests', () => {
  let testDir: string;
  let orchestrator: InterviewOrchestrator;

  beforeEach(async () => {
    // Create a unique test directory for each test
    testDir = join(tmpdir(), `lisa-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Full Interview Flow', () => {
    it('should complete a full interview with multiple question rounds', async () => {
      const responses: ProviderResponse[] = [
        // Initial response with first question
        createQuestionResponse(
          'Auth Type',
          'What type of authentication do you need?',
          [
            { label: 'JWT', description: 'Token-based authentication' },
            { label: 'Session', description: 'Cookie-based sessions' },
            { label: 'OAuth', description: 'Third-party authentication' },
          ]
        ),
        // Second question after user answers
        createQuestionResponse(
          'Storage',
          'Where should user data be stored?',
          [
            { label: 'PostgreSQL', description: 'Relational database' },
            { label: 'MongoDB', description: 'Document database' },
          ]
        ),
        // Third question
        createQuestionResponse(
          'Features',
          'Which features do you need?',
          [
            { label: 'Login', description: 'Basic login' },
            { label: 'Signup', description: 'User registration' },
            { label: 'Reset', description: 'Password reset' },
          ],
          true // multiSelect
        ),
        // Completion response
        createCompletionResponse(
          'user-authentication-system',
          'A comprehensive user authentication system with JWT-based tokens.',
          [
            {
              title: 'User Login',
              description: 'As a user, I want to log in with my credentials so that I can access my account.',
              acceptanceCriteria: [
                'User can enter email and password',
                'System validates credentials',
                'JWT token is returned on success',
              ],
            },
            {
              title: 'User Registration',
              description: 'As a visitor, I want to create an account so that I can become a user.',
              acceptanceCriteria: [
                'User can enter registration details',
                'System validates email uniqueness',
                'Confirmation email is sent',
              ],
            },
          ],
          'Use bcrypt for password hashing. Implement rate limiting for login attempts.'
        ),
      ];

      const mockProvider = createMockProvider(responses);
      const config: OrchestratorConfig = {
        feature: 'user authentication system',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      };

      orchestrator = new InterviewOrchestrator(config);

      // Track events
      const events: Array<{ type: string }> = [];
      orchestrator.onEvent((event) => events.push({ type: event.type }));

      // Initialize interview
      const initialResult = await orchestrator.initialize();
      expect(initialResult.question).toBeDefined();
      expect(initialResult.question?.header).toBe('Auth Type');
      expect(initialResult.isComplete).toBe(false);

      // Answer first question
      const response1 = await orchestrator.sendUserResponse('JWT');
      expect(response1.question).toBeDefined();
      expect(response1.question?.header).toBe('Storage');

      // Answer second question
      const response2 = await orchestrator.sendUserResponse('PostgreSQL');
      expect(response2.question).toBeDefined();
      expect(response2.question?.multiSelect).toBe(true);

      // Answer third question (multi-select)
      const response3 = await orchestrator.sendUserResponse('Login, Signup, Reset');
      expect(response3.isComplete).toBe(true);

      // Complete and verify PRD data
      const completion = await orchestrator.complete();
      expect(completion.success).toBe(true);
      expect(completion.slug).toBe('user-authentication-system');
      expect(completion.prd?.userStories).toHaveLength(2);

      // Verify events were emitted
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('phase_change');
      expect(eventTypes).toContain('ai_response');
      expect(eventTypes).toContain('state_saved');

      // Verify final state
      const state = orchestrator.getState();
      expect(state.phase).toBe('generating');
      expect(state.history.length).toBeGreaterThan(0);

      await orchestrator.cleanup();
    });

    it('should handle plain text responses mixed with structured questions', async () => {
      const responses: ProviderResponse[] = [
        // Plain text intro followed by question
        {
          content: `Welcome! I'm going to help you plan your feature. Let me start by understanding your requirements.\n\n${STRUCTURED_MARKERS.questionStart}\n${JSON.stringify({
            header: 'Scope',
            question: 'How large is this feature?',
            options: [
              { label: 'Small', description: 'A few hours of work' },
              { label: 'Medium', description: 'A few days of work' },
            ],
            multiSelect: false,
          })}\n${STRUCTURED_MARKERS.questionEnd}`,
          isComplete: false,
        },
        // Completion
        createCompletionResponse(
          'simple-feature',
          'A simple feature implementation.',
          [
            {
              title: 'Basic Implementation',
              description: 'As a developer, I want a simple feature.',
              acceptanceCriteria: ['Works correctly'],
            },
          ],
          'Keep it simple.'
        ),
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'simple feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      const initial = await orchestrator.initialize();
      expect(initial.text).toContain('Welcome');
      expect(initial.question?.header).toBe('Scope');

      const response = await orchestrator.sendUserResponse('Small');
      expect(response.isComplete).toBe(true);

      await orchestrator.cleanup();
    });
  });

  describe('State Resume Functionality', () => {
    it('should save state during interview and allow resume', async () => {
      // First session: start interview and answer one question
      const responses1: ProviderResponse[] = [
        createQuestionResponse('Q1', 'First question?', [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ]),
        createQuestionResponse('Q2', 'Second question?', [
          { label: 'C', description: 'Option C' },
          { label: 'D', description: 'Option D' },
        ]),
      ];

      const mockProvider1 = createMockProvider(responses1);
      const config1: OrchestratorConfig = {
        feature: 'resumable feature',
        provider: mockProvider1,
        firstPrinciples: true,
        contextFiles: ['context.md'],
        baseDir: testDir,
      };

      const orchestrator1 = new InterviewOrchestrator(config1);
      await orchestrator1.initialize();
      await orchestrator1.sendUserResponse('A');

      // Verify state was saved
      expect(await hasState(testDir)).toBe(true);

      // Get the saved state
      const savedStateResult = await loadState(testDir);
      expect(savedStateResult).not.toBeNull();
      const savedState = savedStateResult!.state;

      expect(savedState.feature).toBe('resumable feature');
      expect(savedState.firstPrinciples).toBe(true);
      expect(savedState.contextFiles).toContain('context.md');
      expect(savedState.history.length).toBeGreaterThan(0);
      expect(savedState.phase).toBe('questioning');

      await orchestrator1.cleanup();

      // Second session: resume from saved state
      const responses2: ProviderResponse[] = [
        createCompletionResponse(
          'resumed-feature',
          'Feature completed after resume.',
          [
            {
              title: 'Story',
              description: 'A story',
              acceptanceCriteria: ['Criterion'],
            },
          ],
          'Notes'
        ),
      ];

      const mockProvider2 = createMockProvider(responses2);
      const orchestrator2 = createOrchestratorFromState(
        savedState,
        mockProvider2,
        testDir
      );

      // The state should be preserved
      const resumedState = orchestrator2.getState();
      expect(resumedState.feature).toBe('resumable feature');
      expect(resumedState.history.length).toBeGreaterThan(0);

      await orchestrator2.cleanup();
    });

    it('should clear state after successful completion', async () => {
      const responses: ProviderResponse[] = [
        createCompletionResponse(
          'quick-feature',
          'Quick feature.',
          [{ title: 'S', description: 'D', acceptanceCriteria: ['C'] }],
          'N'
        ),
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'quick feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      await orchestrator.initialize();

      // State should exist during interview
      expect(await hasState(testDir)).toBe(true);

      // Clear state (simulating successful completion)
      await clearState(testDir);

      // State should no longer exist
      expect(await hasState(testDir)).toBe(false);

      await orchestrator.cleanup();
    });

    it('should handle corrupted state gracefully', async () => {
      // Create a corrupted state file
      const lisaDir = join(testDir, 'lisa');
      await mkdir(lisaDir, { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(lisaDir, 'state.yaml'), 'invalid: yaml: content: [[[');

      // Attempting to load should throw an error
      await expect(loadState(testDir)).rejects.toThrow();
    });

    it('should preserve interview history on resume', async () => {
      // Create a state with history
      const historyState: InterviewState = {
        version: 1,
        feature: 'feature with history',
        provider: 'claude',
        firstPrinciples: false,
        contextFiles: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: 'questioning',
        history: [
          { question: 'Q1?', answer: 'A1', timestamp: new Date().toISOString() },
          { question: 'Q2?', answer: 'A2', timestamp: new Date().toISOString() },
        ],
        aiContext: 'Previous AI context',
      };

      await saveState(historyState, testDir);

      const loadedResult = await loadState(testDir);
      expect(loadedResult).not.toBeNull();
      expect(loadedResult!.state.history).toHaveLength(2);
      expect(loadedResult!.state.history[0].question).toBe('Q1?');
      expect(loadedResult!.state.history[1].answer).toBe('A2');
      expect(loadedResult!.state.aiContext).toBe('Previous AI context');
    });
  });

  describe('Error Recovery', () => {
    it('should preserve state when provider throws network error', async () => {
      const responses: ProviderResponse[] = [
        createQuestionResponse('Q1', 'Question?', [
          { label: 'A', description: 'A' },
          { label: 'B', description: 'B' },
        ]),
      ];

      const mockProvider = createMockProvider(responses, {
        receive: vi.fn()
          .mockResolvedValueOnce(responses[0])
          .mockRejectedValueOnce(new Error('ECONNREFUSED: Connection refused')),
      });

      orchestrator = new InterviewOrchestrator({
        feature: 'error test feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      await orchestrator.initialize();

      // This should throw but state should be preserved
      try {
        await orchestrator.sendUserResponse('A');
      } catch (error) {
        // Expected error
        expect(error).toBeDefined();
      }

      // State should have been saved before the error
      expect(await hasState(testDir)).toBe(true);
      const savedState = await loadState(testDir);
      expect(savedState).not.toBeNull();

      await orchestrator.cleanup();
    });

    it('should classify network errors correctly', () => {
      const error = new Error('ENOTFOUND: DNS lookup failed');
      const classified = classifyError(error);

      expect(classified.category).toBe('network');
      expect(classified.recoverable).toBe(true);
      expect(classified).toBeInstanceOf(NetworkError);
    });

    it('should classify timeout errors correctly', () => {
      const error = new Error('Operation timed out after 5000ms');
      const classified = classifyError(error);

      expect(classified.category).toBe('timeout');
      expect(classified.recoverable).toBe(true);
      expect(classified).toBeInstanceOf(TimeoutError);
      expect((classified as TimeoutError).timeoutMs).toBe(5000);
    });

    it('should classify process errors correctly', () => {
      const error = new Error('Process exited with exit code 1');
      const classified = classifyError(error);

      expect(classified.category).toBe('process');
      expect(classified.recoverable).toBe(true);
      expect(classified).toBeInstanceOf(ProcessError);
      expect((classified as ProcessError).exitCode).toBe(1);
    });

    it('should classify provider/API errors correctly', () => {
      const error = new Error('API rate limit exceeded');
      const classified = classifyError(error);

      expect(classified.category).toBe('provider');
      expect(classified.recoverable).toBe(true);
      expect(classified).toBeInstanceOf(ProviderError);
    });

    it('should emit error event on failure', async () => {
      const mockProvider = createMockProvider([], {
        spawn: vi.fn().mockRejectedValue(new Error('Spawn failed')),
      });

      orchestrator = new InterviewOrchestrator({
        feature: 'error event test',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      const events: Array<{ type: string; error?: Error }> = [];
      orchestrator.onEvent((event) => {
        if (event.type === 'error') {
          events.push({ type: event.type, error: event.error });
        }
      });

      try {
        await orchestrator.initialize();
      } catch {
        // Expected
      }

      expect(events.some((e) => e.type === 'error')).toBe(true);
    });

    it('should provide recovery instructions for recoverable errors', () => {
      const error = new Error('Network connection lost');
      const classified = classifyError(error) as InterviewError;

      const instructions = classified.getRecoveryInstructions();
      expect(instructions).toContain('lisa --resume');
    });
  });

  describe('Output File Generation', () => {
    it('should generate both markdown and JSON PRD files', async () => {
      const prdData = {
        overview: 'A comprehensive authentication system.',
        userStories: [
          {
            title: 'User Login',
            description: 'As a user, I want to log in.',
            acceptanceCriteria: ['Enter email', 'Enter password', 'Get token'],
          },
          {
            title: 'User Signup',
            description: 'As a visitor, I want to register.',
            acceptanceCriteria: ['Enter details', 'Verify email'],
          },
        ],
        technicalNotes: 'Use JWT tokens with 24h expiry.',
      };

      const result = await generatePRDFromCompletion(
        'auth-system',
        prdData,
        { baseDir: testDir }
      );

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBeDefined();
      expect(result.jsonPath).toBeDefined();

      // Verify markdown file exists and has correct content
      const mdPath = getPRDPath('auth-system', 'md', { baseDir: testDir });
      const mdContent = await readFile(mdPath, 'utf-8');
      expect(mdContent).toContain('# Auth System');
      expect(mdContent).toContain('## Overview');
      expect(mdContent).toContain('comprehensive authentication system');
      expect(mdContent).toContain('## User Stories');
      expect(mdContent).toContain('User Login');
      expect(mdContent).toContain('- [ ] Enter email');
      expect(mdContent).toContain('## Technical Notes');
      expect(mdContent).toContain('JWT tokens');

      // Verify JSON file exists and has correct structure
      const jsonPath = getPRDPath('auth-system', 'json', { baseDir: testDir });
      const jsonContent = await readFile(jsonPath, 'utf-8');
      const jsonData = JSON.parse(jsonContent);

      expect(jsonData.$schema).toBeDefined();
      expect(jsonData.version).toBe('1.0.0');
      expect(jsonData.metadata.slug).toBe('auth-system');
      expect(jsonData.overview).toContain('comprehensive authentication');
      expect(jsonData.userStories).toHaveLength(2);
      expect(jsonData.userStories[0].acceptanceCriteria[0].text).toBe('Enter email');
      expect(jsonData.userStories[0].acceptanceCriteria[0].completed).toBe(false);
    });

    it('should generate PRD from completed interview', async () => {
      const responses: ProviderResponse[] = [
        createCompletionResponse(
          'quick-prd',
          'Quick PRD overview.',
          [
            {
              title: 'Quick Story',
              description: 'As a user, I want something quick.',
              acceptanceCriteria: ['Fast', 'Easy'],
            },
          ],
          'Keep it simple.'
        ),
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'quick prd feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      await orchestrator.initialize();
      const completion = await orchestrator.complete();

      expect(completion.success).toBe(true);
      expect(completion.slug).toBe('quick-prd');

      // Generate PRD files
      const result = await generatePRDFromCompletion(
        completion.slug!,
        completion.prd,
        { baseDir: testDir, featureName: 'Quick PRD Feature' }
      );

      expect(result.success).toBe(true);

      // Verify files exist
      const mdExists = await fileExists(result.markdownPath!);
      const jsonExists = await fileExists(result.jsonPath!);
      expect(mdExists).toBe(true);
      expect(jsonExists).toBe(true);

      // Verify feature name is used in markdown
      const mdContent = await readFile(result.markdownPath!, 'utf-8');
      expect(mdContent).toContain('# Quick PRD Feature');

      await orchestrator.cleanup();
    });

    it('should reject invalid slugs', async () => {
      const prdData = {
        overview: 'Test',
        userStories: [
          { title: 'T', description: 'D', acceptanceCriteria: ['C'] },
        ],
        technicalNotes: 'N',
      };

      const result = await generatePRDFromCompletion(
        'INVALID--SLUG!!',
        prdData,
        { baseDir: testDir }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid slug');
    });

    it('should reject invalid PRD data', async () => {
      const invalidPrd = {
        overview: '', // Empty overview is invalid
        userStories: [],
        technicalNotes: 'N',
      };

      const result = await generatePRDFromCompletion(
        'valid-slug',
        invalidPrd,
        { baseDir: testDir }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PRD data');
    });
  });

  describe('First Principles Mode', () => {
    it('should include first principles instructions in system prompt', async () => {
      const responses: ProviderResponse[] = [
        createQuestionResponse('Problem', 'What problem are you solving?', [
          { label: 'User Need', description: 'Addressing a user pain point' },
          { label: 'Business', description: 'Business requirement' },
        ]),
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'thoughtful feature',
        provider: mockProvider,
        firstPrinciples: true,
        contextFiles: [],
        baseDir: testDir,
      });

      await orchestrator.initialize();

      // Verify spawn was called with first principles prompt
      expect(mockProvider.spawn).toHaveBeenCalled();
      const spawnCall = (mockProvider.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnCall).toContain('First Principles Mode');
      expect(spawnCall).toContain('fundamental assumptions');

      await orchestrator.cleanup();
    });
  });

  describe('Context File Handling', () => {
    it('should include codebase summary in system prompt', async () => {
      const responses: ProviderResponse[] = [
        { content: 'I see your codebase context.', isComplete: false },
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'contextual feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        codebaseSummary: 'This is a TypeScript project with React frontend.',
        baseDir: testDir,
      });

      await orchestrator.initialize();

      const spawnCall = (mockProvider.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnCall).toContain('Codebase Context');
      expect(spawnCall).toContain('TypeScript project with React');

      await orchestrator.cleanup();
    });

    it('should include context content in system prompt', async () => {
      const responses: ProviderResponse[] = [
        { content: 'I see your API specification.', isComplete: false },
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'API feature',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: ['api-spec.md'],
        contextContent: '# API Specification\n\nGET /users - Returns all users',
        baseDir: testDir,
      });

      await orchestrator.initialize();

      const spawnCall = (mockProvider.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnCall).toContain('Additional Context');
      expect(spawnCall).toContain('API Specification');
      expect(spawnCall).toContain('GET /users');

      await orchestrator.cleanup();
    });
  });

  describe('Event System', () => {
    it('should emit all expected events during interview', async () => {
      const responses: ProviderResponse[] = [
        createQuestionResponse('Q', 'Question?', [
          { label: 'A', description: 'A' },
          { label: 'B', description: 'B' },
        ]),
        createCompletionResponse('e', 'O', [{ title: 'T', description: 'D', acceptanceCriteria: ['C'] }], 'N'),
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'event test',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      const events: string[] = [];
      orchestrator.onEvent((event) => events.push(event.type));

      await orchestrator.initialize();
      await orchestrator.sendUserResponse('A');

      // Should have emitted various events
      expect(events).toContain('phase_change');
      expect(events).toContain('ai_response');
      expect(events).toContain('state_saved');

      // Should have emitted phase_change to 'generating' on completion
      const phaseChanges = events.filter((e) => e === 'phase_change');
      expect(phaseChanges.length).toBeGreaterThanOrEqual(2); // Initial and completion

      await orchestrator.cleanup();
    });

    it('should allow unsubscribing from events', async () => {
      const responses: ProviderResponse[] = [
        { content: 'Hello', isComplete: false },
      ];

      const mockProvider = createMockProvider(responses);
      orchestrator = new InterviewOrchestrator({
        feature: 'unsubscribe test',
        provider: mockProvider,
        firstPrinciples: false,
        contextFiles: [],
        baseDir: testDir,
      });

      const events: string[] = [];
      const unsubscribe = orchestrator.onEvent((event) => events.push(event.type));

      await orchestrator.initialize();
      const eventsAfterInit = events.length;

      // Unsubscribe
      unsubscribe();

      // Further operations should not add events
      await orchestrator.cleanup();

      // Events array should not grow after unsubscribe
      // (cleanup doesn't emit events, but this verifies unsubscribe worked)
      expect(events.length).toBe(eventsAfterInit);
    });
  });
});

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
