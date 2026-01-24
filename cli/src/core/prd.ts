/**
 * PRD (Product Requirements Document) Generator
 * Generates markdown and JSON PRD files from interview results
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ParsedAIResponse } from './orchestrator.js';

/**
 * User story structure from interview completion
 */
export interface UserStory {
  /** Title of the user story */
  title: string;
  /** Description in "As a [user], I want [goal] so that [benefit]" format */
  description: string;
  /** List of acceptance criteria */
  acceptanceCriteria: string[];
}

/**
 * PRD data structure from interview completion
 */
export interface PRDData {
  /** High-level overview of the feature */
  overview: string;
  /** User stories with acceptance criteria */
  userStories: UserStory[];
  /** Technical considerations and notes */
  technicalNotes: string;
}

/**
 * Options for PRD generation
 */
export interface PRDGeneratorOptions {
  /** Base directory for output (defaults to cwd) */
  baseDir?: string;
  /** Output directory relative to baseDir (defaults to ./lisa) */
  outputDir?: string;
  /** Feature name/description for the header */
  featureName?: string;
}

/**
 * Result from PRD generation
 */
export interface PRDGenerationResult {
  /** Whether generation was successful */
  success: boolean;
  /** Path to the generated markdown file */
  markdownPath?: string;
  /** Path to the generated JSON file */
  jsonPath?: string;
  /** Error message if generation failed */
  error?: string;
}

/**
 * JSON schema for PRD output
 * This is the structure written to the JSON file
 */
export interface PRDJsonSchema {
  /** Schema version for future compatibility */
  $schema: string;
  /** Schema version number */
  version: string;
  /** Metadata about the PRD */
  metadata: {
    /** Slug identifier for the PRD */
    slug: string;
    /** Feature name/title */
    title: string;
    /** Generation timestamp in ISO 8601 format */
    generatedAt: string;
    /** Generator identifier */
    generator: string;
  };
  /** High-level overview of the feature */
  overview: string;
  /** User stories with structured acceptance criteria */
  userStories: Array<{
    /** Unique identifier for the story (1-based index) */
    id: number;
    /** Title of the user story */
    title: string;
    /** Description in "As a [user], I want [goal] so that [benefit]" format */
    description: string;
    /** List of acceptance criteria with completion status */
    acceptanceCriteria: Array<{
      /** Unique identifier for the criterion within the story */
      id: number;
      /** The acceptance criterion text */
      text: string;
      /** Whether the criterion has been completed */
      completed: boolean;
    }>;
  }>;
  /** Technical considerations and notes */
  technicalNotes: string;
}

/**
 * Validate PRD data structure
 * Returns array of validation errors (empty if valid)
 */
export function validatePRDData(data: unknown): string[] {
  const errors: string[] = [];

  if (data === null || typeof data !== 'object') {
    errors.push('PRD data must be an object');
    return errors;
  }

  const prd = data as Record<string, unknown>;

  // Validate overview
  if (prd.overview === undefined) {
    errors.push('overview is required');
  } else if (typeof prd.overview !== 'string') {
    errors.push('overview must be a string');
  } else if (prd.overview.length === 0) {
    errors.push('overview cannot be empty');
  }

  // Validate userStories
  if (prd.userStories === undefined) {
    errors.push('userStories is required');
  } else if (!Array.isArray(prd.userStories)) {
    errors.push('userStories must be an array');
  } else {
    prd.userStories.forEach((story, index) => {
      const storyErrors = validateUserStory(story, index);
      errors.push(...storyErrors);
    });
  }

  // Validate technicalNotes
  if (prd.technicalNotes === undefined) {
    errors.push('technicalNotes is required');
  } else if (typeof prd.technicalNotes !== 'string') {
    errors.push('technicalNotes must be a string');
  }

  return errors;
}

/**
 * Validate a single user story
 */
function validateUserStory(story: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `userStories[${index}]`;

  if (story === null || typeof story !== 'object') {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  const s = story as Record<string, unknown>;

  if (typeof s.title !== 'string' || s.title.length === 0) {
    errors.push(`${prefix}.title must be a non-empty string`);
  }

  if (typeof s.description !== 'string' || s.description.length === 0) {
    errors.push(`${prefix}.description must be a non-empty string`);
  }

  if (!Array.isArray(s.acceptanceCriteria)) {
    errors.push(`${prefix}.acceptanceCriteria must be an array`);
  } else {
    s.acceptanceCriteria.forEach((criterion, i) => {
      if (typeof criterion !== 'string' || criterion.length === 0) {
        errors.push(`${prefix}.acceptanceCriteria[${i}] must be a non-empty string`);
      }
    });
  }

  return errors;
}

/**
 * Validate slug format
 * Slug must be lowercase, use hyphens, and be filesystem-safe
 */
export function validateSlug(slug: unknown): string[] {
  const errors: string[] = [];

  if (typeof slug !== 'string') {
    errors.push('slug must be a string');
    return errors;
  }

  if (slug.length === 0) {
    errors.push('slug cannot be empty');
  }

  if (slug.length > 100) {
    errors.push('slug cannot exceed 100 characters');
  }

  // Check for valid characters (lowercase letters, numbers, hyphens)
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
    errors.push('slug must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen');
  }

  // Check for consecutive hyphens
  if (/--/.test(slug)) {
    errors.push('slug cannot contain consecutive hyphens');
  }

  // Check for reserved names
  const reserved = ['con', 'prn', 'aux', 'nul', 'com1', 'lpt1'];
  if (reserved.includes(slug.toLowerCase())) {
    errors.push('slug cannot be a reserved filename');
  }

  return errors;
}

