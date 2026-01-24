/**
 * Context File Loading
 * Loads and formats reference documents for AI context
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Result of loading a single context file
 */
export interface ContextFileResult {
  /** The file path (as provided) */
  filePath: string;
  /** Resolved absolute path */
  absolutePath: string;
  /** File contents (if loaded successfully) */
  content?: string;
  /** Error message (if loading failed) */
  error?: string;
  /** Whether the file was loaded successfully */
  success: boolean;
}

/**
 * Result of loading multiple context files
 */
export interface ContextLoadResult {
  /** Individual file results */
  files: ContextFileResult[];
  /** Successfully loaded files */
  successful: ContextFileResult[];
  /** Failed files */
  failed: ContextFileResult[];
  /** Combined content of all successful files, formatted for AI */
  combinedContent: string;
  /** Whether all files were loaded successfully */
  allSuccessful: boolean;
}

/**
 * Options for loading context files
 */
export interface ContextLoadOptions {
  /** Base directory for resolving relative paths (defaults to cwd) */
  baseDir?: string;
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;
  /** Whether to continue loading if some files fail (default: true) */
  continueOnError?: boolean;
}

/** Default maximum file size: 1MB */
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Supported text file extensions */
export const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.markdown',
  '.txt', '.text',
  '.json', '.yaml', '.yml',
  '.ts', '.tsx', '.js', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java',
  '.html', '.css', '.scss', '.less',
  '.xml', '.toml', '.ini', '.conf',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.gql',
  '.env', '.env.example',
  '.gitignore', '.dockerignore',
  '.eslintrc', '.prettierrc',
]);

/**
 * Check if a file extension is supported
 */
export function isSupportedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // Check extension
  if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
    return true;
  }

  // Check dotfiles without extensions
  if (basename.startsWith('.') && !ext) {
    return SUPPORTED_EXTENSIONS.has(basename);
  }

  // Files without extension might be text files (README, LICENSE, etc.)
  if (!ext) {
    return true;
  }

  return false;
}

/**
 * Resolve a file path to an absolute path
 */
export function resolveFilePath(filePath: string, baseDir?: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(baseDir || process.cwd(), filePath);
}

/**
 * Check if a file exists and is readable
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Load a single context file
 */
export async function loadContextFile(
  filePath: string,
  options: ContextLoadOptions = {}
): Promise<ContextFileResult> {
  const { baseDir, maxFileSize = DEFAULT_MAX_FILE_SIZE } = options;
  const absolutePath = resolveFilePath(filePath, baseDir);

  // Check if file exists
  if (!(await fileExists(absolutePath))) {
    return {
      filePath,
      absolutePath,
      success: false,
      error: `File not found: ${filePath}`,
    };
  }

  // Check file size
  try {
    const size = await getFileSize(absolutePath);
    if (size > maxFileSize) {
      const sizeMB = (size / (1024 * 1024)).toFixed(2);
      const maxMB = (maxFileSize / (1024 * 1024)).toFixed(2);
      return {
        filePath,
        absolutePath,
        success: false,
        error: `File too large: ${filePath} (${sizeMB}MB exceeds ${maxMB}MB limit)`,
      };
    }
  } catch (err) {
    return {
      filePath,
      absolutePath,
      success: false,
      error: `Cannot read file stats: ${filePath} - ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }

  // Check if extension is supported
  if (!isSupportedExtension(absolutePath)) {
    const ext = path.extname(absolutePath) || '(no extension)';
    return {
      filePath,
      absolutePath,
      success: false,
      error: `Unsupported file type: ${filePath} (${ext}). Only text files are supported.`,
    };
  }

  // Read file content
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return {
      filePath,
      absolutePath,
      content,
      success: true,
    };
  } catch (err) {
    return {
      filePath,
      absolutePath,
      success: false,
      error: `Failed to read file: ${filePath} - ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Format a file's content for inclusion in AI context
 */
export function formatFileContent(file: ContextFileResult): string {
  if (!file.success || !file.content) {
    return '';
  }

  const relativePath = file.filePath;
  const ext = path.extname(file.filePath).toLowerCase().slice(1) || 'text';

  return `### File: ${relativePath}
\`\`\`${ext}
${file.content}
\`\`\``;
}

/**
 * Load multiple context files
 */
export async function loadContextFiles(
  filePaths: string[],
  options: ContextLoadOptions = {}
): Promise<ContextLoadResult> {
  const { continueOnError = true } = options;

  const files: ContextFileResult[] = [];
  const successful: ContextFileResult[] = [];
  const failed: ContextFileResult[] = [];

  for (const filePath of filePaths) {
    const result = await loadContextFile(filePath, options);
    files.push(result);

    if (result.success) {
      successful.push(result);
    } else {
      failed.push(result);
      if (!continueOnError) {
        break;
      }
    }
  }

  // Combine content from successful files
  const contentParts: string[] = [];
  for (const file of successful) {
    const formatted = formatFileContent(file);
    if (formatted) {
      contentParts.push(formatted);
    }
  }

  const combinedContent = contentParts.length > 0
    ? `## Reference Documents\n\n${contentParts.join('\n\n')}`
    : '';

  return {
    files,
    successful,
    failed,
    combinedContent,
    allSuccessful: failed.length === 0,
  };
}

/**
 * Validate context file paths (checks existence without reading content)
 */
export async function validateContextPaths(
  filePaths: string[],
  baseDir?: string
): Promise<{ valid: string[]; invalid: Array<{ path: string; error: string }> }> {
  const valid: string[] = [];
  const invalid: Array<{ path: string; error: string }> = [];

  for (const filePath of filePaths) {
    const absolutePath = resolveFilePath(filePath, baseDir);

    if (!(await fileExists(absolutePath))) {
      invalid.push({ path: filePath, error: 'File not found' });
    } else if (!isSupportedExtension(absolutePath)) {
      invalid.push({ path: filePath, error: 'Unsupported file type' });
    } else {
      valid.push(filePath);
    }
  }

  return { valid, invalid };
}

/**
 * Format error messages for display to user
 */
export function formatContextErrors(failed: ContextFileResult[]): string {
  if (failed.length === 0) {
    return '';
  }

  const errors = failed.map((f) => `  - ${f.error}`).join('\n');
  const plural = failed.length === 1 ? 'file' : 'files';

  return `Failed to load ${failed.length} context ${plural}:\n${errors}`;
}
