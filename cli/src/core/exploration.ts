/**
 * Codebase Exploration
 * Automatic codebase scanning to provide context for the interview
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * Project type detection result
 */
export type ProjectType =
  | 'node'
  | 'typescript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'dotnet'
  | 'unknown';

/**
 * Detected framework information
 */
export interface DetectedFramework {
  /** Framework name */
  name: string;
  /** Framework category */
  category: 'frontend' | 'backend' | 'fullstack' | 'testing' | 'build' | 'other';
  /** Version if detected */
  version?: string;
}

/**
 * Project structure information
 */
export interface ProjectStructure {
  /** Root directory path */
  rootDir: string;
  /** Primary project type */
  projectType: ProjectType;
  /** Detected frameworks */
  frameworks: DetectedFramework[];
  /** Key configuration files found */
  configFiles: string[];
  /** Main source directories */
  sourceDirectories: string[];
  /** Test directories */
  testDirectories: string[];
  /** Documentation directories */
  docDirectories: string[];
  /** Entry point files */
  entryPoints: string[];
  /** Package manager used */
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'cargo' | 'go' | 'maven' | 'gradle';
  /** Has git repository */
  hasGit: boolean;
  /** Has CI/CD configuration */
  hasCI: boolean;
  /** CI/CD platform if detected */
  ciPlatform?: string;
}

/**
 * Exploration options
 */
export interface ExplorationOptions {
  /** Maximum depth for directory traversal */
  maxDepth?: number;
  /** Directories to ignore */
  ignoreDirs?: string[];
  /** File patterns to ignore */
  ignorePatterns?: RegExp[];
  /** Include file counts */
  includeFileCounts?: boolean;
}

/**
 * File count by extension
 */
export interface FileCount {
  extension: string;
  count: number;
}

/**
 * Complete exploration result
 */
export interface ExplorationResult {
  /** Project structure information */
  structure: ProjectStructure;
  /** File counts by extension */
  fileCounts?: FileCount[];
  /** Formatted summary for AI context */
  summary: string;
  /** Timestamp of exploration */
  exploredAt: string;
}

/**
 * Default directories to ignore during exploration
 */
export const DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  '.cache',
  'tmp',
  'temp',
];

/**
 * Default file patterns to ignore
 */
export const DEFAULT_IGNORE_PATTERNS = [
  /^\.DS_Store$/,
  /^\.env/,
  /\.lock$/,
  /\.log$/,
  /\.min\.(js|css)$/,
];

/**
 * Configuration file markers for project type detection
 */
const CONFIG_FILE_MARKERS: Record<string, { projectType: ProjectType; weight: number }> = {
  'package.json': { projectType: 'node', weight: 1 },
  'tsconfig.json': { projectType: 'typescript', weight: 2 },
  'pyproject.toml': { projectType: 'python', weight: 2 },
  'setup.py': { projectType: 'python', weight: 1 },
  'requirements.txt': { projectType: 'python', weight: 1 },
  'Cargo.toml': { projectType: 'rust', weight: 2 },
  'go.mod': { projectType: 'go', weight: 2 },
  'pom.xml': { projectType: 'java', weight: 2 },
  'build.gradle': { projectType: 'java', weight: 2 },
  'Gemfile': { projectType: 'ruby', weight: 2 },
  'composer.json': { projectType: 'php', weight: 2 },
  '*.csproj': { projectType: 'dotnet', weight: 2 },
  '*.sln': { projectType: 'dotnet', weight: 2 },
};

/**
 * Source directory patterns by project type
 */
const SOURCE_DIR_PATTERNS: Record<ProjectType, string[]> = {
  node: ['src', 'lib', 'app', 'pages', 'components'],
  typescript: ['src', 'lib', 'app', 'pages', 'components'],
  python: ['src', 'lib', 'app', 'packages'],
  rust: ['src', 'lib'],
  go: ['cmd', 'pkg', 'internal', 'api'],
  java: ['src/main/java', 'src', 'app'],
  ruby: ['lib', 'app', 'src'],
  php: ['src', 'app', 'lib'],
  dotnet: ['src', 'lib', 'app'],
  unknown: ['src', 'lib', 'app'],
};

