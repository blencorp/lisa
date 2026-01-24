/**
 * Configuration management for Lisa CLI
 * Handles loading, saving, and validating configuration from ./lisa/config.yaml
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ProviderName } from '../providers/index.js';

export interface LisaConfig {
  /** Default AI provider to use */
  defaultProvider: ProviderName;
  /** Output directory for generated PRDs (relative to project root) */
  outputDirectory: string;
}

export interface ConfigResult {
  config: LisaConfig;
  /** Whether the config file was auto-created */
  wasCreated: boolean;
  /** Path to the config file */
  configPath: string;
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

const DEFAULT_CONFIG: LisaConfig = {
  defaultProvider: 'claude',
  outputDirectory: './lisa',
};

const VALID_PROVIDERS: ProviderName[] = ['claude', 'opencode', 'cursor', 'codex', 'copilot'];

/**
 * Get the path to the config file
 */
export function getConfigPath(baseDir: string = process.cwd()): string {
  return join(baseDir, 'lisa', 'config.yaml');
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
 * Validate the configuration object
 * Returns an array of validation errors (empty if valid)
 */
export function validateConfig(config: unknown): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (config === null || typeof config !== 'object') {
    errors.push({ field: 'root', message: 'Config must be an object' });
    return errors;
  }

  const cfg = config as Record<string, unknown>;

  // Validate defaultProvider
  if (cfg.defaultProvider === undefined) {
    errors.push({ field: 'defaultProvider', message: 'defaultProvider is required' });
  } else if (typeof cfg.defaultProvider !== 'string') {
    errors.push({ field: 'defaultProvider', message: 'defaultProvider must be a string' });
  } else if (!VALID_PROVIDERS.includes(cfg.defaultProvider as ProviderName)) {
    errors.push({
      field: 'defaultProvider',
      message: `defaultProvider must be one of: ${VALID_PROVIDERS.join(', ')}`,
    });
  }

  // Validate outputDirectory
  if (cfg.outputDirectory === undefined) {
    errors.push({ field: 'outputDirectory', message: 'outputDirectory is required' });
  } else if (typeof cfg.outputDirectory !== 'string') {
    errors.push({ field: 'outputDirectory', message: 'outputDirectory must be a string' });
  } else if (cfg.outputDirectory.length === 0) {
    errors.push({ field: 'outputDirectory', message: 'outputDirectory cannot be empty' });
  }

  return errors;
}

/**
 * Create the default configuration file
 */
export async function createDefaultConfig(configPath: string): Promise<void> {
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });

  const yamlContent = stringify(DEFAULT_CONFIG, {
    lineWidth: 0, // Disable line wrapping
  });

  // Add helpful comments
  const contentWithComments = `# Lisa CLI Configuration
# This file was auto-generated on first run

# Default AI provider to use for interviews
# Options: claude, opencode, cursor, codex, copilot
${yamlContent}`;

  await writeFile(configPath, contentWithComments, 'utf-8');
}

/**
 * Load configuration from disk
 * Creates default config if it doesn't exist
 */
export async function loadConfig(baseDir: string = process.cwd()): Promise<ConfigResult> {
  const configPath = getConfigPath(baseDir);
  let wasCreated = false;

  // Check if config exists, create if not
  if (!(await fileExists(configPath))) {
    await createDefaultConfig(configPath);
    wasCreated = true;
  }

  // Read and parse config
  const content = await readFile(configPath, 'utf-8');
  const parsed = parse(content) as unknown;

  // Validate config
  const errors = validateConfig(parsed);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration in ${configPath}:\n${errorMessages}`);
  }

  return {
    config: parsed as LisaConfig,
    wasCreated,
    configPath,
  };
}

/**
 * Save configuration to disk
 */
export async function saveConfig(config: LisaConfig, baseDir: string = process.cwd()): Promise<void> {
  const configPath = getConfigPath(baseDir);
  const dir = dirname(configPath);

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Validate before saving
  const errors = validateConfig(config);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Cannot save invalid configuration:\n${errorMessages}`);
  }

  const yamlContent = stringify(config, {
    lineWidth: 0,
  });

  // Add helpful comments
  const contentWithComments = `# Lisa CLI Configuration

# Default AI provider to use for interviews
# Options: claude, opencode, cursor, codex, copilot
${yamlContent}`;

  await writeFile(configPath, contentWithComments, 'utf-8');
}

/**
 * Get the default configuration
 */
export function getDefaultConfig(): LisaConfig {
  return { ...DEFAULT_CONFIG };
}
