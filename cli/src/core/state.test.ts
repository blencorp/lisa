/**
 * Tests for state management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getStatePath,
  hasState,
  validateState,
  createState,
  loadState,
  saveState,
  clearState,
  addToHistory,
  updatePhase,
  updateAIContext,
  type InterviewState,
} from './state.js';

describe('state', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `lisa-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true });
  });

  function createValidState(): InterviewState {
    return {
      version: 1,
      feature: 'Test feature',
      provider: 'claude',
      firstPrinciples: false,
      contextFiles: [],
      startedAt: '2026-01-22T10:00:00.000Z',
      updatedAt: '2026-01-22T10:00:00.000Z',
      phase: 'exploring',
      history: [],
      aiContext: '',
    };
  }

  describe('getStatePath', () => {
    it('returns correct path for given base directory', () => {
      const path = getStatePath('/some/project');
      expect(path).toBe('/some/project/lisa/state.yaml');
    });

    it('uses current directory when no base specified', () => {
      const path = getStatePath();
      expect(path).toContain('lisa/state.yaml');
    });
  });

  describe('hasState', () => {
    it('returns false when no state file exists', async () => {
      const result = await hasState(testDir);
      expect(result).toBe(false);
    });

    it('returns true when state file exists', async () => {
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'state.yaml'), 'version: 1');

      const result = await hasState(testDir);
      expect(result).toBe(true);
    });
  });

  describe('validateState', () => {
    it('accepts valid state', () => {
      const state = createValidState();
      const errors = validateState(state);
      expect(errors).toEqual([]);
    });

    it('accepts all valid providers', () => {
      const providers = ['claude', 'opencode', 'cursor', 'codex', 'copilot'] as const;
      for (const provider of providers) {
        const state = createValidState();
        state.provider = provider;
        const errors = validateState(state);
        expect(errors).toEqual([]);
      }
    });

    it('accepts all valid phases', () => {
      const phases = ['exploring', 'questioning', 'generating'] as const;
      for (const phase of phases) {
        const state = createValidState();
        state.phase = phase;
        const errors = validateState(state);
        expect(errors).toEqual([]);
      }
    });

    it('rejects null state', () => {
      const errors = validateState(null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({ field: 'root', message: 'State must be an object' });
    });

    it('rejects non-object state', () => {
      const errors = validateState('invalid');
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('root');
    });

    it('rejects missing version', () => {
      const state = createValidState();
      delete (state as Record<string, unknown>).version;
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'version')).toBe(true);
    });

    it('rejects invalid version number', () => {
      const state = createValidState();
      (state as Record<string, unknown>).version = 2;
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'version')).toBe(true);
    });

    it('rejects missing feature', () => {
      const state = createValidState();
      delete (state as Record<string, unknown>).feature;
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'feature')).toBe(true);
    });

    it('rejects empty feature', () => {
      const state = createValidState();
      state.feature = '';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'feature')).toBe(true);
    });

    it('rejects invalid provider', () => {
      const state = createValidState();
      (state as Record<string, unknown>).provider = 'invalid-provider';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'provider')).toBe(true);
    });

    it('rejects non-boolean firstPrinciples', () => {
      const state = createValidState();
      (state as Record<string, unknown>).firstPrinciples = 'yes';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'firstPrinciples')).toBe(true);
    });

    it('rejects non-array contextFiles', () => {
      const state = createValidState();
      (state as Record<string, unknown>).contextFiles = 'file.md';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'contextFiles')).toBe(true);
    });

    it('rejects contextFiles with non-string elements', () => {
      const state = createValidState();
      (state as Record<string, unknown>).contextFiles = ['valid.md', 123];
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'contextFiles')).toBe(true);
    });

    it('rejects invalid phase', () => {
      const state = createValidState();
      (state as Record<string, unknown>).phase = 'invalid-phase';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'phase')).toBe(true);
    });

    it('rejects non-array history', () => {
      const state = createValidState();
      (state as Record<string, unknown>).history = 'not an array';
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'history')).toBe(true);
    });

    it('rejects history with invalid entries', () => {
      const state = createValidState();
      state.history = [
        { question: 'Q?', answer: 'A', timestamp: '2026-01-22T10:00:00.000Z' },
        { question: 123 as unknown as string, answer: 'A', timestamp: '2026-01-22T10:00:00.000Z' },
      ];
      const errors = validateState(state);
      expect(errors.some((e) => e.field.includes('history[1]'))).toBe(true);
    });

    it('rejects missing aiContext', () => {
      const state = createValidState();
      delete (state as Record<string, unknown>).aiContext;
      const errors = validateState(state);
      expect(errors.some((e) => e.field === 'aiContext')).toBe(true);
    });

    it('collects multiple errors', () => {
      const errors = validateState({});
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe('createState', () => {
    it('creates state with required fields', () => {
      const state = createState('My feature', 'claude');

      expect(state.version).toBe(1);
      expect(state.feature).toBe('My feature');
      expect(state.provider).toBe('claude');
      expect(state.firstPrinciples).toBe(false);
      expect(state.contextFiles).toEqual([]);
      expect(state.phase).toBe('exploring');
      expect(state.history).toEqual([]);
      expect(state.aiContext).toBe('');
    });

    it('creates state with optional firstPrinciples', () => {
      const state = createState('My feature', 'opencode', { firstPrinciples: true });
      expect(state.firstPrinciples).toBe(true);
    });

    it('creates state with optional contextFiles', () => {
      const state = createState('My feature', 'cursor', { contextFiles: ['spec.md', 'notes.txt'] });
      expect(state.contextFiles).toEqual(['spec.md', 'notes.txt']);
    });

    it('sets timestamps', () => {
      const before = new Date().toISOString();
      const state = createState('My feature', 'claude');
      const after = new Date().toISOString();

      expect(state.startedAt >= before).toBe(true);
      expect(state.startedAt <= after).toBe(true);
      expect(state.updatedAt).toBe(state.startedAt);
    });

    it('creates valid state', () => {
      const state = createState('My feature', 'claude', {
        firstPrinciples: true,
        contextFiles: ['doc.md'],
      });
      const errors = validateState(state);
      expect(errors).toEqual([]);
    });
  });

  describe('loadState', () => {
    it('returns null when no state exists', async () => {
      const result = await loadState(testDir);
      expect(result).toBeNull();
    });

    it('loads existing state file', async () => {
      const state = createValidState();
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });

      const yaml = `version: 1
feature: Test feature
provider: claude
firstPrinciples: false
contextFiles: []
startedAt: "2026-01-22T10:00:00.000Z"
updatedAt: "2026-01-22T10:00:00.000Z"
phase: exploring
history: []
aiContext: ""
`;
      await writeFile(join(stateDir, 'state.yaml'), yaml);

      const result = await loadState(testDir);

      expect(result).not.toBeNull();
      expect(result!.state).toEqual(state);
      expect(result!.statePath).toBe(join(testDir, 'lisa', 'state.yaml'));
    });

    it('loads state with history', async () => {
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });

      const yaml = `version: 1
feature: Test feature
provider: claude
firstPrinciples: false
contextFiles: []
startedAt: "2026-01-22T10:00:00.000Z"
updatedAt: "2026-01-22T10:00:00.000Z"
phase: questioning
history:
  - question: "What is the main goal?"
    answer: "Build a CLI tool"
    timestamp: "2026-01-22T10:01:00.000Z"
aiContext: "User wants to build a CLI tool"
`;
      await writeFile(join(stateDir, 'state.yaml'), yaml);

      const result = await loadState(testDir);

      expect(result!.state.history).toHaveLength(1);
      expect(result!.state.history[0].question).toBe('What is the main goal?');
      expect(result!.state.aiContext).toBe('User wants to build a CLI tool');
    });

    it('throws on corrupted yaml', async () => {
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'state.yaml'), 'this is not: valid: yaml: [');

      await expect(loadState(testDir)).rejects.toThrow('Corrupted state file (invalid YAML)');
    });

    it('throws on invalid state data', async () => {
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'state.yaml'), 'version: 1\nfeature: ""\n');

      await expect(loadState(testDir)).rejects.toThrow('Corrupted state file (invalid data)');
    });
  });

  describe('saveState', () => {
    it('saves valid state to disk', async () => {
      const state = createValidState();

      const path = await saveState(state, testDir);

      expect(path).toBe(join(testDir, 'lisa', 'state.yaml'));
      const content = await readFile(path, 'utf-8');
      expect(content).toContain('feature: Test feature');
      expect(content).toContain('provider: claude');
    });

    it('creates directory if not exists', async () => {
      const state = createValidState();

      await saveState(state, join(testDir, 'new-project'));

      const content = await readFile(join(testDir, 'new-project', 'lisa', 'state.yaml'), 'utf-8');
      expect(content).toContain('feature: Test feature');
    });

    it('updates updatedAt timestamp', async () => {
      const state = createValidState();
      state.updatedAt = '2020-01-01T00:00:00.000Z';

      await saveState(state, testDir);

      const content = await readFile(join(testDir, 'lisa', 'state.yaml'), 'utf-8');
      expect(content).not.toContain('2020-01-01');
    });

    it('throws on invalid state', async () => {
      const invalidState = createValidState();
      (invalidState as Record<string, unknown>).provider = 'invalid';

      await expect(saveState(invalidState, testDir)).rejects.toThrow('Cannot save invalid state');
    });

    it('includes helpful header', async () => {
      const state = createValidState();

      await saveState(state, testDir);

      const content = await readFile(join(testDir, 'lisa', 'state.yaml'), 'utf-8');
      expect(content).toContain('# Lisa Interview State');
      expect(content).toContain('DO NOT edit manually');
    });
  });

  describe('clearState', () => {
    it('returns false when no state exists', async () => {
      const result = await clearState(testDir);
      expect(result).toBe(false);
    });

    it('deletes state file and returns true', async () => {
      const stateDir = join(testDir, 'lisa');
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, 'state.yaml'), 'version: 1');

      const result = await clearState(testDir);

      expect(result).toBe(true);
      expect(await hasState(testDir)).toBe(false);
    });
  });

  describe('addToHistory', () => {
    it('adds question-answer pair to history', () => {
      const state = createValidState();

      const updated = addToHistory(state, 'What is the goal?', 'Build a CLI tool');

      expect(updated.history).toHaveLength(1);
      expect(updated.history[0].question).toBe('What is the goal?');
      expect(updated.history[0].answer).toBe('Build a CLI tool');
    });

    it('sets timestamp on new entry', () => {
      const state = createValidState();
      const before = new Date().toISOString();

      const updated = addToHistory(state, 'Q?', 'A');

      const after = new Date().toISOString();
      expect(updated.history[0].timestamp >= before).toBe(true);
      expect(updated.history[0].timestamp <= after).toBe(true);
    });

    it('preserves existing history', () => {
      const state = createValidState();
      state.history = [
        { question: 'First Q?', answer: 'First A', timestamp: '2026-01-22T10:00:00.000Z' },
      ];

      const updated = addToHistory(state, 'Second Q?', 'Second A');

      expect(updated.history).toHaveLength(2);
      expect(updated.history[0].question).toBe('First Q?');
      expect(updated.history[1].question).toBe('Second Q?');
    });

    it('does not mutate original state', () => {
      const state = createValidState();
      const originalLength = state.history.length;

      addToHistory(state, 'Q?', 'A');

      expect(state.history.length).toBe(originalLength);
    });
  });

  describe('updatePhase', () => {
    it('updates phase', () => {
      const state = createValidState();

      const updated = updatePhase(state, 'questioning');

      expect(updated.phase).toBe('questioning');
    });

    it('does not mutate original state', () => {
      const state = createValidState();

      updatePhase(state, 'generating');

      expect(state.phase).toBe('exploring');
    });
  });

  describe('updateAIContext', () => {
    it('updates AI context', () => {
      const state = createValidState();

      const updated = updateAIContext(state, 'New context information');

      expect(updated.aiContext).toBe('New context information');
    });

    it('does not mutate original state', () => {
      const state = createValidState();

      updateAIContext(state, 'New context');

      expect(state.aiContext).toBe('');
    });
  });
});
