import type { ReviewPromptRecord, PromptType } from './promptTypes';

/** Task 4.6 — repeated-failure repair choices (FR-11.12). */

export const REPEATED_FAILURE_THRESHOLD = 3;

export type PromptRepairAction = 'add_cue' | 'split' | 'narrow' | 'retire';

export interface PromptRepairOption {
  action: PromptRepairAction;
  label: string;
  description: string;
}

export interface PromptRepairResult {
  action: PromptRepairAction;
  prompts: ReviewPromptRecord[];
  requiresInput: boolean;
}

export const PROMPT_REPAIR_OPTIONS: readonly PromptRepairOption[] = [
  { action: 'add_cue', label: 'Add a cue', description: 'Add a small retrieval anchor without changing the answer.' },
  { action: 'split', label: 'Split prompt', description: 'Break a compound prompt into two focused prompts.' },
  { action: 'narrow', label: 'Narrow focus', description: 'Replace a broad question with one specific concept.' },
  { action: 'retire', label: 'Stop reviewing', description: 'Retire this prompt without affecting your review history.' },
];

export function hasRepeatedFailures(failureCount: number): boolean {
  return Number.isFinite(failureCount) && failureCount >= REPEATED_FAILURE_THRESHOLD;
}

export function getPromptRepairOptions(failureCount: number): readonly PromptRepairOption[] {
  return hasRepeatedFailures(failureCount) ? PROMPT_REPAIR_OPTIONS : [];
}

export function buildPromptRepair(
  prompt: ReviewPromptRecord,
  action: PromptRepairAction,
  input?: { cue?: string; questions?: readonly [string, string]; question?: string; promptType?: PromptType },
): PromptRepairResult {
  const now = new Date().toISOString();
  const base = { ...prompt, updated_at: now };

  switch (action) {
    case 'add_cue':
      return {
        action,
        prompts: [{ ...base, cue: input?.cue?.trim() ?? prompt.cue }],
        requiresInput: !input?.cue?.trim(),
      };
    case 'split':
      if (!input?.questions || input.questions.length !== 2 || input.questions.some((question) => !question.trim())) {
        return { action, prompts: [base], requiresInput: true };
      }
      return {
        action,
        prompts: [
          { ...base, question: input.questions[0].trim() },
          { ...base, id: `${prompt.id}-split-2`, question: input.questions[1].trim() },
        ],
        requiresInput: false,
      };
    case 'narrow':
      return {
        action,
        prompts: [{ ...base, question: input?.question?.trim() ?? prompt.question, prompt_type: input?.promptType ?? prompt.prompt_type }],
        requiresInput: !input?.question?.trim(),
      };
    case 'retire':
      return { action, prompts: [{ ...base, status: 'retired' }], requiresInput: false };
  }
}
