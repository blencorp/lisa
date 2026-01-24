/**
 * State management for Lisa CLI
 * Handles saving/restoring interview progress for resume functionality
 */

import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ProviderName } from '../providers/index.js';

/**
 * Represents a single question-answer pair in the interview
 */
export interface InterviewQA {
  /** The question asked by the AI */
  question: string;
  /** The user's answer */
  answer: string;
  /** Timestamp when the answer was provided */
  timestamp: string;
}

/**
 * Interview state that can be saved and restored
 */
export interface InterviewState {
  /** Version of the state format for future migrations */
  version: 1;
  /** The feature being planned */
  feature: string;
  /** AI provider being used */
  provider: ProviderName;
  /** Whether first-principles mode is enabled */
  firstPrinciples: boolean;
  /** Context files provided */
  contextFiles: string[];
  /** Interview start timestamp */
  startedAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Current phase of the interview */
  phase: 'exploring' | 'questioning' | 'generating';
  /** History of questions and answers */
  history: InterviewQA[];
  /** Any accumulated AI context/notes */
  aiContext: string;
}

export interface StateValidationError {
  field: string;
  message: string;
}

export interface StateResult {
  state: InterviewState;
  statePath: string;
}

const CURRENT_STATE_VERSION = 1;

/**
 * Get the path to the state file
 */
export function getStatePath(baseDir: string = process.cwd()): string {
  return join(baseDir, 'lisa', 'state.yaml');
}

/**
 * Check if a file exists
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
 * Check if a saved state exists
 */
export async function hasState(baseDir: string = process.cwd()): Promise<boolean> {
  const statePath = getStatePath(baseDir);
  return fileExists(statePath);
}

/**
 * Validate the state object
 * Returns an array of validation errors (empty if valid)
 */
export function validateState(state: unknown): StateValidationError[] {
  const errors: StateValidationError[] = [];

  if (state === null || typeof state !== 'object') {
    errors.push({ field: 'root', message: 'State must be an object' });
    return errors;
  }

  const s = state as Record<string, unknown>;

  // Validate version
  if (s.version === undefined) {
    errors.push({ field: 'version', message: 'version is required' });
  } else if (typeof s.version !== 'number' || s.version !== CURRENT_STATE_VERSION) {
    errors.push({ field: 'version', message: `version must be ${CURRENT_STATE_VERSION}` });
  }

  // Validate feature
  if (s.feature === undefined) {
    errors.push({ field: 'feature', message: 'feature is required' });
  } else if (typeof s.feature !== 'string' || s.feature.length === 0) {
    errors.push({ field: 'feature', message: 'feature must be a non-empty string' });
  }

  // Validate provider
  const validProviders = ['claude', 'opencode', 'cursor', 'codex', 'copilot'];
  if (s.provider === undefined) {
    errors.push({ field: 'provider', message: 'provider is required' });
  } else if (typeof s.provider !== 'string' || !validProviders.includes(s.provider)) {
    errors.push({ field: 'provider', message: `provider must be one of: ${validProviders.join(', ')}` });
  }

  // Validate firstPrinciples
  if (s.firstPrinciples === undefined) {
    errors.push({ field: 'firstPrinciples', message: 'firstPrinciples is required' });
  } else if (typeof s.firstPrinciples !== 'boolean') {
    errors.push({ field: 'firstPrinciples', message: 'firstPrinciples must be a boolean' });
  }

  // Validate contextFiles
  if (s.contextFiles === undefined) {
    errors.push({ field: 'contextFiles', message: 'contextFiles is required' });
  } else if (!Array.isArray(s.contextFiles)) {
    errors.push({ field: 'contextFiles', message: 'contextFiles must be an array' });
  } else if (!s.contextFiles.every((f) => typeof f === 'string')) {
    errors.push({ field: 'contextFiles', message: 'contextFiles must contain only strings' });
  }

  // Validate startedAt
  if (s.startedAt === undefined) {
    errors.push({ field: 'startedAt', message: 'startedAt is required' });
  } else if (typeof s.startedAt !== 'string') {
    errors.push({ field: 'startedAt', message: 'startedAt must be a string' });
  }

  // Validate updatedAt
  if (s.updatedAt === undefined) {
    errors.push({ field: 'updatedAt', message: 'updatedAt is required' });
  } else if (typeof s.updatedAt !== 'string') {
    errors.push({ field: 'updatedAt', message: 'updatedAt must be a string' });
  }

  // Validate phase
  const validPhases = ['exploring', 'questioning', 'generating'];
  if (s.phase === undefined) {
    errors.push({ field: 'phase', message: 'phase is required' });
  } else if (typeof s.phase !== 'string' || !validPhases.includes(s.phase)) {
    errors.push({ field: 'phase', message: `phase must be one of: ${validPhases.join(', ')}` });
  }

  // Validate history
  if (s.history === undefined) {
    errors.push({ field: 'history', message: 'history is required' });
  } else if (!Array.isArray(s.history)) {
    errors.push({ field: 'history', message: 'history must be an array' });
  } else {
    for (let i = 0; i < s.history.length; i++) {
      const qa = s.history[i] as Record<string, unknown>;
      if (typeof qa !== 'object' || qa === null) {
        errors.push({ field: `history[${i}]`, message: 'must be an object' });
        continue;
      }
      if (typeof qa.question !== 'string') {
        errors.push({ field: `history[${i}].question`, message: 'must be a string' });
      }
      if (typeof qa.answer !== 'string') {
        errors.push({ field: `history[${i}].answer`, message: 'must be a string' });
      }
      if (typeof qa.timestamp !== 'string') {
        errors.push({ field: `history[${i}].timestamp`, message: 'must be a string' });
      }
    }
  }

  // Validate aiContext
  if (s.aiContext === undefined) {
    errors.push({ field: 'aiContext', message: 'aiContext is required' });
  } else if (typeof s.aiContext !== 'string') {
    errors.push({ field: 'aiContext', message: 'aiContext must be a string' });
  }

  return errors;
}

