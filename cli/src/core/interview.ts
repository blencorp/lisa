/**
 * Interview orchestrator - manages the interview flow between user and AI
 */

export interface InterviewOptions {
  feature: string;
  firstPrinciples?: boolean;
  contextFiles?: string[];
  provider?: string;
}

export interface InterviewResult {
  success: boolean;
  outputPath?: string;
}

export async function runInterview(_options: InterviewOptions): Promise<InterviewResult> {
  // TODO: Implement interview functionality using InterviewOrchestrator
  return {
    success: false,
  };
}

// Re-export orchestrator types and functions
export {
  type StructuredQuestion,
  type ParsedAIResponse,
  type OrchestratorConfig,
  type TurnResult,
  type InterviewCompletionResult,
  type OrchestratorEvent,
  type OrchestratorEventHandler,
  STRUCTURED_MARKERS,
  generateSystemPrompt,
  parseAIResponse,
  InterviewOrchestrator,
  createOrchestratorFromState,
} from './orchestrator.js';

// Re-export context loading types and functions
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
} from './context.js';

// Re-export PRD generator types and functions
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
} from './prd.js';

// Re-export error recovery types and functions
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
} from './error-recovery.js';