/**
 * Test directory patterns
 */
const TEST_DIR_PATTERNS = [
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'src/test',
  'src/__tests__',
];

/**
 * Documentation directory patterns
 */
const DOC_DIR_PATTERNS = ['docs', 'doc', 'documentation', 'wiki'];

/**
 * Entry point patterns
 */
const ENTRY_POINT_PATTERNS = [
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'app.ts',
  'app.js',
  'server.ts',
  'server.js',
  'main.py',
  'app.py',
  '__main__.py',
  'main.go',
  'main.rs',
  'lib.rs',
  'Main.java',
  'App.java',
  'Program.cs',
];

/**
 * Framework detection patterns from package.json dependencies
 */
const FRAMEWORK_PATTERNS: Record<string, { category: DetectedFramework['category']; name: string }> = {
  'react': { category: 'frontend', name: 'React' },
  'react-dom': { category: 'frontend', name: 'React' },
  'vue': { category: 'frontend', name: 'Vue.js' },
  'angular': { category: 'frontend', name: 'Angular' },
  '@angular/core': { category: 'frontend', name: 'Angular' },
  'svelte': { category: 'frontend', name: 'Svelte' },
  'next': { category: 'fullstack', name: 'Next.js' },
  'nuxt': { category: 'fullstack', name: 'Nuxt' },
  'gatsby': { category: 'fullstack', name: 'Gatsby' },
  'express': { category: 'backend', name: 'Express' },
  'fastify': { category: 'backend', name: 'Fastify' },
  'koa': { category: 'backend', name: 'Koa' },
  'hono': { category: 'backend', name: 'Hono' },
  'nestjs': { category: 'backend', name: 'NestJS' },
  '@nestjs/core': { category: 'backend', name: 'NestJS' },
  'jest': { category: 'testing', name: 'Jest' },
  'vitest': { category: 'testing', name: 'Vitest' },
  'mocha': { category: 'testing', name: 'Mocha' },
  'playwright': { category: 'testing', name: 'Playwright' },
  '@playwright/test': { category: 'testing', name: 'Playwright' },
  'cypress': { category: 'testing', name: 'Cypress' },
  'vite': { category: 'build', name: 'Vite' },
  'webpack': { category: 'build', name: 'Webpack' },
  'esbuild': { category: 'build', name: 'esbuild' },
  'rollup': { category: 'build', name: 'Rollup' },
  'tailwindcss': { category: 'frontend', name: 'Tailwind CSS' },
  'prisma': { category: 'backend', name: 'Prisma' },
  '@prisma/client': { category: 'backend', name: 'Prisma' },
  'drizzle-orm': { category: 'backend', name: 'Drizzle ORM' },
  'typeorm': { category: 'backend', name: 'TypeORM' },
  'sequelize': { category: 'backend', name: 'Sequelize' },
  'mongoose': { category: 'backend', name: 'Mongoose' },
};

/**
 * CI/CD configuration file patterns
 */
const CI_CONFIG_PATTERNS: Record<string, string> = {
  '.github/workflows': 'GitHub Actions',
  '.gitlab-ci.yml': 'GitLab CI',
  '.circleci': 'CircleCI',
  'Jenkinsfile': 'Jenkins',
  '.travis.yml': 'Travis CI',
  'azure-pipelines.yml': 'Azure Pipelines',
  'bitbucket-pipelines.yml': 'Bitbucket Pipelines',
};

/**
 * Check if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read directory contents safely
 */
async function readDirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/**
 * Read file contents safely
 */
async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Detect the primary project type
 */
