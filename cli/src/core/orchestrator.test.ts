/**
 * Tests for the Interview Orchestrator
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  STRUCTURED_MARKERS,
  generateSystemPrompt,
  parseAIResponse,
  InterviewOrchestrator,
  createOrchestratorFromState,
  type OrchestratorConfig,
  type StructuredQuestion,
} from './orchestrator.js';
import type { AIProvider, ProviderResponse } from '../providers/index.js';
import type { InterviewState } from './state.js';

// Mock the state module
vi.mock('./state.js', async () => {
  const actual = await vi.importActual('./state.js');
  return {
    ...actual,
    saveState: vi.fn().mockResolvedValue('/mock/path/state.yaml'),
  };
});

/**
 * Create a mock AI provider for testing
 */
function createMockProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: 'claude',
    displayName: 'Claude',
    command: 'claude',
    isAvailable: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    spawn: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    receive: vi.fn().mockResolvedValue({ content: 'Hello!', isComplete: false }),
    isRunning: vi.fn().mockReturnValue(true),
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('STRUCTURED_MARKERS', () => {
  it('should have all required markers', () => {
    expect(STRUCTURED_MARKERS.questionStart).toBe('<<<LISA_QUESTION>>>');
    expect(STRUCTURED_MARKERS.questionEnd).toBe('<<<END_LISA_QUESTION>>>');
    expect(STRUCTURED_MARKERS.completeStart).toBe('<<<LISA_COMPLETE>>>');
    expect(STRUCTURED_MARKERS.completeEnd).toBe('<<<END_LISA_COMPLETE>>>');
  });
});

describe('generateSystemPrompt', () => {
  it('should include the feature in the prompt', () => {
    const config: OrchestratorConfig = {
      feature: 'user authentication',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain('user authentication');
    expect(prompt).toContain('Lisa');
    expect(prompt).toContain('PRD');
  });

  it('should include first principles instructions when enabled', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: true,
      contextFiles: [],
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain('First Principles Mode');
    expect(prompt).toContain('fundamental assumptions');
  });

  it('should not include first principles instructions when disabled', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).not.toContain('First Principles Mode');
  });

  it('should include codebase summary when provided', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
      codebaseSummary: 'This is a Node.js project with TypeScript',
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain('Codebase Context');
    expect(prompt).toContain('Node.js project with TypeScript');
  });

  it('should include context content when provided', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
      contextContent: 'API specification goes here',
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain('Additional Context');
    expect(prompt).toContain('API specification goes here');
  });

  it('should include structured question format instructions', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain(STRUCTURED_MARKERS.questionStart);
    expect(prompt).toContain(STRUCTURED_MARKERS.questionEnd);
    expect(prompt).toContain('multiSelect');
  });

  it('should include completion format instructions', () => {
    const config: OrchestratorConfig = {
      feature: 'test feature',
      provider: createMockProvider(),
      firstPrinciples: false,
      contextFiles: [],
    };

    const prompt = generateSystemPrompt(config);

    expect(prompt).toContain(STRUCTURED_MARKERS.completeStart);
    expect(prompt).toContain(STRUCTURED_MARKERS.completeEnd);
    expect(prompt).toContain('slug');
    expect(prompt).toContain('prd');
  });
});

