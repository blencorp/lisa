/**
 * Interview Orchestrator
 * Manages the interview flow between user and AI provider
 */

import type { AIProvider, ProviderResponse } from '../providers/index.js';
import type { InterviewState } from './state.js';
import { createState, saveState, addToHistory, updatePhase, updateAIContext } from './state.js';
import type { ProviderName } from '../providers/base.js';
import {
  classifyError,
  trySaveState,
} from './error-recovery.js';

/**
 * Structured question data that AI can output
 */
export interface StructuredQuestion {
  /** Short header/label for the question (max 12 chars) */
  header: string;
  /** The full question text */
  question: string;
  /** Available options for the user to choose from */
  options: Array<{
    /** Display label for the option */
    label: string;
    /** Description/explanation of the option */
    description: string;
  }>;
  /** Whether multiple options can be selected */
  multiSelect: boolean;
}

/**
 * Parsed AI response with potential structured data
 */
export interface ParsedAIResponse {
  /** Raw text content from the AI */
  text: string;
  /** Structured question if detected */
  question?: StructuredQuestion;
  /** Whether the interview is complete */
  isComplete: boolean;
  /** AI-generated slug for the PRD (on completion) */
  slug?: string;
  /** PRD content (on completion) */
  prd?: {
    overview: string;
    userStories: Array<{
      title: string;
      description: string;
      acceptanceCriteria: string[];
    }>;
    technicalNotes: string;
  };
}

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  /** The feature being planned */
  feature: string;
  /** AI provider to use */
  provider: AIProvider;
  /** Whether to use first-principles mode */
  firstPrinciples: boolean;
  /** Context files to include */
  contextFiles: string[];
  /** Codebase summary (from exploration) */
  codebaseSummary?: string;
  /** Context file contents */
  contextContent?: string;
  /** Base directory for state persistence */
  baseDir?: string;
}

/**
 * Result from a single interaction turn
 */
export interface TurnResult {
  /** The AI's response text */
  text: string;
  /** Structured question if any */
  question?: StructuredQuestion;
  /** Whether the interview is complete */
  isComplete: boolean;
  /** Updated state */
  state: InterviewState;
}

/**
 * Result from completing the interview
 */
export interface InterviewCompletionResult {
  /** Whether the interview completed successfully */
  success: boolean;
  /** AI-generated slug for output files */
  slug?: string;
  /** Generated PRD content */
  prd?: ParsedAIResponse['prd'];
  /** Final interview state */
  state: InterviewState;
  /** Error message if failed */
  error?: string;
}

/**
 * Event types emitted by the orchestrator
 */
export type OrchestratorEvent =
  | { type: 'phase_change'; phase: InterviewState['phase'] }
  | { type: 'ai_response'; response: ParsedAIResponse }
  | { type: 'state_saved'; path: string }
  | { type: 'error'; error: Error };

/**
 * Event handler type
 */
export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;

/**
 * Markers used to detect structured output from AI
 */
export const STRUCTURED_MARKERS = {
  questionStart: '<<<LISA_QUESTION>>>',
  questionEnd: '<<<END_LISA_QUESTION>>>',
  completeStart: '<<<LISA_COMPLETE>>>',
  completeEnd: '<<<END_LISA_COMPLETE>>>',
} as const;

/**
 * Generate the system prompt for the interview
 */