export async function detectProjectType(rootDir: string): Promise<ProjectType> {
  const files = await readDirSafe(rootDir);
  const typeWeights = new Map<ProjectType, number>();

  for (const file of files) {
    // Check exact matches
    const marker = CONFIG_FILE_MARKERS[file];
    if (marker) {
      const currentWeight = typeWeights.get(marker.projectType) || 0;
      typeWeights.set(marker.projectType, currentWeight + marker.weight);
    }

    // Check pattern matches (e.g., *.csproj)
    for (const [pattern, markerInfo] of Object.entries(CONFIG_FILE_MARKERS)) {
      if (pattern.startsWith('*') && file.endsWith(pattern.slice(1))) {
        const currentWeight = typeWeights.get(markerInfo.projectType) || 0;
        typeWeights.set(markerInfo.projectType, currentWeight + markerInfo.weight);
      }
    }
  }

  // Find the type with highest weight
  let maxWeight = 0;
  let detectedType: ProjectType = 'unknown';

  for (const [type, weight] of typeWeights) {
    if (weight > maxWeight) {
      maxWeight = weight;
      detectedType = type;
    }
  }

  return detectedType;
}

/**
 * Detect frameworks from package.json
 */
export async function detectFrameworks(rootDir: string): Promise<DetectedFramework[]> {
  const packageJsonPath = join(rootDir, 'package.json');
  const content = await readFileSafe(packageJsonPath);

  if (!content) {
    return [];
  }

  try {
    const packageJson = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const frameworks: DetectedFramework[] = [];
    const seenFrameworks = new Set<string>();

    for (const [dep, version] of Object.entries(allDeps)) {
      const pattern = FRAMEWORK_PATTERNS[dep];
      if (pattern && !seenFrameworks.has(pattern.name)) {
        seenFrameworks.add(pattern.name);
        frameworks.push({
          name: pattern.name,
          category: pattern.category,
          version: version?.replace(/^[\^~]/, ''),
        });
      }
    }

    return frameworks;
  } catch {
    return [];
  }
}

/**
 * Find configuration files in the root directory
 */
export async function findConfigFiles(rootDir: string): Promise<string[]> {
  const files = await readDirSafe(rootDir);
  const configPatterns = [
    /^package\.json$/,
    /^tsconfig.*\.json$/,
    /^\.eslintrc/,
    /^eslint\.config/,
    /^\.prettierrc/,
    /^prettier\.config/,
    /^vite\.config/,
    /^webpack\.config/,
    /^rollup\.config/,
    /^jest\.config/,
    /^vitest\.config/,
    /^playwright\.config/,
    /^\.env\.example$/,
    /^docker-compose/,
    /^Dockerfile$/,
    /^Makefile$/,
    /^pyproject\.toml$/,
    /^setup\.py$/,
    /^setup\.cfg$/,
    /^requirements.*\.txt$/,
    /^Cargo\.toml$/,
    /^go\.mod$/,
    /^pom\.xml$/,
    /^build\.gradle/,
    /^Gemfile$/,
    /^composer\.json$/,
    /^\.gitignore$/,
  ];

  return files.filter(file => configPatterns.some(pattern => pattern.test(file)));
}

/**
 * Find source directories
 */
export async function findSourceDirectories(
  rootDir: string,
  projectType: ProjectType
): Promise<string[]> {
  const patterns = SOURCE_DIR_PATTERNS[projectType];
  const found: string[] = [];

  for (const pattern of patterns) {
    const dirPath = join(rootDir, pattern);
    if (await isDirectory(dirPath)) {
      found.push(pattern);
    }
  }

  return found;
}

/**
 * Find test directories
 */
export async function findTestDirectories(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  for (const pattern of TEST_DIR_PATTERNS) {
    const dirPath = join(rootDir, pattern);
    if (await isDirectory(dirPath)) {
      found.push(pattern);
    }
  }

  return found;
}

/**
 * Find documentation directories
 */
export async function findDocDirectories(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  for (const pattern of DOC_DIR_PATTERNS) {
    const dirPath = join(rootDir, pattern);
    if (await isDirectory(dirPath)) {
      found.push(pattern);
    }
  }

  return found;
}

/**
 * Find entry point files
 */