describe('parseAIResponse', () => {
  describe('plain text responses', () => {
    it('should parse plain text response', () => {
      const response: ProviderResponse = {
        content: 'This is a plain text response',
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.text).toBe('This is a plain text response');
      expect(result.question).toBeUndefined();
      expect(result.isComplete).toBe(false);
    });

    it('should handle empty response', () => {
      const response: ProviderResponse = {
        content: '',
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.text).toBe('');
      expect(result.question).toBeUndefined();
      expect(result.isComplete).toBe(false);
    });
  });

  describe('structured questions', () => {
    it('should parse valid structured question', () => {
      const question: StructuredQuestion = {
        header: 'Auth Type',
        question: 'What type of authentication do you need?',
        options: [
          { label: 'JWT', description: 'Token-based auth' },
          { label: 'Session', description: 'Cookie-based session' },
        ],
        multiSelect: false,
      };

      const response: ProviderResponse = {
        content: `Here's my question:\n\n${STRUCTURED_MARKERS.questionStart}\n${JSON.stringify(question)}\n${STRUCTURED_MARKERS.questionEnd}\n\nPlease choose one.`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.question).toEqual(question);
      // Text should have the structured block removed (may have extra whitespace)
      expect(result.text).toContain("Here's my question:");
      expect(result.text).toContain("Please choose one.");
      expect(result.isComplete).toBe(false);
    });

    it('should parse multi-select question', () => {
      const question: StructuredQuestion = {
        header: 'Features',
        question: 'Which features do you want?',
        options: [
          { label: 'Login', description: 'User login' },
          { label: 'Signup', description: 'User registration' },
          { label: 'OAuth', description: 'Social login' },
        ],
        multiSelect: true,
      };

      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.questionStart}${JSON.stringify(question)}${STRUCTURED_MARKERS.questionEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.question?.multiSelect).toBe(true);
      expect(result.question?.options).toHaveLength(3);
    });

    it('should ignore invalid JSON in question block', () => {
      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.questionStart}not valid json${STRUCTURED_MARKERS.questionEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.question).toBeUndefined();
      expect(result.text).toContain('not valid json');
    });

    it('should ignore question with missing required fields', () => {
      const invalidQuestion = {
        header: 'Test',
        // missing question, options, multiSelect
      };

      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.questionStart}${JSON.stringify(invalidQuestion)}${STRUCTURED_MARKERS.questionEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.question).toBeUndefined();
    });

    it('should ignore question with less than 2 options', () => {
      const invalidQuestion = {
        header: 'Test',
        question: 'Test?',
        options: [{ label: 'Only one', description: 'desc' }],
        multiSelect: false,
      };

      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.questionStart}${JSON.stringify(invalidQuestion)}${STRUCTURED_MARKERS.questionEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.question).toBeUndefined();
    });
  });

  describe('completion data', () => {
    it('should parse valid completion data', () => {
      const completion = {
        slug: 'user-auth-feature',
        prd: {
          overview: 'A user authentication system',
          userStories: [
            {
              title: 'User Login',
              description: 'As a user, I want to log in',
              acceptanceCriteria: ['Can enter email', 'Can enter password'],
            },
          ],
          technicalNotes: 'Use bcrypt for password hashing',
        },
      };

      const response: ProviderResponse = {
        content: `Great! Here's your PRD:\n\n${STRUCTURED_MARKERS.completeStart}\n${JSON.stringify(completion)}\n${STRUCTURED_MARKERS.completeEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.isComplete).toBe(true);
      expect(result.slug).toBe('user-auth-feature');
      expect(result.prd).toEqual(completion.prd);
      expect(result.text).toBe("Great! Here's your PRD:");
    });

    it('should ignore invalid completion JSON', () => {
      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.completeStart}invalid json${STRUCTURED_MARKERS.completeEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.isComplete).toBe(false);
      expect(result.slug).toBeUndefined();
      expect(result.prd).toBeUndefined();
    });

    it('should ignore completion with missing slug', () => {
      const invalidCompletion = {
        prd: {
          overview: 'Test',
          userStories: [],
          technicalNotes: 'Notes',
        },
      };

      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.completeStart}${JSON.stringify(invalidCompletion)}${STRUCTURED_MARKERS.completeEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.isComplete).toBe(false);
    });

    it('should ignore completion with missing prd fields', () => {
      const invalidCompletion = {
        slug: 'test',
        prd: {
          overview: 'Test',
          // missing userStories and technicalNotes
        },
      };

      const response: ProviderResponse = {
        content: `${STRUCTURED_MARKERS.completeStart}${JSON.stringify(invalidCompletion)}${STRUCTURED_MARKERS.completeEnd}`,
        isComplete: false,
      };

      const result = parseAIResponse(response);

      expect(result.isComplete).toBe(false);
    });
  });
});

describe('InterviewOrchestrator', () => {
  let mockProvider: AIProvider;
  let config: OrchestratorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = createMockProvider();
    config = {
      feature: 'test feature',
      provider: mockProvider,
      firstPrinciples: false,
      contextFiles: [],
    };
  });

  describe('constructor', () => {
    it('should create orchestrator with initial state', () => {
      const orchestrator = new InterviewOrchestrator(config);
      const state = orchestrator.getState();

      expect(state.feature).toBe('test feature');
      expect(state.provider).toBe('claude');
      expect(state.firstPrinciples).toBe(false);
      expect(state.phase).toBe('exploring');
    });

    it('should pass options to initial state', () => {
      const orchestrator = new InterviewOrchestrator({
        ...config,
        firstPrinciples: true,
        contextFiles: ['file1.md', 'file2.md'],
      });
      const state = orchestrator.getState();

      expect(state.firstPrinciples).toBe(true);
      expect(state.contextFiles).toEqual(['file1.md', 'file2.md']);
    });
  });

  describe('onEvent', () => {
    it('should add event handler', () => {
      const orchestrator = new InterviewOrchestrator(config);
      const handler = vi.fn();

      const unsubscribe = orchestrator.onEvent(handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should return unsubscribe function', () => {
      const orchestrator = new InterviewOrchestrator(config);
      const handler = vi.fn();

      const unsubscribe = orchestrator.onEvent(handler);
      unsubscribe();

      // Handler should be removed (tested indirectly through initialize)
    });
  });

  describe('getState / setState', () => {
    it('should get current state', () => {
      const orchestrator = new InterviewOrchestrator(config);
      const state = orchestrator.getState();

      expect(state).toBeDefined();
      expect(state.feature).toBe('test feature');
    });

    it('should set state', () => {
      const orchestrator = new InterviewOrchestrator(config);
      const newState: InterviewState = {
        version: 1,
        feature: 'different feature',
        provider: 'opencode',
        firstPrinciples: true,
        contextFiles: ['test.md'],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: 'questioning',
        history: [],
        aiContext: '',
      };

      orchestrator.setState(newState);
      const state = orchestrator.getState();

      expect(state.feature).toBe('different feature');
      expect(state.provider).toBe('opencode');
    });
  });

  describe('initialize', () => {
    it('should spawn provider with system prompt', async () => {
      const orchestrator = new InterviewOrchestrator(config);

      await orchestrator.initialize();

      expect(mockProvider.spawn).toHaveBeenCalledTimes(1);
      const spawnArg = (mockProvider.spawn as Mock).mock.calls[0][0];
      expect(spawnArg).toContain('test feature');
    });

    it('should update phase to questioning', async () => {
      const orchestrator = new InterviewOrchestrator(config);

      await orchestrator.initialize();
      const state = orchestrator.getState();

      expect(state.phase).toBe('questioning');
    });

    it('should emit phase_change event', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      const handler = vi.fn();
      orchestrator.onEvent(handler);

      await orchestrator.initialize();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'phase_change',
          phase: 'questioning',
        })
      );
    });

    it('should return initial AI response', async () => {
      (mockProvider.receive as Mock).mockResolvedValue({
        content: 'Welcome! Let me ask you some questions.',
        isComplete: false,
      });

      const orchestrator = new InterviewOrchestrator(config);
      const result = await orchestrator.initialize();

      expect(result.text).toBe('Welcome! Let me ask you some questions.');
      expect(result.isComplete).toBe(false);
    });

    it('should throw if already initialized', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      await expect(orchestrator.initialize()).rejects.toThrow(
        'Orchestrator already initialized'
      );
    });

    it('should emit ai_response event', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      const handler = vi.fn();
      orchestrator.onEvent(handler);

      await orchestrator.initialize();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ai_response',
        })
      );
    });
  });

  describe('sendUserResponse', () => {
    it('should throw if not initialized', async () => {
      const orchestrator = new InterviewOrchestrator(config);

      await expect(orchestrator.sendUserResponse('answer')).rejects.toThrow(
        'Orchestrator not initialized'
      );
    });

    it('should send message to provider', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      await orchestrator.sendUserResponse('My answer');

      expect(mockProvider.send).toHaveBeenCalledWith({ content: 'My answer' });
    });

    it('should return AI response', async () => {
      (mockProvider.receive as Mock)
        .mockResolvedValueOnce({ content: 'Initial', isComplete: false })
        .mockResolvedValueOnce({ content: 'Follow-up question', isComplete: false });

      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      const result = await orchestrator.sendUserResponse('My answer');

      expect(result.text).toBe('Follow-up question');
    });

    it('should update state on completion signal', async () => {
      const completion = {
        slug: 'test',
        prd: {
          overview: 'Overview',
          userStories: [],
          technicalNotes: 'Notes',
        },
      };

      (mockProvider.receive as Mock)
        .mockResolvedValueOnce({ content: 'Initial', isComplete: false })
        .mockResolvedValueOnce({
          content: `${STRUCTURED_MARKERS.completeStart}${JSON.stringify(completion)}${STRUCTURED_MARKERS.completeEnd}`,
          isComplete: false,
        });

      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      const result = await orchestrator.sendUserResponse('Final answer');

      expect(result.isComplete).toBe(true);
      expect(orchestrator.getState().phase).toBe('generating');
    });

    it('should emit events during user response', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      const handler = vi.fn();
      orchestrator.onEvent(handler);

      await orchestrator.sendUserResponse('answer');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai_response' })
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state_saved' })
      );
    });
  });

  describe('complete', () => {
    it('should extract completion data from AI context', async () => {
      const completion = {
        slug: 'my-feature',
        prd: {
          overview: 'Feature overview',
          userStories: [
            {
              title: 'Story 1',
              description: 'As a user...',
              acceptanceCriteria: ['Criterion 1'],
            },
          ],
          technicalNotes: 'Technical notes here',
        },
      };

      (mockProvider.receive as Mock).mockResolvedValue({
        content: `${STRUCTURED_MARKERS.completeStart}${JSON.stringify(completion)}${STRUCTURED_MARKERS.completeEnd}`,
        isComplete: false,
      });

      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      const result = await orchestrator.complete();

      expect(result.success).toBe(true);
      expect(result.slug).toBe('my-feature');
      expect(result.prd).toEqual(completion.prd);
    });

    it('should return failure if no completion data', async () => {
      (mockProvider.receive as Mock).mockResolvedValue({
        content: 'Just regular text',
        isComplete: false,
      });

      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      const result = await orchestrator.complete();

      expect(result.success).toBe(false);
      expect(result.error).toBe('No completion data found');
    });
  });

  describe('cleanup', () => {
    it('should cleanup provider', async () => {
      const orchestrator = new InterviewOrchestrator(config);
      await orchestrator.initialize();

      await orchestrator.cleanup();

      expect(mockProvider.cleanup).toHaveBeenCalled();
    });
  });
});

describe('createOrchestratorFromState', () => {
  it('should create orchestrator with existing state', () => {
    const state: InterviewState = {
      version: 1,
      feature: 'existing feature',
      provider: 'opencode',
      firstPrinciples: true,
      contextFiles: ['context.md'],
      startedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T01:00:00Z',
      phase: 'questioning',
      history: [
        { question: 'Q1?', answer: 'A1', timestamp: '2024-01-01T00:30:00Z' },
      ],
      aiContext: 'Previous context',
    };

    const mockProvider = createMockProvider({ name: 'opencode' });
    const orchestrator = createOrchestratorFromState(state, mockProvider);

    const currentState = orchestrator.getState();

    expect(currentState).toEqual(state);
    expect(currentState.feature).toBe('existing feature');
    expect(currentState.history).toHaveLength(1);
  });

  it('should accept optional baseDir', () => {
    const state: InterviewState = {
      version: 1,
      feature: 'test',
      provider: 'claude',
      firstPrinciples: false,
      contextFiles: [],
      startedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      phase: 'exploring',
      history: [],
      aiContext: '',
    };

    const mockProvider = createMockProvider();
    const orchestrator = createOrchestratorFromState(
      state,
      mockProvider,
      '/custom/path'
    );

    expect(orchestrator.getState()).toEqual(state);
  });
});
