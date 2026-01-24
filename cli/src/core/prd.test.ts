/**
 * Tests for PRD (Product Requirements Document) Generator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validatePRDData,
  validateSlug,
  normalizeSlug,
  formatUserStory,
  generateMarkdown,
  generateJSON,
  validatePRDJson,
  getPRDPath,
  writePRDMarkdown,
  writePRDJSON,
  writePRDBoth,
  generatePRDFromCompletion,
  type PRDData,
  type UserStory,
  type PRDJsonSchema,
} from './prd.js';

describe('PRD Generator', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lisa-prd-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Valid test data fixtures
  const validUserStory: UserStory = {
    title: 'User Authentication',
    description: 'As a user, I want to log in so that I can access my account',
    acceptanceCriteria: [
      'User can enter email and password',
      'Invalid credentials show error message',
      'Successful login redirects to dashboard',
    ],
  };

  const validPRD: PRDData = {
    overview: 'This feature adds user authentication to the application.',
    userStories: [validUserStory],
    technicalNotes: 'Use JWT tokens for session management. Store refresh tokens securely.',
  };

  describe('validatePRDData', () => {
    it('returns empty array for valid PRD data', () => {
      const errors = validatePRDData(validPRD);
      expect(errors).toEqual([]);
    });

    it('returns error for null data', () => {
      const errors = validatePRDData(null);
      expect(errors).toContain('PRD data must be an object');
    });

    it('returns error for non-object data', () => {
      const errors = validatePRDData('not an object');
      expect(errors).toContain('PRD data must be an object');
    });

    it('returns error for missing overview', () => {
      const errors = validatePRDData({
        userStories: [],
        technicalNotes: 'notes',
      });
      expect(errors).toContain('overview is required');
    });

    it('returns error for non-string overview', () => {
      const errors = validatePRDData({
        overview: 123,
        userStories: [],
        technicalNotes: 'notes',
      });
      expect(errors).toContain('overview must be a string');
    });

    it('returns error for empty overview', () => {
      const errors = validatePRDData({
        overview: '',
        userStories: [],
        technicalNotes: 'notes',
      });
      expect(errors).toContain('overview cannot be empty');
    });

    it('returns error for missing userStories', () => {
      const errors = validatePRDData({
        overview: 'overview',
        technicalNotes: 'notes',
      });
      expect(errors).toContain('userStories is required');
    });

    it('returns error for non-array userStories', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: 'not an array',
        technicalNotes: 'notes',
      });
      expect(errors).toContain('userStories must be an array');
    });

    it('returns error for missing technicalNotes', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [],
      });
      expect(errors).toContain('technicalNotes is required');
    });

    it('returns error for non-string technicalNotes', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [],
        technicalNotes: 123,
      });
      expect(errors).toContain('technicalNotes must be a string');
    });

    it('validates user story structure', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [{ invalid: 'story' }],
        technicalNotes: 'notes',
      });
      expect(errors.some((e) => e.includes('userStories[0].title'))).toBe(true);
    });

    it('validates multiple user stories', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [
          validUserStory,
          { title: '', description: 'desc', acceptanceCriteria: [] },
        ],
        technicalNotes: 'notes',
      });
      expect(errors.some((e) => e.includes('userStories[1].title'))).toBe(true);
    });

    it('validates user story with non-array acceptanceCriteria', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [
          { title: 'Test', description: 'desc', acceptanceCriteria: 'not array' },
        ],
        technicalNotes: 'notes',
      });
      expect(errors).toContain('userStories[0].acceptanceCriteria must be an array');
    });

    it('validates empty acceptance criteria strings', () => {
      const errors = validatePRDData({
        overview: 'overview',
        userStories: [
          { title: 'Test', description: 'desc', acceptanceCriteria: ['valid', ''] },
        ],
        technicalNotes: 'notes',
      });
      expect(errors).toContain('userStories[0].acceptanceCriteria[1] must be a non-empty string');
    });

    it('returns multiple errors at once', () => {
      const errors = validatePRDData({
        overview: '',
        userStories: 'invalid',
        technicalNotes: 123,
      });
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe('validateSlug', () => {
    it('returns empty array for valid slug', () => {
      expect(validateSlug('my-feature')).toEqual([]);
    });

    it('returns empty array for single character slug', () => {
      expect(validateSlug('a')).toEqual([]);
    });

    it('returns empty array for slug with numbers', () => {
      expect(validateSlug('feature-v2')).toEqual([]);
    });

    it('returns error for non-string slug', () => {
      const errors = validateSlug(123);
      expect(errors).toContain('slug must be a string');
    });

    it('returns error for empty slug', () => {
      const errors = validateSlug('');
      expect(errors).toContain('slug cannot be empty');
    });

    it('returns error for slug over 100 characters', () => {
      const longSlug = 'a'.repeat(101);
      const errors = validateSlug(longSlug);
      expect(errors).toContain('slug cannot exceed 100 characters');
    });

    it('returns error for uppercase letters', () => {
      const errors = validateSlug('MyFeature');
      expect(errors.some((e) => e.includes('lowercase'))).toBe(true);
    });

    it('returns error for spaces', () => {
      const errors = validateSlug('my feature');
      expect(errors.some((e) => e.includes('lowercase'))).toBe(true);
    });

    it('returns error for special characters', () => {
      const errors = validateSlug('my_feature!');
      expect(errors.some((e) => e.includes('lowercase'))).toBe(true);
    });

    it('returns error for leading hyphen', () => {
      const errors = validateSlug('-my-feature');
      expect(errors.some((e) => e.includes('start or end with a hyphen'))).toBe(true);
    });

    it('returns error for trailing hyphen', () => {
      const errors = validateSlug('my-feature-');
      expect(errors.some((e) => e.includes('start or end with a hyphen'))).toBe(true);
    });

    it('returns error for consecutive hyphens', () => {
      const errors = validateSlug('my--feature');
      expect(errors).toContain('slug cannot contain consecutive hyphens');
    });

    it('returns error for reserved names', () => {
      expect(validateSlug('con')).toContain('slug cannot be a reserved filename');
      expect(validateSlug('prn')).toContain('slug cannot be a reserved filename');
      expect(validateSlug('aux')).toContain('slug cannot be a reserved filename');
      expect(validateSlug('nul')).toContain('slug cannot be a reserved filename');
    });
  });

  describe('normalizeSlug', () => {
    it('converts to lowercase', () => {
      expect(normalizeSlug('MyFeature')).toBe('myfeature');
    });

    it('replaces spaces with hyphens', () => {
      expect(normalizeSlug('my feature')).toBe('my-feature');
    });

    it('replaces special characters with hyphens', () => {
      expect(normalizeSlug('my_feature!')).toBe('my-feature');
    });

    it('removes leading and trailing hyphens', () => {
      expect(normalizeSlug('--my-feature--')).toBe('my-feature');
    });

    it('collapses consecutive hyphens', () => {
      expect(normalizeSlug('my---feature')).toBe('my-feature');
    });

    it('trims whitespace', () => {
      expect(normalizeSlug('  my feature  ')).toBe('my-feature');
    });

    it('truncates to 100 characters', () => {
      const longInput = 'a'.repeat(150);
      expect(normalizeSlug(longInput).length).toBe(100);
    });

    it('handles complex input', () => {
      expect(normalizeSlug('  My AWESOME Feature! v2.0  ')).toBe('my-awesome-feature-v2-0');
    });

    it('handles empty input', () => {
      expect(normalizeSlug('')).toBe('');
    });
  });

  describe('formatUserStory', () => {
    it('formats user story with title and description', () => {
      const result = formatUserStory(validUserStory, 0);
      expect(result).toContain('### 1. User Authentication');
      expect(result).toContain('As a user, I want to log in so that I can access my account');
    });

    it('includes acceptance criteria as checkboxes', () => {
      const result = formatUserStory(validUserStory, 0);
      expect(result).toContain('**Acceptance Criteria:**');
      expect(result).toContain('- [ ] User can enter email and password');
      expect(result).toContain('- [ ] Invalid credentials show error message');
      expect(result).toContain('- [ ] Successful login redirects to dashboard');
    });

    it('uses 1-based index for numbering', () => {
      const result = formatUserStory(validUserStory, 2);
      expect(result).toContain('### 3. User Authentication');
    });

    it('handles empty acceptance criteria', () => {
      const story: UserStory = {
        title: 'Test Story',
        description: 'Test description',
        acceptanceCriteria: [],
      };
      const result = formatUserStory(story, 0);
      expect(result).not.toContain('**Acceptance Criteria:**');
    });
  });

  describe('generateMarkdown', () => {
    it('generates complete markdown document', () => {
      const markdown = generateMarkdown(validPRD, 'user-auth');
      expect(markdown).toContain('# User Auth');
      expect(markdown).toContain('## Overview');
      expect(markdown).toContain('## User Stories');
      expect(markdown).toContain('## Technical Notes');
    });

    it('includes generation date', () => {
      const markdown = generateMarkdown(validPRD, 'user-auth');
      const today = new Date().toISOString().split('T')[0];
      expect(markdown).toContain(`Generated by Lisa CLI on ${today}`);
    });

    it('uses feature name when provided', () => {
      const markdown = generateMarkdown(validPRD, 'user-auth', 'User Authentication System');
      expect(markdown).toContain('# User Authentication System');
    });

    it('generates title from slug when no feature name', () => {
      const markdown = generateMarkdown(validPRD, 'my-awesome-feature');
      expect(markdown).toContain('# My Awesome Feature');
    });

    it('includes overview content', () => {
      const markdown = generateMarkdown(validPRD, 'test');
      expect(markdown).toContain('This feature adds user authentication to the application.');
    });

    it('includes all user stories', () => {
      const prd: PRDData = {
        overview: 'overview',
        userStories: [
          { title: 'Story 1', description: 'Desc 1', acceptanceCriteria: ['AC 1'] },
          { title: 'Story 2', description: 'Desc 2', acceptanceCriteria: ['AC 2'] },
        ],
        technicalNotes: 'notes',
      };
      const markdown = generateMarkdown(prd, 'test');
      expect(markdown).toContain('### 1. Story 1');
      expect(markdown).toContain('### 2. Story 2');
    });

    it('includes technical notes content', () => {
      const markdown = generateMarkdown(validPRD, 'test');
      expect(markdown).toContain('Use JWT tokens for session management');
    });
  });

  describe('getPRDPath', () => {
    it('returns default path with no options', () => {
      const originalCwd = process.cwd();
      vi.spyOn(process, 'cwd').mockReturnValue('/project');

      const path = getPRDPath('my-feature', 'md');
      expect(path).toBe(join('/project', 'lisa', 'my-feature.md'));

      vi.spyOn(process, 'cwd').mockReturnValue(originalCwd);
    });

    it('respects baseDir option', () => {
      const path = getPRDPath('my-feature', 'md', { baseDir: '/custom' });
      expect(path).toBe(join('/custom', 'lisa', 'my-feature.md'));
    });

    it('respects outputDir option', () => {
      const path = getPRDPath('my-feature', 'md', { baseDir: '/project', outputDir: 'output' });
      expect(path).toBe(join('/project', 'output', 'my-feature.md'));
    });

    it('generates json extension', () => {
      const path = getPRDPath('my-feature', 'json', { baseDir: '/project' });
      expect(path).toBe(join('/project', 'lisa', 'my-feature.json'));
    });
  });

  describe('writePRDMarkdown', () => {
    it('writes markdown file to disk', async () => {
      const result = await writePRDMarkdown(validPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBe(join(testDir, 'lisa', 'test-feature.md'));

      const content = await readFile(result.markdownPath!, 'utf-8');
      expect(content).toContain('# Test Feature');
      expect(content).toContain('## Overview');
    });

    it('creates output directory if not exists', async () => {
      const result = await writePRDMarkdown(validPRD, 'test-feature', {
        baseDir: testDir,
        outputDir: 'deep/nested/output',
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBe(join(testDir, 'deep/nested/output', 'test-feature.md'));
    });

    it('includes feature name in header when provided', async () => {
      const result = await writePRDMarkdown(validPRD, 'test-feature', {
        baseDir: testDir,
        featureName: 'My Custom Feature Name',
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.markdownPath!, 'utf-8');
      expect(content).toContain('# My Custom Feature Name');
    });

    it('returns error for invalid slug', async () => {
      const result = await writePRDMarkdown(validPRD, 'INVALID SLUG!', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid slug');
    });

    it('returns error for invalid PRD data', async () => {
      const invalidPRD = { overview: '' } as PRDData;
      const result = await writePRDMarkdown(invalidPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PRD data');
    });

    it('handles complex PRD with multiple stories', async () => {
      const complexPRD: PRDData = {
        overview: 'A complex feature with multiple user stories.',
        userStories: [
          {
            title: 'First Story',
            description: 'As a user, I want feature A',
            acceptanceCriteria: ['AC 1.1', 'AC 1.2'],
          },
          {
            title: 'Second Story',
            description: 'As a user, I want feature B',
            acceptanceCriteria: ['AC 2.1', 'AC 2.2', 'AC 2.3'],
          },
          {
            title: 'Third Story',
            description: 'As a user, I want feature C',
            acceptanceCriteria: ['AC 3.1'],
          },
        ],
        technicalNotes: 'Complex technical notes with **markdown** formatting.',
      };

      const result = await writePRDMarkdown(complexPRD, 'complex-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.markdownPath!, 'utf-8');
      expect(content).toContain('### 1. First Story');
      expect(content).toContain('### 2. Second Story');
      expect(content).toContain('### 3. Third Story');
      expect(content).toContain('- [ ] AC 1.1');
      expect(content).toContain('- [ ] AC 2.3');
    });
  });

  describe('generatePRDFromCompletion', () => {
    it('generates both markdown and JSON from completion data', async () => {
      const result = await generatePRDFromCompletion('test-feature', validPRD, {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toContain('test-feature.md');
      expect(result.jsonPath).toContain('test-feature.json');
    });

    it('returns error when no PRD data provided', async () => {
      const result = await generatePRDFromCompletion('test-feature', undefined, {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No PRD data provided');
    });

    it('passes through options to writePRDBoth', async () => {
      const result = await generatePRDFromCompletion('test-feature', validPRD, {
        baseDir: testDir,
        outputDir: 'custom-output',
        featureName: 'Custom Name',
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBe(join(testDir, 'custom-output', 'test-feature.md'));
      expect(result.jsonPath).toBe(join(testDir, 'custom-output', 'test-feature.json'));

      const mdContent = await readFile(result.markdownPath!, 'utf-8');
      expect(mdContent).toContain('# Custom Name');

      const jsonContent = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(jsonContent);
      expect(json.metadata.title).toBe('Custom Name');
    });
  });

  describe('generateJSON', () => {
    it('generates complete JSON structure', () => {
      const json = generateJSON(validPRD, 'user-auth');

      expect(json.$schema).toBe('https://lisa-cli.dev/schemas/prd-v1.json');
      expect(json.version).toBe('1.0.0');
      expect(json.metadata.slug).toBe('user-auth');
      expect(json.metadata.generator).toBe('lisa-cli');
      expect(json.overview).toBe(validPRD.overview);
      expect(json.technicalNotes).toBe(validPRD.technicalNotes);
    });

    it('includes generation timestamp', () => {
      const before = new Date().toISOString();
      const json = generateJSON(validPRD, 'user-auth');
      const after = new Date().toISOString();

      expect(json.metadata.generatedAt >= before).toBe(true);
      expect(json.metadata.generatedAt <= after).toBe(true);
    });

    it('uses feature name when provided', () => {
      const json = generateJSON(validPRD, 'user-auth', 'User Authentication System');
      expect(json.metadata.title).toBe('User Authentication System');
    });

    it('generates title from slug when no feature name', () => {
      const json = generateJSON(validPRD, 'my-awesome-feature');
      expect(json.metadata.title).toBe('My Awesome Feature');
    });

    it('transforms user stories with 1-based IDs', () => {
      const json = generateJSON(validPRD, 'test');

      expect(json.userStories.length).toBe(1);
      expect(json.userStories[0].id).toBe(1);
      expect(json.userStories[0].title).toBe('User Authentication');
      expect(json.userStories[0].description).toBe(validUserStory.description);
    });

    it('transforms acceptance criteria with structured format', () => {
      const json = generateJSON(validPRD, 'test');

      const criteria = json.userStories[0].acceptanceCriteria;
      expect(criteria.length).toBe(3);
      expect(criteria[0]).toEqual({ id: 1, text: 'User can enter email and password', completed: false });
      expect(criteria[1]).toEqual({ id: 2, text: 'Invalid credentials show error message', completed: false });
      expect(criteria[2]).toEqual({ id: 3, text: 'Successful login redirects to dashboard', completed: false });
    });

    it('handles multiple user stories', () => {
      const prd: PRDData = {
        overview: 'overview',
        userStories: [
          { title: 'Story 1', description: 'Desc 1', acceptanceCriteria: ['AC 1'] },
          { title: 'Story 2', description: 'Desc 2', acceptanceCriteria: ['AC 2.1', 'AC 2.2'] },
        ],
        technicalNotes: 'notes',
      };
      const json = generateJSON(prd, 'test');

      expect(json.userStories.length).toBe(2);
      expect(json.userStories[0].id).toBe(1);
      expect(json.userStories[1].id).toBe(2);
      expect(json.userStories[1].acceptanceCriteria.length).toBe(2);
    });

    it('handles empty user stories array', () => {
      const prd: PRDData = {
        overview: 'overview',
        userStories: [],
        technicalNotes: 'notes',
      };
      const json = generateJSON(prd, 'test');

      expect(json.userStories).toEqual([]);
    });
  });

  describe('validatePRDJson', () => {
    it('returns empty array for valid JSON', () => {
      const json = generateJSON(validPRD, 'test');
      const errors = validatePRDJson(json);
      expect(errors).toEqual([]);
    });

    it('returns error for null data', () => {
      const errors = validatePRDJson(null);
      expect(errors).toContain('JSON must be an object');
    });

    it('returns error for non-object data', () => {
      const errors = validatePRDJson('not an object');
      expect(errors).toContain('JSON must be an object');
    });

    it('returns error for missing $schema', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, $schema: 123 };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('$schema must be a string');
    });

    it('returns error for missing version', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, version: null };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('version must be a string');
    });

    it('returns error for missing metadata', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, metadata: null };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('metadata must be an object');
    });

    it('validates metadata fields', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = {
        ...json,
        metadata: { slug: 123, title: 456, generatedAt: null, generator: undefined },
      };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('metadata.slug must be a string');
      expect(errors).toContain('metadata.title must be a string');
      expect(errors).toContain('metadata.generatedAt must be a string');
      expect(errors).toContain('metadata.generator must be a string');
    });

    it('returns error for missing overview', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, overview: 123 };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('overview must be a string');
    });

    it('returns error for non-array userStories', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, userStories: 'not array' };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('userStories must be an array');
    });

    it('validates user story structure', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = {
        ...json,
        userStories: [{ id: 'not a number', title: 123, description: null, acceptanceCriteria: 'not array' }],
      };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('userStories[0].id must be a number');
      expect(errors).toContain('userStories[0].title must be a string');
      expect(errors).toContain('userStories[0].description must be a string');
      expect(errors).toContain('userStories[0].acceptanceCriteria must be an array');
    });

    it('validates acceptance criteria structure', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = {
        ...json,
        userStories: [{
          id: 1,
          title: 'Test',
          description: 'desc',
          acceptanceCriteria: [{ id: 'bad', text: 123, completed: 'yes' }],
        }],
      };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('userStories[0].acceptanceCriteria[0].id must be a number');
      expect(errors).toContain('userStories[0].acceptanceCriteria[0].text must be a string');
      expect(errors).toContain('userStories[0].acceptanceCriteria[0].completed must be a boolean');
    });

    it('returns error for null user story', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, userStories: [null] };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('userStories[0] must be an object');
    });

    it('returns error for null acceptance criteria', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = {
        ...json,
        userStories: [{ id: 1, title: 'Test', description: 'desc', acceptanceCriteria: [null] }],
      };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('userStories[0].acceptanceCriteria[0] must be an object');
    });

    it('returns error for missing technicalNotes', () => {
      const json = generateJSON(validPRD, 'test');
      const invalidJson = { ...json, technicalNotes: 123 };
      const errors = validatePRDJson(invalidJson);
      expect(errors).toContain('technicalNotes must be a string');
    });

    it('returns multiple errors at once', () => {
      const errors = validatePRDJson({
        $schema: 123,
        version: null,
        metadata: 'invalid',
        overview: 456,
        userStories: 'not array',
        technicalNotes: null,
      });
      expect(errors.length).toBeGreaterThan(4);
    });
  });

  describe('writePRDJSON', () => {
    it('writes JSON file to disk', async () => {
      const result = await writePRDJSON(validPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.jsonPath).toBe(join(testDir, 'lisa', 'test-feature.json'));

      const content = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(content) as PRDJsonSchema;
      expect(json.metadata.slug).toBe('test-feature');
      expect(json.metadata.title).toBe('Test Feature');
      expect(json.overview).toBe(validPRD.overview);
    });

    it('creates output directory if not exists', async () => {
      const result = await writePRDJSON(validPRD, 'test-feature', {
        baseDir: testDir,
        outputDir: 'deep/nested/output',
      });

      expect(result.success).toBe(true);
      expect(result.jsonPath).toBe(join(testDir, 'deep/nested/output', 'test-feature.json'));
    });

    it('includes feature name when provided', async () => {
      const result = await writePRDJSON(validPRD, 'test-feature', {
        baseDir: testDir,
        featureName: 'My Custom Feature Name',
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(content) as PRDJsonSchema;
      expect(json.metadata.title).toBe('My Custom Feature Name');
    });

    it('returns error for invalid slug', async () => {
      const result = await writePRDJSON(validPRD, 'INVALID SLUG!', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid slug');
    });

    it('returns error for invalid PRD data', async () => {
      const invalidPRD = { overview: '' } as PRDData;
      const result = await writePRDJSON(invalidPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PRD data');
    });

    it('writes pretty-formatted JSON', async () => {
      const result = await writePRDJSON(validPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.jsonPath!, 'utf-8');
      // Check for indentation (pretty-printed JSON has newlines and spaces)
      expect(content).toContain('\n');
      expect(content).toContain('  '); // 2-space indentation
    });

    it('validates JSON against schema before writing', async () => {
      const result = await writePRDJSON(validPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(content);

      // Verify schema compliance
      const errors = validatePRDJson(json);
      expect(errors).toEqual([]);
    });

    it('handles complex PRD with multiple stories', async () => {
      const complexPRD: PRDData = {
        overview: 'A complex feature with multiple user stories.',
        userStories: [
          {
            title: 'First Story',
            description: 'As a user, I want feature A',
            acceptanceCriteria: ['AC 1.1', 'AC 1.2'],
          },
          {
            title: 'Second Story',
            description: 'As a user, I want feature B',
            acceptanceCriteria: ['AC 2.1', 'AC 2.2', 'AC 2.3'],
          },
        ],
        technicalNotes: 'Complex technical notes.',
      };

      const result = await writePRDJSON(complexPRD, 'complex-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      const content = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(content) as PRDJsonSchema;

      expect(json.userStories.length).toBe(2);
      expect(json.userStories[0].id).toBe(1);
      expect(json.userStories[0].title).toBe('First Story');
      expect(json.userStories[1].id).toBe(2);
      expect(json.userStories[1].acceptanceCriteria.length).toBe(3);
    });
  });

  describe('writePRDBoth', () => {
    it('writes both markdown and JSON files', async () => {
      const result = await writePRDBoth(validPRD, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBe(join(testDir, 'lisa', 'test-feature.md'));
      expect(result.jsonPath).toBe(join(testDir, 'lisa', 'test-feature.json'));

      // Verify both files exist and have content
      const mdContent = await readFile(result.markdownPath!, 'utf-8');
      expect(mdContent).toContain('# Test Feature');

      const jsonContent = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(jsonContent) as PRDJsonSchema;
      expect(json.metadata.slug).toBe('test-feature');
    });

    it('returns error for invalid slug', async () => {
      const result = await writePRDBoth(validPRD, 'INVALID!', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid slug');
    });

    it('returns error for invalid PRD data', async () => {
      const result = await writePRDBoth({ overview: '' } as PRDData, 'test-feature', {
        baseDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid PRD data');
    });

    it('passes options to both writers', async () => {
      const result = await writePRDBoth(validPRD, 'test-feature', {
        baseDir: testDir,
        outputDir: 'custom',
        featureName: 'Custom Feature',
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toBe(join(testDir, 'custom', 'test-feature.md'));
      expect(result.jsonPath).toBe(join(testDir, 'custom', 'test-feature.json'));

      const mdContent = await readFile(result.markdownPath!, 'utf-8');
      expect(mdContent).toContain('# Custom Feature');

      const jsonContent = await readFile(result.jsonPath!, 'utf-8');
      const json = JSON.parse(jsonContent) as PRDJsonSchema;
      expect(json.metadata.title).toBe('Custom Feature');
    });

    it('creates output directory once for both files', async () => {
      const result = await writePRDBoth(validPRD, 'test-feature', {
        baseDir: testDir,
        outputDir: 'deeply/nested/directory',
      });

      expect(result.success).toBe(true);
      expect(result.markdownPath).toContain('deeply/nested/directory');
      expect(result.jsonPath).toContain('deeply/nested/directory');
    });
  });
});