export async function findEntryPoints(
  rootDir: string,
  sourceDirectories: string[]
): Promise<string[]> {
  const found: string[] = [];

  // Check root directory
  const rootFiles = await readDirSafe(rootDir);
  for (const pattern of ENTRY_POINT_PATTERNS) {
    if (rootFiles.includes(pattern)) {
      found.push(pattern);
    }
  }

  // Check source directories
  for (const srcDir of sourceDirectories) {
    const srcPath = join(rootDir, srcDir);
    const srcFiles = await readDirSafe(srcPath);
    for (const pattern of ENTRY_POINT_PATTERNS) {
      if (srcFiles.includes(pattern)) {
        found.push(join(srcDir, pattern));
      }
    }
  }

  return found;
}

/**
 * Detect the package manager
 */
export async function detectPackageManager(
  rootDir: string
): Promise<ProjectStructure['packageManager']> {
  const files = await readDirSafe(rootDir);

  // Check for lock files (most specific first)
  if (files.includes('bun.lockb')) return 'bun';
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('package-lock.json')) return 'npm';

  // Check for other package managers
  if (files.includes('Cargo.lock')) return 'cargo';
  if (files.includes('go.sum')) return 'go';
  if (files.includes('requirements.txt') || files.includes('Pipfile.lock')) return 'pip';
  if (files.includes('pom.xml')) return 'maven';
  if (files.includes('build.gradle') || files.includes('build.gradle.kts')) return 'gradle';

  // Fallback: if package.json exists, default to npm
  if (files.includes('package.json')) return 'npm';

  return undefined;
}

/**
 * Check for git repository
 */
export async function hasGitRepo(rootDir: string): Promise<boolean> {
  return pathExists(join(rootDir, '.git'));
}

/**
 * Detect CI/CD configuration
 */
export async function detectCI(rootDir: string): Promise<{ hasCI: boolean; platform?: string }> {
  for (const [configPath, platform] of Object.entries(CI_CONFIG_PATTERNS)) {
    if (await pathExists(join(rootDir, configPath))) {
      return { hasCI: true, platform };
    }
  }
  return { hasCI: false };
}

/**
 * Count files by extension
 */
