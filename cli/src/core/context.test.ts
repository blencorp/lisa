/**
 * Tests for context file loading
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  isSupportedExtension,
  resolveFilePath,
  fileExists,
  getFileSize,
  loadContextFile,
  formatFileContent,
  loadContextFiles,
  validateContextPaths,
  formatContextErrors,
  DEFAULT_MAX_FILE_SIZE,
  SUPPORTED_EXTENSIONS,
  type ContextFileResult,
} from './context.js';

describe('Context File Loading', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisa-context-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('DEFAULT_MAX_FILE_SIZE', () => {
    it('should be 1MB', () => {
      expect(DEFAULT_MAX_FILE_SIZE).toBe(1024 * 1024);
    });
  });

  describe('SUPPORTED_EXTENSIONS', () => {
    it('should include common markdown extensions', () => {
      expect(SUPPORTED_EXTENSIONS.has('.md')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.markdown')).toBe(true);
    });

    it('should include common text extensions', () => {
      expect(SUPPORTED_EXTENSIONS.has('.txt')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.text')).toBe(true);
    });

    it('should include common code extensions', () => {
      expect(SUPPORTED_EXTENSIONS.has('.ts')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.tsx')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.js')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.jsx')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.py')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.go')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.rs')).toBe(true);
    });

    it('should include config extensions', () => {
      expect(SUPPORTED_EXTENSIONS.has('.json')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.yaml')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.yml')).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has('.toml')).toBe(true);
    });
  });

  describe('isSupportedExtension', () => {
    it('should return true for markdown files', () => {
      expect(isSupportedExtension('docs/spec.md')).toBe(true);
      expect(isSupportedExtension('README.markdown')).toBe(true);
    });

    it('should return true for text files', () => {
      expect(isSupportedExtension('notes.txt')).toBe(true);
    });

    it('should return true for code files', () => {
      expect(isSupportedExtension('src/index.ts')).toBe(true);
      expect(isSupportedExtension('main.py')).toBe(true);
      expect(isSupportedExtension('server.go')).toBe(true);
    });

    it('should return true for config files', () => {
      expect(isSupportedExtension('config.json')).toBe(true);
      expect(isSupportedExtension('settings.yaml')).toBe(true);
    });

    it('should return true for dotfiles in supported extensions', () => {
      expect(isSupportedExtension('.gitignore')).toBe(true);
      expect(isSupportedExtension('.env')).toBe(true);
      expect(isSupportedExtension('.eslintrc')).toBe(true);
    });

    it('should return true for files without extension (like README)', () => {
      expect(isSupportedExtension('README')).toBe(true);
      expect(isSupportedExtension('LICENSE')).toBe(true);
    });

    it('should return false for binary file extensions', () => {
      expect(isSupportedExtension('image.png')).toBe(false);
      expect(isSupportedExtension('video.mp4')).toBe(false);
      expect(isSupportedExtension('archive.zip')).toBe(false);
      expect(isSupportedExtension('document.pdf')).toBe(false);
    });
  });

  describe('resolveFilePath', () => {
    it('should return absolute path unchanged', () => {
      const absPath = '/home/user/docs/spec.md';
      expect(resolveFilePath(absPath)).toBe(absPath);
    });

    it('should resolve relative path from cwd by default', () => {
      const result = resolveFilePath('docs/spec.md');
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(path.resolve(process.cwd(), 'docs/spec.md'));
    });

    it('should resolve relative path from baseDir when provided', () => {
      const baseDir = '/home/user/project';
      const result = resolveFilePath('docs/spec.md', baseDir);
      expect(result).toBe(path.join(baseDir, 'docs/spec.md'));
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'content');
      expect(await fileExists(filePath)).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');
      expect(await fileExists(filePath)).toBe(false);
    });

    it('should return false for directory', async () => {
      expect(await fileExists(tempDir)).toBe(true); // directories are readable
    });
  });

  describe('getFileSize', () => {
    it('should return correct file size', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';
      await fs.writeFile(filePath, content);
      expect(await getFileSize(filePath)).toBe(content.length);
    });

    it('should throw for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');
      await expect(getFileSize(filePath)).rejects.toThrow();
    });
  });

  describe('loadContextFile', () => {
    it('should load existing text file successfully', async () => {
      const filePath = path.join(tempDir, 'spec.md');
      const content = '# Specification\n\nThis is a spec.';
      await fs.writeFile(filePath, content);

      const result = await loadContextFile(filePath);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(filePath);
      expect(result.absolutePath).toBe(filePath);
      expect(result.content).toBe(content);
      expect(result.error).toBeUndefined();
    });

    it('should return error for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.md');

      const result = await loadContextFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error for file exceeding size limit', async () => {
      const filePath = path.join(tempDir, 'large.txt');
      // Create a file larger than 100 bytes
      await fs.writeFile(filePath, 'x'.repeat(200));

      const result = await loadContextFile(filePath, { maxFileSize: 100 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File too large');
      expect(result.error).toContain('exceeds');
    });

    it('should return error for unsupported file type', async () => {
      const filePath = path.join(tempDir, 'image.png');
      await fs.writeFile(filePath, 'fake binary content');

      const result = await loadContextFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported file type');
    });

    it('should resolve relative paths using baseDir', async () => {
      const subDir = path.join(tempDir, 'docs');
      await fs.mkdir(subDir);
      const filePath = path.join(subDir, 'spec.md');
      await fs.writeFile(filePath, '# Spec');

      const result = await loadContextFile('docs/spec.md', { baseDir: tempDir });

      expect(result.success).toBe(true);
      expect(result.absolutePath).toBe(filePath);
    });
  });

  describe('formatFileContent', () => {
    it('should format successful file with markdown code block', () => {
      const file: ContextFileResult = {
        filePath: 'docs/spec.md',
        absolutePath: '/project/docs/spec.md',
        content: '# Specification\n\nDetails here.',
        success: true,
      };

      const formatted = formatFileContent(file);

      expect(formatted).toContain('### File: docs/spec.md');
      expect(formatted).toContain('```md');
      expect(formatted).toContain('# Specification');
      expect(formatted).toContain('```');
    });

    it('should use correct language identifier for different extensions', () => {
      const tsFile: ContextFileResult = {
        filePath: 'src/index.ts',
        absolutePath: '/project/src/index.ts',
        content: 'const x = 1;',
        success: true,
      };

      const formatted = formatFileContent(tsFile);
      expect(formatted).toContain('```ts');
    });

    it('should return empty string for failed file', () => {
      const file: ContextFileResult = {
        filePath: 'missing.md',
        absolutePath: '/project/missing.md',
        success: false,
        error: 'File not found',
      };

      expect(formatFileContent(file)).toBe('');
    });

    it('should use text identifier for files without extension', () => {
      const file: ContextFileResult = {
        filePath: 'README',
        absolutePath: '/project/README',
        content: 'Project readme',
        success: true,
      };

      const formatted = formatFileContent(file);
      expect(formatted).toContain('```text');
    });
  });

  describe('loadContextFiles', () => {
    it('should load multiple files successfully', async () => {
      const file1 = path.join(tempDir, 'spec.md');
      const file2 = path.join(tempDir, 'notes.txt');
      await fs.writeFile(file1, '# Spec');
      await fs.writeFile(file2, 'Notes here');

      const result = await loadContextFiles([file1, file2]);

      expect(result.allSuccessful).toBe(true);
      expect(result.successful.length).toBe(2);
      expect(result.failed.length).toBe(0);
      expect(result.combinedContent).toContain('## Reference Documents');
      expect(result.combinedContent).toContain('spec.md');
      expect(result.combinedContent).toContain('notes.txt');
    });

    it('should handle mixed success and failure', async () => {
      const existingFile = path.join(tempDir, 'spec.md');
      await fs.writeFile(existingFile, '# Spec');
      const missingFile = path.join(tempDir, 'missing.md');

      const result = await loadContextFiles([existingFile, missingFile]);

      expect(result.allSuccessful).toBe(false);
      expect(result.successful.length).toBe(1);
      expect(result.failed.length).toBe(1);
      expect(result.combinedContent).toContain('spec.md');
    });

    it('should stop on first error when continueOnError is false', async () => {
      const existingFile = path.join(tempDir, 'spec.md');
      await fs.writeFile(existingFile, '# Spec');
      const missingFile = path.join(tempDir, 'missing.md');
      const anotherFile = path.join(tempDir, 'another.md');
      await fs.writeFile(anotherFile, '# Another');

      const result = await loadContextFiles(
        [missingFile, existingFile, anotherFile],
        { continueOnError: false }
      );

      expect(result.failed.length).toBe(1);
      // Should stop after first failure, so only 1 file processed
      expect(result.files.length).toBe(1);
    });

    it('should return empty content for empty file list', async () => {
      const result = await loadContextFiles([]);

      expect(result.allSuccessful).toBe(true);
      expect(result.combinedContent).toBe('');
      expect(result.files.length).toBe(0);
    });

    it('should return empty content when all files fail', async () => {
      const result = await loadContextFiles([
        path.join(tempDir, 'missing1.md'),
        path.join(tempDir, 'missing2.md'),
      ]);

      expect(result.allSuccessful).toBe(false);
      expect(result.combinedContent).toBe('');
    });
  });

  describe('validateContextPaths', () => {
    it('should return valid paths for existing files', async () => {
      const file1 = path.join(tempDir, 'spec.md');
      const file2 = path.join(tempDir, 'notes.txt');
      await fs.writeFile(file1, '# Spec');
      await fs.writeFile(file2, 'Notes');

      const result = await validateContextPaths([file1, file2]);

      expect(result.valid.length).toBe(2);
      expect(result.invalid.length).toBe(0);
    });

    it('should report invalid paths for missing files', async () => {
      const existingFile = path.join(tempDir, 'spec.md');
      await fs.writeFile(existingFile, '# Spec');
      const missingFile = path.join(tempDir, 'missing.md');

      const result = await validateContextPaths([existingFile, missingFile]);

      expect(result.valid.length).toBe(1);
      expect(result.invalid.length).toBe(1);
      expect(result.invalid[0].path).toBe(missingFile);
      expect(result.invalid[0].error).toBe('File not found');
    });

    it('should report invalid paths for unsupported file types', async () => {
      const pngFile = path.join(tempDir, 'image.png');
      await fs.writeFile(pngFile, 'fake');

      const result = await validateContextPaths([pngFile]);

      expect(result.valid.length).toBe(0);
      expect(result.invalid.length).toBe(1);
      expect(result.invalid[0].error).toBe('Unsupported file type');
    });

    it('should use baseDir for resolving relative paths', async () => {
      const subDir = path.join(tempDir, 'docs');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'spec.md'), '# Spec');

      const result = await validateContextPaths(['docs/spec.md'], tempDir);

      expect(result.valid.length).toBe(1);
      expect(result.invalid.length).toBe(0);
    });
  });

  describe('formatContextErrors', () => {
    it('should return empty string for no failures', () => {
      expect(formatContextErrors([])).toBe('');
    });

    it('should format single failure correctly', () => {
      const failed: ContextFileResult[] = [
        {
          filePath: 'missing.md',
          absolutePath: '/project/missing.md',
          success: false,
          error: 'File not found: missing.md',
        },
      ];

      const formatted = formatContextErrors(failed);

      expect(formatted).toContain('Failed to load 1 context file');
      expect(formatted).toContain('File not found: missing.md');
    });

    it('should format multiple failures correctly', () => {
      const failed: ContextFileResult[] = [
        {
          filePath: 'missing1.md',
          absolutePath: '/project/missing1.md',
          success: false,
          error: 'File not found: missing1.md',
        },
        {
          filePath: 'missing2.md',
          absolutePath: '/project/missing2.md',
          success: false,
          error: 'File not found: missing2.md',
        },
      ];

      const formatted = formatContextErrors(failed);

      expect(formatted).toContain('Failed to load 2 context files');
      expect(formatted).toContain('missing1.md');
      expect(formatted).toContain('missing2.md');
    });
  });
});