/**
 * Create a new interview state
 */
export function createState(
  feature: string,
  provider: ProviderName,
  options: {
    firstPrinciples?: boolean;
    contextFiles?: string[];
  } = {}
): InterviewState {
  const now = new Date().toISOString();
  return {
    version: CURRENT_STATE_VERSION,
    feature,
    provider,
    firstPrinciples: options.firstPrinciples ?? false,
    contextFiles: options.contextFiles ?? [],
    startedAt: now,
    updatedAt: now,
    phase: 'exploring',
    history: [],
    aiContext: '',
  };
}

/**
 * Load state from disk
 * Returns null if no state exists
 * Throws if state is corrupted
 */
export async function loadState(baseDir: string = process.cwd()): Promise<StateResult | null> {
  const statePath = getStatePath(baseDir);

  if (!(await fileExists(statePath))) {
    return null;
  }

  let content: string;
  try {
    content = await readFile(statePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to read state file: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Corrupted state file (invalid YAML): ${message}`);
  }

  const errors = validateState(parsed);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Corrupted state file (invalid data):\n${errorMessages}`);
  }

  return {
    state: parsed as InterviewState,
    statePath,
  };
}

/**
 * Save state to disk
 */
export async function saveState(state: InterviewState, baseDir: string = process.cwd()): Promise<string> {
  const statePath = getStatePath(baseDir);
  const dir = dirname(statePath);

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Validate before saving
  const errors = validateState(state);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Cannot save invalid state:\n${errorMessages}`);
  }

  // Update the updatedAt timestamp
  const stateToSave: InterviewState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  const yamlContent = stringify(stateToSave, {
    lineWidth: 0, // Disable line wrapping
  });

  // Add helpful header
  const contentWithHeader = `# Lisa Interview State
# This file stores your interview progress. Delete to start fresh.
# DO NOT edit manually.

${yamlContent}`;

  await writeFile(statePath, contentWithHeader, 'utf-8');
  return statePath;
}

/**
 * Delete the state file (cleanup after successful completion)
 */
export async function clearState(baseDir: string = process.cwd()): Promise<boolean> {
  const statePath = getStatePath(baseDir);

  if (!(await fileExists(statePath))) {
    return false;
  }

  await unlink(statePath);
  return true;
}

/**
 * Add a question-answer pair to the state history
 */
export function addToHistory(state: InterviewState, question: string, answer: string): InterviewState {
  return {
    ...state,
    history: [
      ...state.history,
      {
        question,
        answer,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Update the interview phase
 */
export function updatePhase(state: InterviewState, phase: InterviewState['phase']): InterviewState {
  return {
    ...state,
    phase,
  };
}

/**
 * Update the AI context
 */
export function updateAIContext(state: InterviewState, aiContext: string): InterviewState {
  return {
    ...state,
    aiContext,
  };
}