export async function countFilesByExtension(
  rootDir: string,
  options: ExplorationOptions = {}
): Promise<FileCount[]> {
  const ignoreDirs = options.ignoreDirs || DEFAULT_IGNORE_DIRS;
  const ignorePatterns = options.ignorePatterns || DEFAULT_IGNORE_PATTERNS;
  const maxDepth = options.maxDepth ?? 5;

  const counts = new Map<string, number>();

  async function traverse(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    const entries = await readDirSafe(dir);

    for (const entry of entries) {
      const entryPath = join(dir, entry);

      // Check if should ignore
      if (ignoreDirs.includes(entry)) continue;
      if (ignorePatterns.some(pattern => pattern.test(entry))) continue;

      if (await isDirectory(entryPath)) {
        await traverse(entryPath, depth + 1);
      } else {
        const ext = extname(entry) || '(no extension)';
        counts.set(ext, (counts.get(ext) || 0) + 1);
      }
    }
  }

  await traverse(rootDir, 0);

  // Sort by count descending
  return Array.from(counts.entries())
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Explore the project structure
 */
export async function exploreProject(
  rootDir: string,
  _options: ExplorationOptions = {}
): Promise<ProjectStructure> {
  // Note: _options reserved for future use (e.g., custom ignore patterns)
  const [
    projectType,
    frameworks,
    configFiles,
    hasGit,
    ciResult,
    packageManager,
  ] = await Promise.all([
    detectProjectType(rootDir),
    detectFrameworks(rootDir),
    findConfigFiles(rootDir),
    hasGitRepo(rootDir),
    detectCI(rootDir),
    detectPackageManager(rootDir),
  ]);

  const [sourceDirectories, testDirectories, docDirectories] = await Promise.all([
    findSourceDirectories(rootDir, projectType),
    findTestDirectories(rootDir),
    findDocDirectories(rootDir),
  ]);

  const entryPoints = await findEntryPoints(rootDir, sourceDirectories);

  return {
    rootDir,
    projectType,
    frameworks,
    configFiles,
    sourceDirectories,
    testDirectories,
    docDirectories,
    entryPoints,
    packageManager,
    hasGit,
    hasCI: ciResult.hasCI,
    ciPlatform: ciResult.platform,
  };
}

/**
 * Format project structure as a summary string for AI context
 */
export function formatStructureSummary(structure: ProjectStructure): string {
  const lines: string[] = [];

  lines.push('## Project Overview\n');

  // Project type
  const typeNames: Record<ProjectType, string> = {
    node: 'Node.js',
    typescript: 'TypeScript',
    python: 'Python',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    ruby: 'Ruby',
    php: 'PHP',
    dotnet: '.NET',
    unknown: 'Unknown',
  };
  lines.push(`**Type:** ${typeNames[structure.projectType]} project`);

  // Package manager
  if (structure.packageManager) {
    lines.push(`**Package Manager:** ${structure.packageManager}`);
  }

  // Git
  lines.push(`**Version Control:** ${structure.hasGit ? 'Git repository' : 'No Git detected'}`);

  // CI/CD
  if (structure.hasCI) {
    lines.push(`**CI/CD:** ${structure.ciPlatform || 'Yes'}`);
  }

  // Frameworks
  if (structure.frameworks.length > 0) {
    lines.push('\n### Frameworks & Libraries\n');
    for (const fw of structure.frameworks) {
      const version = fw.version ? ` (${fw.version})` : '';
      lines.push(`- **${fw.name}**${version} - ${fw.category}`);
    }
  }

  // Directory structure
  lines.push('\n### Directory Structure\n');

  if (structure.sourceDirectories.length > 0) {
    lines.push(`**Source:** ${structure.sourceDirectories.join(', ')}`);
  }

  if (structure.testDirectories.length > 0) {
    lines.push(`**Tests:** ${structure.testDirectories.join(', ')}`);
  }

  if (structure.docDirectories.length > 0) {
    lines.push(`**Documentation:** ${structure.docDirectories.join(', ')}`);
  }

  // Entry points
  if (structure.entryPoints.length > 0) {
    lines.push(`\n**Entry Points:** ${structure.entryPoints.join(', ')}`);
  }

  // Config files
  if (structure.configFiles.length > 0) {
    lines.push('\n### Configuration Files\n');
    lines.push(structure.configFiles.join(', '));
  }

  return lines.join('\n');
}

/**
 * Format file counts as a summary string
 */
export function formatFileCountsSummary(fileCounts: FileCount[], limit = 10): string {
  if (fileCounts.length === 0) {
    return 'No files found.';
  }

  const lines: string[] = ['### File Distribution\n'];
  const topCounts = fileCounts.slice(0, limit);
  const total = fileCounts.reduce((sum, fc) => sum + fc.count, 0);

  for (const { extension, count } of topCounts) {
    const percentage = ((count / total) * 100).toFixed(1);
    lines.push(`- ${extension}: ${count} files (${percentage}%)`);
  }

  if (fileCounts.length > limit) {
    const remaining = fileCounts.slice(limit).reduce((sum, fc) => sum + fc.count, 0);
    lines.push(`- Other: ${remaining} files`);
  }

  lines.push(`\n**Total:** ${total} files`);

  return lines.join('\n');
}

/**
 * Perform full codebase exploration
 */
export async function exploreCodebase(
  rootDir: string,
  options: ExplorationOptions = {}
): Promise<ExplorationResult> {
  const structure = await exploreProject(rootDir, options);

  let fileCounts: FileCount[] | undefined;
  if (options.includeFileCounts !== false) {
    fileCounts = await countFilesByExtension(rootDir, options);
  }

  // Build the summary
  const summaryParts: string[] = [formatStructureSummary(structure)];

  if (fileCounts) {
    summaryParts.push('\n' + formatFileCountsSummary(fileCounts));
  }

  return {
    structure,
    fileCounts,
    summary: summaryParts.join('\n'),
    exploredAt: new Date().toISOString(),
  };
}

/**
 * Get a quick codebase summary (minimal exploration)
 */
export async function getQuickSummary(rootDir: string): Promise<string> {
  const structure = await exploreProject(rootDir, { maxDepth: 2 });
  return formatStructureSummary(structure);
}