export function generateSystemPrompt(config: OrchestratorConfig): string {
  const parts: string[] = [];

  parts.push(`You are Lisa, an AI assistant that helps developers plan software features through structured interviews.

Your goal is to gather enough information to generate a high-quality Product Requirements Document (PRD) for the following feature:

**Feature:** ${config.feature}
`);

  if (config.firstPrinciples) {
    parts.push(`
**First Principles Mode:** Before diving into implementation details, start by questioning the fundamental assumptions about this feature. Ask:
- What problem is this really solving?
- Is this the right solution to that problem?
- What are the core constraints and trade-offs?
- Are there simpler alternatives that achieve the same goal?
`);
  }

  if (config.codebaseSummary) {
    parts.push(`
**Codebase Context:**
${config.codebaseSummary}
`);
  }

  if (config.contextContent) {
    parts.push(`
**Additional Context:**
${config.contextContent}
`);
  }

  parts.push(`
**Interview Instructions:**
1. Ask focused questions to understand requirements, constraints, and user needs
2. Use structured questions when offering multiple-choice options
3. Keep questions concise but informative
4. Probe deeper when answers are vague or incomplete
5. Consider technical implications and edge cases

**Structured Question Format:**
When you want to present multiple-choice options, output in this EXACT format:

${STRUCTURED_MARKERS.questionStart}
{
  "header": "Short Label",
  "question": "Your full question here?",
  "options": [
    {"label": "Option 1", "description": "Explanation of option 1"},
    {"label": "Option 2", "description": "Explanation of option 2"}
  ],
  "multiSelect": false
}
${STRUCTURED_MARKERS.questionEnd}

The header should be max 12 characters. Options should have 2-4 choices. Set multiSelect to true only when multiple selections make sense.

**Completion Format:**
When you have gathered enough information, output the PRD in this EXACT format:

${STRUCTURED_MARKERS.completeStart}
{
  "slug": "feature-name-slug",
  "prd": {
    "overview": "High-level description of the feature",
    "userStories": [
      {
        "title": "User story title",
        "description": "As a [user], I want [goal] so that [benefit]",
        "acceptanceCriteria": ["Criterion 1", "Criterion 2"]
      }
    ],
    "technicalNotes": "Technical considerations, architecture notes, etc."
  }
}
${STRUCTURED_MARKERS.completeEnd}

**Important:**
- Only output ONE structured block per response (either question or completion)
- You can include regular text before or after structured blocks
- The slug should be lowercase with hyphens, suitable for filenames
- Gather at least 3-5 rounds of questions before completing
`);

  return parts.join('\n');
}

/**
 * Parse AI response to extract structured data
 */
export function parseAIResponse(response: ProviderResponse): ParsedAIResponse {
  const result: ParsedAIResponse = {
    text: response.content,
    isComplete: false,
  };

  // Check for structured question
  const questionMatch = response.content.match(
    new RegExp(
      `${escapeRegex(STRUCTURED_MARKERS.questionStart)}\\s*([\\s\\S]*?)\\s*${escapeRegex(STRUCTURED_MARKERS.questionEnd)}`
    )
  );

  if (questionMatch) {
    try {
      const questionData = JSON.parse(questionMatch[1]) as StructuredQuestion;
      // Validate the structure
      if (isValidStructuredQuestion(questionData)) {
        result.question = questionData;
        // Remove the structured block from text for cleaner display
        result.text = response.content
          .replace(questionMatch[0], '')
          .trim();
      }
    } catch {
      // Invalid JSON, treat as regular text
    }
  }

  // Check for completion
  const completeMatch = response.content.match(
    new RegExp(
      `${escapeRegex(STRUCTURED_MARKERS.completeStart)}\\s*([\\s\\S]*?)\\s*${escapeRegex(STRUCTURED_MARKERS.completeEnd)}`
    )
  );

  if (completeMatch) {
    try {
      const completeData = JSON.parse(completeMatch[1]) as {
        slug: string;
        prd: ParsedAIResponse['prd'];
      };
      if (isValidCompletion(completeData)) {
        result.isComplete = true;
        result.slug = completeData.slug;
        result.prd = completeData.prd;
        // Remove the structured block from text
        result.text = response.content
          .replace(completeMatch[0], '')
          .trim();
      }
    } catch {
      // Invalid JSON, treat as regular text
    }
  }

  return result;
}

/**
 * Validate structured question data
 */
