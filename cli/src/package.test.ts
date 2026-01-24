/**
 * Tests for npm package configuration
 * Validates package.json is correctly configured for npm publishing
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Get project root (parent of src directory)
const projectRoot = join(import.meta.dirname, '..');

interface PackageJson {
  name: string;
  version: string;
  description: string;
  type: string;
  main: string;
  types?: string;
  bin: Record<string, string>;
  files: string[];
  repository?: {
    type: string;
    url: string;
  };
  bugs?: {
    url: string;
  };
  homepage?: string;
  scripts: Record<string, string>;
  keywords: string[];
  author: string;
  license: string;
  engines: {
    node: string;
  };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('package.json configuration', () => {
  let packageJson: PackageJson;

  beforeAll(() => {
    const packagePath = join(projectRoot, 'package.json');
    const content = readFileSync(packagePath, 'utf-8');
    packageJson = JSON.parse(content);
  });

  describe('basic fields', () => {
    it('has correct name', () => {
      expect(packageJson.name).toBe('@blen/lisa');
    });

    it('has valid semver version', () => {
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('has descriptive description', () => {
      expect(packageJson.description).toContain('AI');
      expect(packageJson.description).toContain('Planning');
      expect(packageJson.description.length).toBeGreaterThan(30);
    });

    it('uses ESM modules', () => {
      expect(packageJson.type).toBe('module');
    });

    it('has main entry point', () => {
      expect(packageJson.main).toBe('dist/index.js');
    });

    it('has TypeScript type definitions', () => {
      expect(packageJson.types).toBe('dist/index.d.ts');
    });
  });

  describe('bin configuration', () => {
    it('has lisa command configured', () => {
      expect(packageJson.bin).toBeDefined();
      expect(packageJson.bin.lisa).toBe('dist/cli/index.js');
    });

    it('bin points to dist directory', () => {
      expect(packageJson.bin.lisa).toMatch(/^dist\//);
    });
  });

  describe('files field', () => {
    it('includes dist directory', () => {
      expect(packageJson.files).toContain('dist');
    });

    it('includes README.md', () => {
      expect(packageJson.files).toContain('README.md');
    });

    it('does not include source files', () => {
      expect(packageJson.files).not.toContain('src');
      expect(packageJson.files).not.toContain('src/**');
    });

    it('does not include test files', () => {
      expect(packageJson.files).not.toContain('**/*.test.ts');
      expect(packageJson.files).not.toContain('vitest.config.ts');
    });

    it('does not include dev configuration', () => {
      expect(packageJson.files).not.toContain('tsconfig.json');
      expect(packageJson.files).not.toContain('.eslintrc.cjs');
    });
  });

  describe('repository information', () => {
    it('has repository field', () => {
      expect(packageJson.repository).toBeDefined();
    });

    it('has git repository type', () => {
      expect(packageJson.repository?.type).toBe('git');
    });

    it('has valid repository URL', () => {
      expect(packageJson.repository?.url).toMatch(/^https:\/\/github\.com\//);
    });

    it('has bugs URL', () => {
      expect(packageJson.bugs?.url).toMatch(/\/issues$/);
    });

    it('has homepage', () => {
      expect(packageJson.homepage).toMatch(/^https:\/\/github\.com\//);
    });
  });

  describe('scripts', () => {
    it('has build script', () => {
      expect(packageJson.scripts.build).toBeDefined();
    });

    it('has test script', () => {
      expect(packageJson.scripts.test).toBeDefined();
    });

    it('has lint script', () => {
      expect(packageJson.scripts.lint).toBeDefined();
    });

    it('has dev script', () => {
      expect(packageJson.scripts.dev).toBeDefined();
    });

    it('has typecheck script', () => {
      expect(packageJson.scripts.typecheck).toBeDefined();
    });
  });

  describe('keywords', () => {
    it('has relevant keywords', () => {
      expect(packageJson.keywords).toContain('cli');
      expect(packageJson.keywords).toContain('ai');
      expect(packageJson.keywords).toContain('planning');
      expect(packageJson.keywords).toContain('prd');
    });

    it('includes AI provider names', () => {
      expect(packageJson.keywords).toContain('claude');
      expect(packageJson.keywords).toContain('copilot');
    });

    it('has at least 5 keywords', () => {
      expect(packageJson.keywords.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('metadata', () => {
    it('has author', () => {
      expect(packageJson.author).toBeTruthy();
    });

    it('has MIT license', () => {
      expect(packageJson.license).toBe('MIT');
    });

    it('specifies Node.js engine requirement', () => {
      expect(packageJson.engines.node).toMatch(/^>=\d+/);
    });

    it('requires Node.js 18 or higher', () => {
      const version = packageJson.engines.node.replace('>=', '');
      const majorVersion = parseInt(version.split('.')[0], 10);
      expect(majorVersion).toBeGreaterThanOrEqual(18);
    });
  });

  describe('dependencies', () => {
    it('has commander for CLI', () => {
      expect(packageJson.dependencies.commander).toBeDefined();
    });

    it('has yaml for config handling', () => {
      expect(packageJson.dependencies.yaml).toBeDefined();
    });

    it('has inquirer for prompts', () => {
      expect(packageJson.dependencies['@inquirer/prompts']).toBeDefined();
    });

    it('has chalk for styling', () => {
      expect(packageJson.dependencies.chalk).toBeDefined();
    });

    it('has TypeScript as devDependency', () => {
      expect(packageJson.devDependencies.typescript).toBeDefined();
    });

    it('has vitest as devDependency', () => {
      expect(packageJson.devDependencies.vitest).toBeDefined();
    });
  });
});

describe('README.md', () => {
  let readmeContent: string;
  const readmePath = join(projectRoot, 'README.md');

  beforeAll(() => {
    readmeContent = readFileSync(readmePath, 'utf-8');
  });

  it('exists', () => {
    expect(existsSync(readmePath)).toBe(true);
  });

  it('has a title', () => {
    expect(readmeContent).toMatch(/^# Lisa CLI/m);
  });

  it('explains what Lisa is', () => {
    expect(readmeContent).toContain('AI-Powered Planning Interview Tool');
  });

  describe('installation section', () => {
    it('has installation section', () => {
      expect(readmeContent).toContain('## Installation');
    });

    it('shows npm install command', () => {
      expect(readmeContent).toContain('npm install -g @blen/lisa');
    });
  });

  describe('usage section', () => {
    it('has usage section', () => {
      expect(readmeContent).toContain('## Usage');
    });

    it('shows basic usage example', () => {
      expect(readmeContent).toMatch(/lisa ".*"/);
    });

    it('documents provider flag', () => {
      expect(readmeContent).toContain('--provider');
    });

    it('documents context flag', () => {
      expect(readmeContent).toContain('--context');
    });

    it('documents first-principles flag', () => {
      expect(readmeContent).toContain('--first-principles');
    });

    it('documents resume flag', () => {
      expect(readmeContent).toContain('--resume');
    });
  });

  describe('provider documentation', () => {
    it('mentions Claude', () => {
      expect(readmeContent).toContain('Claude');
    });

    it('mentions OpenCode', () => {
      expect(readmeContent).toContain('OpenCode');
    });

    it('mentions Cursor', () => {
      expect(readmeContent).toContain('Cursor');
    });

    it('mentions Codex', () => {
      expect(readmeContent).toContain('Codex');
    });

    it('mentions Copilot', () => {
      expect(readmeContent).toContain('Copilot');
    });
  });

  describe('output documentation', () => {
    it('has output section', () => {
      expect(readmeContent).toContain('## Output');
    });

    it('documents markdown output', () => {
      expect(readmeContent).toContain('.md');
    });

    it('documents JSON output', () => {
      expect(readmeContent).toContain('.json');
    });

    it('shows output directory', () => {
      expect(readmeContent).toContain('./lisa/');
    });
  });

  describe('command reference', () => {
    it('has command reference section', () => {
      expect(readmeContent).toContain('## Command Reference');
    });

    it('shows all flags', () => {
      expect(readmeContent).toContain('-v, --version');
      expect(readmeContent).toContain('-r, --resume');
      expect(readmeContent).toContain('-f, --first-principles');
      expect(readmeContent).toContain('-c, --context');
      expect(readmeContent).toContain('-p, --provider');
      expect(readmeContent).toContain('-h, --help');
    });
  });

  it('has license section', () => {
    expect(readmeContent).toContain('## License');
    expect(readmeContent).toContain('MIT');
  });
});

describe('dist directory structure', () => {
  it('dist/index.js should exist after build', () => {
    const distIndexPath = join(projectRoot, 'dist', 'index.js');
    expect(existsSync(distIndexPath)).toBe(true);
  });

  it('dist/cli/index.js should exist after build', () => {
    const distCliPath = join(projectRoot, 'dist', 'cli', 'index.js');
    expect(existsSync(distCliPath)).toBe(true);
  });

  it('dist/index.d.ts should exist after build', () => {
    const distTypesPath = join(projectRoot, 'dist', 'index.d.ts');
    expect(existsSync(distTypesPath)).toBe(true);
  });
});

describe('CLI entry point', () => {
  it('has shebang line', () => {
    const cliSource = readFileSync(join(projectRoot, 'src', 'cli', 'index.ts'), 'utf-8');
    expect(cliSource.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('built CLI has shebang line', () => {
    const cliDist = readFileSync(join(projectRoot, 'dist', 'cli', 'index.js'), 'utf-8');
    expect(cliDist.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('handles symlinks correctly for global install', () => {
    // The CLI should use realpathSync to handle symlinks
    const cliSource = readFileSync(join(projectRoot, 'src', 'cli', 'index.ts'), 'utf-8');
    expect(cliSource).toContain('realpathSync');
    expect(cliSource).toContain('fileURLToPath');
  });
});

describe('npm pack validation', () => {
  it('package.json files field specifies packable files', () => {
    const packagePath = join(projectRoot, 'package.json');
    const content = readFileSync(packagePath, 'utf-8');
    const packageJson = JSON.parse(content);

    // Should have explicit files field
    expect(packageJson.files).toBeDefined();
    expect(Array.isArray(packageJson.files)).toBe(true);
    expect(packageJson.files.length).toBeGreaterThan(0);
  });

  it('dist directory exists with all required files', () => {
    const requiredDistFiles = [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/cli/index.js',
      'dist/cli/index.d.ts',
      'dist/cli/prompt.js',
      'dist/core/config.js',
      'dist/core/state.js',
      'dist/core/orchestrator.js',
      'dist/core/prd.js',
      'dist/providers/index.js',
      'dist/providers/claude.js',
    ];

    for (const file of requiredDistFiles) {
      const filePath = join(projectRoot, file);
      expect(existsSync(filePath), `Missing: ${file}`).toBe(true);
    }
  });

  it('dist files are valid JavaScript modules', () => {
    const distIndexPath = join(projectRoot, 'dist', 'index.js');
    const content = readFileSync(distIndexPath, 'utf-8');

    // Should be ESM with export statements
    expect(content).toContain('export');
  });

  it('type definitions are included', () => {
    const typesPath = join(projectRoot, 'dist', 'index.d.ts');
    const content = readFileSync(typesPath, 'utf-8');

    // Should have type exports
    expect(content).toContain('export');
  });
});

describe('CLI short flags', () => {
  it('source defines short flags for all options', () => {
    const cliSource = readFileSync(join(projectRoot, 'src', 'cli', 'index.ts'), 'utf-8');

    // Check for short flag definitions
    expect(cliSource).toContain('-r, --resume');
    expect(cliSource).toContain('-f, --first-principles');
    expect(cliSource).toContain('-c, --context');
    expect(cliSource).toContain('-p, --provider');
    expect(cliSource).toContain('-v, --version');
  });

  it('built CLI includes short flags', () => {
    const cliDist = readFileSync(join(projectRoot, 'dist', 'cli', 'index.js'), 'utf-8');

    // Check for short flag definitions in built output
    expect(cliDist).toContain('-r, --resume');
    expect(cliDist).toContain('-f, --first-principles');
    expect(cliDist).toContain('-c, --context');
    expect(cliDist).toContain('-p, --provider');
    expect(cliDist).toContain('-v, --version');
  });
});
