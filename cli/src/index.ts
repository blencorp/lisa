/**
 * Lisa CLI - AI-Powered Planning Interview Tool
 * Main entry point for programmatic usage
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
export const VERSION = packageJson.version;

export { runInterview } from './core/interview.js';

// Export context loading functionality
export {
  type ContextFileResult,
  type ContextLoadResult,
  type ContextLoadOptions,
  DEFAULT_MAX_FILE_SIZE,
  SUPPORTED_EXTENSIONS,
  isSupportedExtension,
  resolveFilePath,
  fileExists,
  getFileSize,
  loadContextFile,
  formatFileContent,
  loadContextFiles,
  validateContextPaths,
  formatContextErrors,
} from './core/context.js';

// Export exploration functionality
export {
  type ProjectType,
  type DetectedFramework,
  type ProjectStructure,
  type ExplorationOptions,
  type FileCount,
  type ExplorationResult,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_PATTERNS,
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
} from './core/exploration.js';

// Export PRD generator functionality
export {
  type UserStory,
  type PRDData,
  type PRDGeneratorOptions,
  type PRDGenerationResult,
  validatePRDData,
  validateSlug,
  normalizeSlug,
  formatUserStory,
  generateMarkdown,
  getPRDPath,
  writePRDMarkdown,
  generatePRDFromCompletion,
} from './core/prd.js';

// Export error recovery functionality
export {
  type ErrorCategory,
  type StateSaveResult,
  type ErrorRecoveryOptions,
  type ErrorRecoveryResult,
  type RetryOptions,
  InterviewError,
  NetworkError,
  ProviderError,
  ProcessError,
  StateError,
  TimeoutError,
  UserCancelledError,
  classifyError,
  trySaveState,
  withErrorRecovery,
  withRetry,
  safeExecute,
  formatErrorForUser,
  isRecoverableError,
  getErrorCategory,
} from './core/error-recovery.js';

// Export CLI prompt and progress indicator functionality
export {
  type PromptResult,
  type PromptOptions,
  type Spinner,
  type InterviewPhaseType,
  type ProgressState,
  type PhaseConfig,
  type ProgressMessages,
  type ProgressIndicatorOptions,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  PHASE_CONFIGS,
  DEFAULT_PROGRESS_MESSAGES,
  formatHeader,
  formatOption,
  validateQuestion,
  buildChoices,
  formatResponse,
  promptSingleSelect,
  promptMultiSelect,
  promptQuestion,
  promptFreeText,
  renderAIText,
  renderPhase,
  createSpinner,
  ProgressIndicator,
  createProgressIndicator,
  renderSeparator,
  renderProgressSummary,
  renderWelcomeBanner,
  renderCompletionBanner,
  renderErrorBanner,
} from './cli/prompt.js';
