/**
 * Tests for codebase exploration functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import {
  detectProjectType,
  detectFrameworks,
  findConfigFiles,
  findSourceDirectories,
  findTestDirectories,
  findDocDirectories,
  findEntryPoints,
  detectPackageManager,
  hasGitRepo,
  detectCI,
  countFilesByExtension,
  exploreProject,
  formatStructureSummary,
  formatFileCountsSummary,
  exploreCodebase,
  getQuickSummary,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_PATTERNS,
  type ProjectStructure,
  type FileCount,
} from './exploration.js';

// Helper to create a temporary directory structure
async function createTempDir(baseDir: string, structure: Record<string, string | null>): Promise<void> {
  for (const [path, content] of Object.entries(structure)) {
    const fullPath = join(baseDir, path);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));

    if (parentDir && parentDir !== baseDir) {
      await mkdir(parentDir, { recursive: true });
    }

    if (content === null) {
      // Create directory
      await mkdir(fullPath, { recursive: true });
    } else {
      // Create file
      await mkdir(parentDir || baseDir, { recursive: true });
      await writeFile(fullPath, content);
    }
  }
}

// Helper to clean up temporary directory
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('exploration', () => {
  const testDir = join(process.cwd(), '.test-exploration-temp');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(testDir);
  });

  describe('DEFAULT_IGNORE_DIRS', () => {
    it('should include common directories to ignore', () => {
      expect(DEFAULT_IGNORE_DIRS).toContain('node_modules');
      expect(DEFAULT_IGNORE_DIRS).toContain('.git');
      expect(DEFAULT_IGNORE_DIRS).toContain('dist');
      expect(DEFAULT_IGNORE_DIRS).toContain('build');
      expect(DEFAULT_IGNORE_DIRS).toContain('coverage');
      expect(DEFAULT_IGNORE_DIRS).toContain('__pycache__');
    });
  });

  describe('DEFAULT_IGNORE_PATTERNS', () => {
    it('should match common patterns to ignore', () => {
      expect(DEFAULT_IGNORE_PATTERNS.some(p => p.test('.DS_Store'))).toBe(true);
      expect(DEFAULT_IGNORE_PATTERNS.some(p => p.test('.env'))).toBe(true);
      expect(DEFAULT_IGNORE_PATTERNS.some(p => p.test('.env.local'))).toBe(true);
      expect(DEFAULT_IGNORE_PATTERNS.some(p => p.test('package-lock.json'))).toBe(false);
    });
  });

  describe('detectProjectType', () => {
    it('should detect TypeScript project', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'tsconfig.json': '{}',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('typescript');
    });

    it('should detect Node.js project', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('node');
    });

    it('should detect Python project', async () => {
      await createTempDir(testDir, {
        'pyproject.toml': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('python');
    });

    it('should detect Rust project', async () => {
      await createTempDir(testDir, {
        'Cargo.toml': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('rust');
    });

    it('should detect Go project', async () => {
      await createTempDir(testDir, {
        'go.mod': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('go');
    });

    it('should detect Java project with pom.xml', async () => {
      await createTempDir(testDir, {
        'pom.xml': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('java');
    });

    it('should detect Ruby project', async () => {
      await createTempDir(testDir, {
        'Gemfile': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('ruby');
    });

    it('should detect PHP project', async () => {
      await createTempDir(testDir, {
        'composer.json': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('php');
    });

    it('should return unknown for unrecognized project', async () => {
      await createTempDir(testDir, {
        'README.md': '',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('unknown');
    });

    it('should handle empty directory', async () => {
      const type = await detectProjectType(testDir);
      expect(type).toBe('unknown');
    });

    it('should prioritize TypeScript over Node when both present', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'tsconfig.json': '{}',
      });

      const type = await detectProjectType(testDir);
      expect(type).toBe('typescript');
    });
  });

  describe('detectFrameworks', () => {
    it('should detect React framework', async () => {
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0',
          },
        }),
      });

      const frameworks = await detectFrameworks(testDir);
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0].name).toBe('React');
      expect(frameworks[0].category).toBe('frontend');
      expect(frameworks[0].version).toBe('18.2.0');
    });

    it('should detect multiple frameworks', async () => {
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: {
            'next': '^14.0.0',
            'react': '^18.2.0',
          },
          devDependencies: {
            'vitest': '^1.0.0',
          },
        }),
      });

      const frameworks = await detectFrameworks(testDir);
      expect(frameworks.length).toBeGreaterThanOrEqual(2);

      const names = frameworks.map(f => f.name);
      expect(names).toContain('Next.js');
      expect(names).toContain('Vitest');
    });

    it('should detect Express framework', async () => {
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: {
            'express': '^4.18.0',
          },
        }),
      });

      const frameworks = await detectFrameworks(testDir);
      expect(frameworks.some(f => f.name === 'Express' && f.category === 'backend')).toBe(true);
    });

    it('should return empty array when no package.json', async () => {
      const frameworks = await detectFrameworks(testDir);
      expect(frameworks).toEqual([]);
    });

    it('should return empty array for invalid JSON', async () => {
      await createTempDir(testDir, {
        'package.json': 'not valid json',
      });

      const frameworks = await detectFrameworks(testDir);
      expect(frameworks).toEqual([]);
    });

    it('should handle package.json without dependencies', async () => {
      await createTempDir(testDir, {
        'package.json': JSON.stringify({ name: 'test' }),
      });

      const frameworks = await detectFrameworks(testDir);
      expect(frameworks).toEqual([]);
    });
  });

  describe('findConfigFiles', () => {
    it('should find common configuration files', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'tsconfig.json': '{}',
        '.eslintrc.json': '{}',
        '.gitignore': '',
      });

      const configs = await findConfigFiles(testDir);
      expect(configs).toContain('package.json');
      expect(configs).toContain('tsconfig.json');
      expect(configs).toContain('.eslintrc.json');
      expect(configs).toContain('.gitignore');
    });

    it('should find vitest and playwright configs', async () => {
      await createTempDir(testDir, {
        'vitest.config.ts': '',
        'playwright.config.ts': '',
      });

      const configs = await findConfigFiles(testDir);
      expect(configs).toContain('vitest.config.ts');
      expect(configs).toContain('playwright.config.ts');
    });

    it('should find Docker files', async () => {
      await createTempDir(testDir, {
        'Dockerfile': '',
        'docker-compose.yml': '',
      });

      const configs = await findConfigFiles(testDir);
      expect(configs).toContain('Dockerfile');
      expect(configs).toContain('docker-compose.yml');
    });

    it('should return empty array for empty directory', async () => {
      const configs = await findConfigFiles(testDir);
      expect(configs).toEqual([]);
    });
  });

  describe('findSourceDirectories', () => {
    it('should find src directory for TypeScript project', async () => {
      await createTempDir(testDir, {
        'src/index.ts': null,
      });
      await mkdir(join(testDir, 'src'), { recursive: true });

      const dirs = await findSourceDirectories(testDir, 'typescript');
      expect(dirs).toContain('src');
    });

    it('should find multiple source directories', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await mkdir(join(testDir, 'lib'), { recursive: true });

      const dirs = await findSourceDirectories(testDir, 'node');
      expect(dirs).toContain('src');
      expect(dirs).toContain('lib');
    });

    it('should find Go-specific directories', async () => {
      await mkdir(join(testDir, 'cmd'), { recursive: true });
      await mkdir(join(testDir, 'pkg'), { recursive: true });
      await mkdir(join(testDir, 'internal'), { recursive: true });

      const dirs = await findSourceDirectories(testDir, 'go');
      expect(dirs).toContain('cmd');
      expect(dirs).toContain('pkg');
      expect(dirs).toContain('internal');
    });

    it('should return empty array when no source directories exist', async () => {
      const dirs = await findSourceDirectories(testDir, 'typescript');
      expect(dirs).toEqual([]);
    });
  });

  describe('findTestDirectories', () => {
    it('should find test directory', async () => {
      await mkdir(join(testDir, 'test'), { recursive: true });

      const dirs = await findTestDirectories(testDir);
      expect(dirs).toContain('test');
    });

    it('should find tests directory', async () => {
      await mkdir(join(testDir, 'tests'), { recursive: true });

      const dirs = await findTestDirectories(testDir);
      expect(dirs).toContain('tests');
    });

    it('should find __tests__ directory', async () => {
      await mkdir(join(testDir, '__tests__'), { recursive: true });

      const dirs = await findTestDirectories(testDir);
      expect(dirs).toContain('__tests__');
    });

    it('should find spec directory', async () => {
      await mkdir(join(testDir, 'spec'), { recursive: true });

      const dirs = await findTestDirectories(testDir);
      expect(dirs).toContain('spec');
    });

    it('should return empty array when no test directories exist', async () => {
      const dirs = await findTestDirectories(testDir);
      expect(dirs).toEqual([]);
    });
  });

  describe('findDocDirectories', () => {
    it('should find docs directory', async () => {
      await mkdir(join(testDir, 'docs'), { recursive: true });

      const dirs = await findDocDirectories(testDir);
      expect(dirs).toContain('docs');
    });

    it('should find doc directory', async () => {
      await mkdir(join(testDir, 'doc'), { recursive: true });

      const dirs = await findDocDirectories(testDir);
      expect(dirs).toContain('doc');
    });

    it('should return empty array when no doc directories exist', async () => {
      const dirs = await findDocDirectories(testDir);
      expect(dirs).toEqual([]);
    });
  });

  describe('findEntryPoints', () => {
    it('should find index.ts in root', async () => {
      await createTempDir(testDir, {
        'index.ts': '',
      });

      const entries = await findEntryPoints(testDir, []);
      expect(entries).toContain('index.ts');
    });

    it('should find entry points in source directories', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await createTempDir(testDir, {
        'src/index.ts': '',
        'src/main.ts': '',
      });

      const entries = await findEntryPoints(testDir, ['src']);
      expect(entries).toContain('src/index.ts');
      expect(entries).toContain('src/main.ts');
    });

    it('should find multiple entry point types', async () => {
      await createTempDir(testDir, {
        'main.py': '',
        'main.go': '',
      });

      const entries = await findEntryPoints(testDir, []);
      expect(entries).toContain('main.py');
      expect(entries).toContain('main.go');
    });

    it('should return empty array when no entry points exist', async () => {
      const entries = await findEntryPoints(testDir, []);
      expect(entries).toEqual([]);
    });
  });

  describe('detectPackageManager', () => {
    it('should detect npm from package-lock.json', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'package-lock.json': '{}',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('npm');
    });

    it('should detect yarn from yarn.lock', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'yarn.lock': '',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('yarn');
    });

    it('should detect pnpm from pnpm-lock.yaml', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'pnpm-lock.yaml': '',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('pnpm');
    });

    it('should detect bun from bun.lockb', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
        'bun.lockb': '',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('bun');
    });

    it('should detect cargo from Cargo.lock', async () => {
      await createTempDir(testDir, {
        'Cargo.toml': '',
        'Cargo.lock': '',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('cargo');
    });

    it('should detect go from go.sum', async () => {
      await createTempDir(testDir, {
        'go.mod': '',
        'go.sum': '',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('go');
    });

    it('should fallback to npm when only package.json exists', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
      });

      const pm = await detectPackageManager(testDir);
      expect(pm).toBe('npm');
    });

    it('should return undefined when no package manager detected', async () => {
      const pm = await detectPackageManager(testDir);
      expect(pm).toBeUndefined();
    });
  });

  describe('hasGitRepo', () => {
    it('should return true when .git directory exists', async () => {
      await mkdir(join(testDir, '.git'), { recursive: true });

      const hasGit = await hasGitRepo(testDir);
      expect(hasGit).toBe(true);
    });

    it('should return false when no .git directory', async () => {
      const hasGit = await hasGitRepo(testDir);
      expect(hasGit).toBe(false);
    });
  });

  describe('detectCI', () => {
    it('should detect GitHub Actions', async () => {
      await mkdir(join(testDir, '.github/workflows'), { recursive: true });

      const ci = await detectCI(testDir);
      expect(ci.hasCI).toBe(true);
      expect(ci.platform).toBe('GitHub Actions');
    });

    it('should detect GitLab CI', async () => {
      await createTempDir(testDir, {
        '.gitlab-ci.yml': '',
      });

      const ci = await detectCI(testDir);
      expect(ci.hasCI).toBe(true);
      expect(ci.platform).toBe('GitLab CI');
    });

    it('should detect CircleCI', async () => {
      await mkdir(join(testDir, '.circleci'), { recursive: true });

      const ci = await detectCI(testDir);
      expect(ci.hasCI).toBe(true);
      expect(ci.platform).toBe('CircleCI');
    });

    it('should detect Jenkins', async () => {
      await createTempDir(testDir, {
        'Jenkinsfile': '',
      });

      const ci = await detectCI(testDir);
      expect(ci.hasCI).toBe(true);
      expect(ci.platform).toBe('Jenkins');
    });

    it('should return no CI when none detected', async () => {
      const ci = await detectCI(testDir);
      expect(ci.hasCI).toBe(false);
      expect(ci.platform).toBeUndefined();
    });
  });

  describe('countFilesByExtension', () => {
    it('should count files by extension', async () => {
      await createTempDir(testDir, {
        'file1.ts': '',
        'file2.ts': '',
        'file3.js': '',
        'README.md': '',
      });

      const counts = await countFilesByExtension(testDir);

      const tsCount = counts.find(c => c.extension === '.ts');
      const jsCount = counts.find(c => c.extension === '.js');
      const mdCount = counts.find(c => c.extension === '.md');

      expect(tsCount?.count).toBe(2);
      expect(jsCount?.count).toBe(1);
      expect(mdCount?.count).toBe(1);
    });

    it('should sort by count descending', async () => {
      await createTempDir(testDir, {
        'a.ts': '',
        'b.ts': '',
        'c.ts': '',
        'd.js': '',
        'e.js': '',
        'f.md': '',
      });

      const counts = await countFilesByExtension(testDir);

      expect(counts[0].extension).toBe('.ts');
      expect(counts[0].count).toBe(3);
      expect(counts[1].extension).toBe('.js');
      expect(counts[1].count).toBe(2);
    });

    it('should ignore specified directories', async () => {
      await mkdir(join(testDir, 'node_modules'), { recursive: true });
      await createTempDir(testDir, {
        'src/file.ts': '',
        'node_modules/package/file.js': '',
      });

      const counts = await countFilesByExtension(testDir, {
        ignoreDirs: ['node_modules'],
      });

      const jsCount = counts.find(c => c.extension === '.js');
      expect(jsCount).toBeUndefined();
    });

    it('should respect maxDepth option', async () => {
      await mkdir(join(testDir, 'a/b/c/d'), { recursive: true });
      await createTempDir(testDir, {
        'level0.ts': '',
        'a/level1.ts': '',
        'a/b/level2.ts': '',
        'a/b/c/level3.ts': '',
        'a/b/c/d/level4.ts': '',
      });

      const counts = await countFilesByExtension(testDir, { maxDepth: 2 });
      const tsCount = counts.find(c => c.extension === '.ts');

      // Should find level0, level1, level2 (depth 0, 1, 2) but not level3+ (depth 3+)
      expect(tsCount?.count).toBe(3);
    });

    it('should return empty array for empty directory', async () => {
      const counts = await countFilesByExtension(testDir);
      expect(counts).toEqual([]);
    });
  });

  describe('exploreProject', () => {
    it('should return complete project structure', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await mkdir(join(testDir, 'test'), { recursive: true });
      await mkdir(join(testDir, '.git'), { recursive: true });
      await mkdir(join(testDir, '.github/workflows'), { recursive: true });
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: { 'react': '^18.0.0' },
        }),
        'tsconfig.json': '{}',
        'package-lock.json': '{}',
        'src/index.ts': '',
      });

      const structure = await exploreProject(testDir);

      expect(structure.rootDir).toBe(testDir);
      expect(structure.projectType).toBe('typescript');
      expect(structure.frameworks.some(f => f.name === 'React')).toBe(true);
      expect(structure.configFiles).toContain('package.json');
      expect(structure.configFiles).toContain('tsconfig.json');
      expect(structure.sourceDirectories).toContain('src');
      expect(structure.testDirectories).toContain('test');
      expect(structure.entryPoints).toContain('src/index.ts');
      expect(structure.packageManager).toBe('npm');
      expect(structure.hasGit).toBe(true);
      expect(structure.hasCI).toBe(true);
      expect(structure.ciPlatform).toBe('GitHub Actions');
    });

    it('should handle minimal project', async () => {
      await createTempDir(testDir, {
        'README.md': '',
      });

      const structure = await exploreProject(testDir);

      expect(structure.projectType).toBe('unknown');
      expect(structure.frameworks).toEqual([]);
      expect(structure.sourceDirectories).toEqual([]);
      expect(structure.testDirectories).toEqual([]);
      expect(structure.entryPoints).toEqual([]);
      expect(structure.hasGit).toBe(false);
      expect(structure.hasCI).toBe(false);
    });
  });

  describe('formatStructureSummary', () => {
    it('should format TypeScript project summary', () => {
      const structure: ProjectStructure = {
        rootDir: '/test',
        projectType: 'typescript',
        frameworks: [
          { name: 'React', category: 'frontend', version: '18.2.0' },
          { name: 'Vitest', category: 'testing', version: '1.0.0' },
        ],
        configFiles: ['package.json', 'tsconfig.json'],
        sourceDirectories: ['src'],
        testDirectories: ['test'],
        docDirectories: ['docs'],
        entryPoints: ['src/index.ts'],
        packageManager: 'npm',
        hasGit: true,
        hasCI: true,
        ciPlatform: 'GitHub Actions',
      };

      const summary = formatStructureSummary(structure);

      expect(summary).toContain('TypeScript project');
      expect(summary).toContain('npm');
      expect(summary).toContain('Git repository');
      expect(summary).toContain('GitHub Actions');
      expect(summary).toContain('React');
      expect(summary).toContain('18.2.0');
      expect(summary).toContain('frontend');
      expect(summary).toContain('Vitest');
      expect(summary).toContain('src');
      expect(summary).toContain('test');
      expect(summary).toContain('docs');
      expect(summary).toContain('src/index.ts');
      expect(summary).toContain('package.json');
    });

    it('should handle minimal structure', () => {
      const structure: ProjectStructure = {
        rootDir: '/test',
        projectType: 'unknown',
        frameworks: [],
        configFiles: [],
        sourceDirectories: [],
        testDirectories: [],
        docDirectories: [],
        entryPoints: [],
        hasGit: false,
        hasCI: false,
      };

      const summary = formatStructureSummary(structure);

      expect(summary).toContain('Unknown');
      expect(summary).toContain('No Git detected');
      expect(summary).not.toContain('Frameworks');
    });
  });

  describe('formatFileCountsSummary', () => {
    it('should format file counts', () => {
      const counts: FileCount[] = [
        { extension: '.ts', count: 50 },
        { extension: '.js', count: 20 },
        { extension: '.md', count: 10 },
      ];

      const summary = formatFileCountsSummary(counts);

      expect(summary).toContain('.ts: 50 files');
      expect(summary).toContain('.js: 20 files');
      expect(summary).toContain('.md: 10 files');
      expect(summary).toContain('**Total:** 80 files');
    });

    it('should limit displayed extensions', () => {
      const counts: FileCount[] = Array.from({ length: 15 }, (_, i) => ({
        extension: `.ext${i}`,
        count: 15 - i,
      }));

      const summary = formatFileCountsSummary(counts, 5);

      expect(summary).toContain('.ext0');
      expect(summary).toContain('.ext4');
      expect(summary).not.toContain('.ext5:');
      expect(summary).toContain('Other:');
    });

    it('should handle empty counts', () => {
      const summary = formatFileCountsSummary([]);
      expect(summary).toBe('No files found.');
    });
  });

  describe('exploreCodebase', () => {
    it('should return complete exploration result', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: { 'express': '^4.18.0' },
        }),
        'src/app.ts': '',
        'src/utils.ts': '',
      });

      const result = await exploreCodebase(testDir);

      expect(result.structure).toBeDefined();
      expect(result.structure.projectType).toBe('node');
      expect(result.fileCounts).toBeDefined();
      expect(result.summary).toContain('Node.js project');
      expect(result.summary).toContain('.ts');
      expect(result.exploredAt).toBeDefined();
    });

    it('should exclude file counts when option is false', async () => {
      await createTempDir(testDir, {
        'package.json': '{}',
      });

      const result = await exploreCodebase(testDir, { includeFileCounts: false });

      expect(result.fileCounts).toBeUndefined();
    });

    it('should include exploredAt timestamp', async () => {
      const result = await exploreCodebase(testDir);

      expect(result.exploredAt).toBeDefined();
      // Verify it's a valid ISO string
      expect(new Date(result.exploredAt).toISOString()).toBe(result.exploredAt);
    });
  });

  describe('getQuickSummary', () => {
    it('should return formatted summary string', async () => {
      await mkdir(join(testDir, 'src'), { recursive: true });
      await createTempDir(testDir, {
        'package.json': JSON.stringify({
          dependencies: { 'react': '^18.0.0' },
        }),
        'tsconfig.json': '{}',
      });

      const summary = await getQuickSummary(testDir);

      expect(typeof summary).toBe('string');
      expect(summary).toContain('TypeScript project');
      expect(summary).toContain('React');
    });

    it('should work with minimal project', async () => {
      const summary = await getQuickSummary(testDir);

      expect(typeof summary).toBe('string');
      expect(summary).toContain('Unknown');
    });
  });
});