function isValidStructuredQuestion(data: unknown): data is StructuredQuestion {
  if (typeof data !== 'object' || data === null) return false;
  const q = data as Record<string, unknown>;
  return (
    typeof q.header === 'string' &&
    typeof q.question === 'string' &&
    Array.isArray(q.options) &&
    q.options.length >= 2 &&
    q.options.every(
      (opt: unknown) =>
        typeof opt === 'object' &&
        opt !== null &&
        typeof (opt as Record<string, unknown>).label === 'string' &&
        typeof (opt as Record<string, unknown>).description === 'string'
    ) &&
    typeof q.multiSelect === 'boolean'
  );
}

/**
 * Validate completion data
 */
function isValidCompletion(
  data: unknown
): data is { slug: string; prd: ParsedAIResponse['prd'] } {
  if (typeof data !== 'object' || data === null) return false;
  const c = data as Record<string, unknown>;
  if (typeof c.slug !== 'string') return false;
  if (typeof c.prd !== 'object' || c.prd === null) return false;
  const prd = c.prd as Record<string, unknown>;
  return (
    typeof prd.overview === 'string' &&
    Array.isArray(prd.userStories) &&
    typeof prd.technicalNotes === 'string'
  );
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Interview Orchestrator class
 * Manages the lifecycle of an interview session
 */
export class InterviewOrchestrator {
  private config: OrchestratorConfig;
  private state: InterviewState;
  private eventHandlers: OrchestratorEventHandler[] = [];
  private isInitialized = false;
  private lastCompletionData: { slug: string; prd: ParsedAIResponse['prd'] } | null = null;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    // Create initial state
    this.state = createState(config.feature, config.provider.name as ProviderName, {
      firstPrinciples: config.firstPrinciples,
      contextFiles: config.contextFiles,
    });
  }

  /**
   * Subscribe to orchestrator events
   */
  onEvent(handler: OrchestratorEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: OrchestratorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  /**
   * Get current interview state
   */
  getState(): InterviewState {
    return this.state;
  }

  /**
   * Set state (for resume functionality)
   */
  setState(state: InterviewState): void {
    this.state = state;
  }

  /**
   * Initialize the orchestrator and start the interview
   * @returns The initial AI response
   */
  async initialize(): Promise<TurnResult> {
    if (this.isInitialized) {
      throw new Error('Orchestrator already initialized');
    }

    const systemPrompt = generateSystemPrompt(this.config);

    // Save state before AI operation for recovery
    await this.saveStateWithRecovery();

    try {
      // Spawn the provider with system prompt
      await this.config.provider.spawn(systemPrompt);
      this.isInitialized = true;

      // Update phase to questioning
      this.state = updatePhase(this.state, 'questioning');
      this.emit({ type: 'phase_change', phase: 'questioning' });

      // Save state after phase change
      await this.saveState();

      // Save state before receiving AI response
      await this.saveStateWithRecovery();

      // Get initial response from AI
      const response = await this.config.provider.receive();
      const parsed = parseAIResponse(response);

      this.emit({ type: 'ai_response', response: parsed });

      // Update AI context if there's substantial content
      if (parsed.text) {
        this.state = updateAIContext(this.state, parsed.text);
        await this.saveState();
      }

      // Store completion data if present
      if (parsed.isComplete && parsed.slug && parsed.prd) {
        this.lastCompletionData = { slug: parsed.slug, prd: parsed.prd };
      }

      return {
        text: parsed.text,
        question: parsed.question,
        isComplete: parsed.isComplete,
        state: this.state,
      };
    } catch (error) {
      // Ensure state is saved on error for recovery
      await this.saveStateWithRecovery();

      // Emit error event
      const interviewError = classifyError(error);
      this.emit({ type: 'error', error: interviewError });

      throw interviewError;
    }
  }

  /**
   * Send user response and get AI's next turn
   */
  async sendUserResponse(userAnswer: string): Promise<TurnResult> {
    if (!this.isInitialized) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    // Get the last question from history or state (before modifying state)
    const lastQuestion = this.state.history.length > 0
      ? this.state.history[this.state.history.length - 1].question
      : 'Initial question';

    // Add to history first to preserve user's answer
    this.state = addToHistory(this.state, lastQuestion, userAnswer);

    // Save state before any AI call - this ensures user's answer is preserved
    await this.saveStateWithRecovery();

    try {
      // Send user's answer to AI
      await this.config.provider.send({ content: userAnswer });

      // Save state before receiving AI response
      await this.saveStateWithRecovery();

      // Get AI response
      const response = await this.config.provider.receive();
      const parsed = parseAIResponse(response);

      this.emit({ type: 'ai_response', response: parsed });

      // Update AI context
      if (parsed.text) {
        this.state = updateAIContext(
          this.state,
          this.state.aiContext + '\n\n' + parsed.text
        );
      }

      // Update phase if completing
      if (parsed.isComplete) {
        this.state = updatePhase(this.state, 'generating');
        this.emit({ type: 'phase_change', phase: 'generating' });
      }

      // Store completion data if present
      if (parsed.isComplete && parsed.slug && parsed.prd) {
        this.lastCompletionData = { slug: parsed.slug, prd: parsed.prd };
      }

      // Save state after successful response
      await this.saveState();

      return {
        text: parsed.text,
        question: parsed.question,
        isComplete: parsed.isComplete,
        state: this.state,
      };
    } catch (error) {
      // Ensure state is saved on error for recovery (user's answer already in history)
      await this.saveStateWithRecovery();

      // Emit error event
      const interviewError = classifyError(error);
      this.emit({ type: 'error', error: interviewError });

      throw interviewError;
    }
  }

  /**
   * Complete the interview and return final result
   */
  async complete(): Promise<InterviewCompletionResult> {
    // Check if we have stored completion data from previous responses
    if (this.lastCompletionData) {
      return {
        success: true,
        slug: this.lastCompletionData.slug,
        prd: this.lastCompletionData.prd,
        state: this.state,
      };
    }

    // Fallback: try to extract completion data from accumulated context
    const aiContext = this.state.aiContext;
    const completeMatch = aiContext.match(
      new RegExp(
        `${escapeRegex(STRUCTURED_MARKERS.completeStart)}\\s*([\\s\\S]*?)\\s*${escapeRegex(STRUCTURED_MARKERS.completeEnd)}`
      )
    );

    if (completeMatch) {
      try {
        const completeData = JSON.parse(completeMatch[1]) as {
          slug: string;
          prd: ParsedAIResponse['prd'];
        };

        return {
          success: true,
          slug: completeData.slug,
          prd: completeData.prd,
          state: this.state,
        };
      } catch {
        return {
          success: false,
          error: 'Failed to parse completion data',
          state: this.state,
        };
      }
    }

    return {
      success: false,
      error: 'No completion data found',
      state: this.state,
    };
  }

  /**
   * Save current state to disk
   */
  private async saveState(): Promise<void> {
    const path = await saveState(this.state, this.config.baseDir);
    this.emit({ type: 'state_saved', path });
  }

  /**
   * Save state with recovery (won't throw, logs warning on failure)
   * Use before AI operations to ensure state is preserved
   */
  private async saveStateWithRecovery(): Promise<void> {
    const result = await trySaveState(this.state, this.config.baseDir);
    if (result.success && result.path) {
      this.emit({ type: 'state_saved', path: result.path });
    } else if (result.error) {
      // Log warning but don't fail - we want the operation to continue
      console.warn(`Warning: Could not save state: ${result.error.message}`);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.config.provider.cleanup();
  }
}

/**
 * Create an orchestrator from existing state (for resume)
 */
export function createOrchestratorFromState(
  state: InterviewState,
  provider: AIProvider,
  baseDir?: string
): InterviewOrchestrator {
  const config: OrchestratorConfig = {
    feature: state.feature,
    provider,
    firstPrinciples: state.firstPrinciples,
    contextFiles: state.contextFiles,
    baseDir,
  };

  const orchestrator = new InterviewOrchestrator(config);
  orchestrator.setState(state);

  return orchestrator;
}