/**
 * Normalize a slug to ensure it's valid
 * Converts invalid characters and ensures proper format
 */
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace invalid chars with hyphens
    .replace(/^-+|-+$/g, '')     // Remove leading/trailing hyphens
    .replace(/-+/g, '-')         // Collapse consecutive hyphens
    .slice(0, 100);              // Enforce max length
}

/**
 * Format a user story as markdown
 */
export function formatUserStory(story: UserStory, index: number): string {
  const lines: string[] = [];

  lines.push(`### ${index + 1}. ${story.title}`);
  lines.push('');
  lines.push(story.description);
  lines.push('');

  if (story.acceptanceCriteria.length > 0) {
    lines.push('**Acceptance Criteria:**');
    lines.push('');
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate markdown content from PRD data
 */
export function generateMarkdown(prd: PRDData, slug: string, featureName?: string): string {
  const lines: string[] = [];
  const title = featureName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Header
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Generated by Lisa CLI on ${new Date().toISOString().split('T')[0]}`);
  lines.push('');

  // Overview section
  lines.push('## Overview');
  lines.push('');
  lines.push(prd.overview);
  lines.push('');

  // User Stories section
  lines.push('## User Stories');
  lines.push('');
  for (let i = 0; i < prd.userStories.length; i++) {
    lines.push(formatUserStory(prd.userStories[i], i));
    if (i < prd.userStories.length - 1) {
      lines.push('');
    }
  }
  lines.push('');

  // Technical Notes section
  lines.push('## Technical Notes');
  lines.push('');
  lines.push(prd.technicalNotes);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate JSON content from PRD data
 * Creates a structured JSON document that mirrors the markdown content
 */
export function generateJSON(prd: PRDData, slug: string, featureName?: string): PRDJsonSchema {
  const title = featureName || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    $schema: 'https://lisa-cli.dev/schemas/prd-v1.json',
    version: '1.0.0',
    metadata: {
      slug,
      title,
      generatedAt: new Date().toISOString(),
      generator: 'lisa-cli',
    },
    overview: prd.overview,
    userStories: prd.userStories.map((story, index) => ({
      id: index + 1,
      title: story.title,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria.map((criterion, criterionIndex) => ({
        id: criterionIndex + 1,
        text: criterion,
        completed: false,
      })),
    })),
    technicalNotes: prd.technicalNotes,
  };
}

/**
 * Validate JSON against the PRD JSON schema
 * Returns array of validation errors (empty if valid)
 */
export function validatePRDJson(json: unknown): string[] {
  const errors: string[] = [];

  if (json === null || typeof json !== 'object') {
    errors.push('JSON must be an object');
    return errors;
  }

  const data = json as Record<string, unknown>;

  // Validate $schema
  if (typeof data.$schema !== 'string') {
    errors.push('$schema must be a string');
  }

  // Validate version
  if (typeof data.version !== 'string') {
    errors.push('version must be a string');
  }

  // Validate metadata
  if (data.metadata === null || typeof data.metadata !== 'object') {
    errors.push('metadata must be an object');
  } else {
    const metadata = data.metadata as Record<string, unknown>;
    if (typeof metadata.slug !== 'string') {
      errors.push('metadata.slug must be a string');
    }
    if (typeof metadata.title !== 'string') {
      errors.push('metadata.title must be a string');
    }
    if (typeof metadata.generatedAt !== 'string') {
      errors.push('metadata.generatedAt must be a string');
    }
    if (typeof metadata.generator !== 'string') {
      errors.push('metadata.generator must be a string');
    }
  }

  // Validate overview
  if (typeof data.overview !== 'string') {
    errors.push('overview must be a string');
  }

  // Validate userStories
  if (!Array.isArray(data.userStories)) {
    errors.push('userStories must be an array');
  } else {
    data.userStories.forEach((story: unknown, index: number) => {
      if (story === null || typeof story !== 'object') {
        errors.push(`userStories[${index}] must be an object`);
        return;
      }
      const s = story as Record<string, unknown>;
      if (typeof s.id !== 'number') {
        errors.push(`userStories[${index}].id must be a number`);
      }
      if (typeof s.title !== 'string') {
        errors.push(`userStories[${index}].title must be a string`);
      }
      if (typeof s.description !== 'string') {
        errors.push(`userStories[${index}].description must be a string`);
      }
      if (!Array.isArray(s.acceptanceCriteria)) {
        errors.push(`userStories[${index}].acceptanceCriteria must be an array`);
      } else {
        (s.acceptanceCriteria as unknown[]).forEach((criterion: unknown, cIndex: number) => {
          if (criterion === null || typeof criterion !== 'object') {
            errors.push(`userStories[${index}].acceptanceCriteria[${cIndex}] must be an object`);
            return;
          }
          const c = criterion as Record<string, unknown>;
          if (typeof c.id !== 'number') {
            errors.push(`userStories[${index}].acceptanceCriteria[${cIndex}].id must be a number`);
          }
          if (typeof c.text !== 'string') {
            errors.push(`userStories[${index}].acceptanceCriteria[${cIndex}].text must be a string`);
          }
          if (typeof c.completed !== 'boolean') {
            errors.push(`userStories[${index}].acceptanceCriteria[${cIndex}].completed must be a boolean`);
          }
        });
      }
    });
  }

  // Validate technicalNotes
  if (typeof data.technicalNotes !== 'string') {
    errors.push('technicalNotes must be a string');
  }

  return errors;
}

/**
 * Get the output path for a PRD file
 */
export function getPRDPath(slug: string, extension: 'md' | 'json', options: PRDGeneratorOptions = {}): string {
  const baseDir = options.baseDir || process.cwd();
  const outputDir = options.outputDir || 'lisa';
  return join(baseDir, outputDir, `${slug}.${extension}`);
}

/**
 * Write PRD markdown file to disk
 */
export async function writePRDMarkdown(
  prd: PRDData,
  slug: string,
  options: PRDGeneratorOptions = {}
): Promise<PRDGenerationResult> {
  // Validate inputs
  const slugErrors = validateSlug(slug);
  if (slugErrors.length > 0) {
    return {
      success: false,
      error: `Invalid slug: ${slugErrors.join(', ')}`,
    };
  }

  const prdErrors = validatePRDData(prd);
  if (prdErrors.length > 0) {
    return {
      success: false,
      error: `Invalid PRD data: ${prdErrors.join(', ')}`,
    };
  }

  // Generate markdown content
  const markdown = generateMarkdown(prd, slug, options.featureName);

  // Get output path
  const outputPath = getPRDPath(slug, 'md', options);

  // Ensure directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Write file
  await writeFile(outputPath, markdown, 'utf-8');

  return {
    success: true,
    markdownPath: outputPath,
  };
}

/**
 * Write PRD JSON file to disk
 */
export async function writePRDJSON(
  prd: PRDData,
  slug: string,
  options: PRDGeneratorOptions = {}
): Promise<PRDGenerationResult> {
  // Validate inputs
  const slugErrors = validateSlug(slug);
  if (slugErrors.length > 0) {
    return {
      success: false,
      error: `Invalid slug: ${slugErrors.join(', ')}`,
    };
  }

  const prdErrors = validatePRDData(prd);
  if (prdErrors.length > 0) {
    return {
      success: false,
      error: `Invalid PRD data: ${prdErrors.join(', ')}`,
    };
  }

  // Generate JSON content
  const json = generateJSON(prd, slug, options.featureName);

  // Validate generated JSON against schema
  const jsonErrors = validatePRDJson(json);
  if (jsonErrors.length > 0) {
    return {
      success: false,
      error: `Generated JSON validation failed: ${jsonErrors.join(', ')}`,
    };
  }

  // Get output path
  const outputPath = getPRDPath(slug, 'json', options);

  // Ensure directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Write file with pretty formatting
  await writeFile(outputPath, JSON.stringify(json, null, 2), 'utf-8');

  return {
    success: true,
    jsonPath: outputPath,
  };
}

/**
 * Write both PRD markdown and JSON files to disk
 */
export async function writePRDBoth(
  prd: PRDData,
  slug: string,
  options: PRDGeneratorOptions = {}
): Promise<PRDGenerationResult> {
  // Validate inputs once
  const slugErrors = validateSlug(slug);
  if (slugErrors.length > 0) {
    return {
      success: false,
      error: `Invalid slug: ${slugErrors.join(', ')}`,
    };
  }

  const prdErrors = validatePRDData(prd);
  if (prdErrors.length > 0) {
    return {
      success: false,
      error: `Invalid PRD data: ${prdErrors.join(', ')}`,
    };
  }

  // Write markdown
  const markdownResult = await writePRDMarkdown(prd, slug, options);
  if (!markdownResult.success) {
    return markdownResult;
  }

  // Write JSON
  const jsonResult = await writePRDJSON(prd, slug, options);
  if (!jsonResult.success) {
    return jsonResult;
  }

  return {
    success: true,
    markdownPath: markdownResult.markdownPath,
    jsonPath: jsonResult.jsonPath,
  };
}

/**
 * Generate PRD from interview completion result
 * Convenience function that extracts PRD data from ParsedAIResponse
 * Generates both markdown and JSON files
 */
export async function generatePRDFromCompletion(
  slug: string,
  prd: ParsedAIResponse['prd'],
  options: PRDGeneratorOptions = {}
): Promise<PRDGenerationResult> {
  if (!prd) {
    return {
      success: false,
      error: 'No PRD data provided',
    };
  }

  return writePRDBoth(prd as PRDData, slug, options);
}
