/**
 * Task 4.4 — Review prompt types and advisory quality linting (PRD R4, FR-11.1 - FR-11.5).
 */

import type { Provenance } from './evidenceTypes';

export type PromptType = 'focused_qa' | 'explanation' | 'application' | 'contrast' | 'cloze';
export type PromptStatus = 'draft' | 'adopted' | 'retired';

export interface ReviewPromptRecord {
  id: string;
  annotation_id?: string | null;
  note_id?: string | null;
  prompt_type: PromptType;
  question: string;
  answer: string;
  status: PromptStatus;
  adopted_at?: string | null;
  cue: string;
  priority: number;
  paused_at?: string | null;
  created_at: string;
  updated_at: string;
  provenance: Provenance;
}

export interface PromptQualityLintIssue {
  level: 'warning' | 'info';
  message: string;
}

export interface PromptQualityLintResult {
  isValid: boolean;
  issues: PromptQualityLintIssue[];
}

export const PROMPT_TYPE_DESCRIPTIONS: Record<PromptType, { label: string; description: string }> = {
  focused_qa: {
    label: 'Focused Q&A',
    description: 'A direct single-concept question with a concise, definitive answer.',
  },
  explanation: {
    label: 'Explanation / Mechanism',
    description: 'Explains why or how a mechanism or phenomenon functions.',
  },
  application: {
    label: 'Application / Scenario',
    description: 'Asks how to apply a principle to solve a specific problem or case.',
  },
  contrast: {
    label: 'Contrast / Distinction',
    description: 'Differentiates between two easily confused concepts or terms.',
  },
  cloze: {
    label: 'Cloze Deletion',
    description: 'Fill-in-the-blank passage using {{c1::target text}} syntax.',
  },
};

const VAGUE_CUE_PATTERNS = [
  /^what is this\??$/i,
  /^define\??$/i,
  /^explain\??$/i,
  /^notes?\??$/i,
  /^remember\??$/i,
  /^test\??$/i,
];

const BINARY_QUESTION_PATTERNS = [
  /^(is|are|was|were|do|does|did|can|could|should|would|will|has|have|had)\b/i,
];

/**
 * Advisory, non-blocking prompt quality lint (FR-11.4).
 * Checks for atomic scope, single-question structure, non-vague cues, and valid cloze formatting.
 */
export function lintPromptQuality(prompt: Partial<ReviewPromptRecord>): PromptQualityLintResult {
  const issues: PromptQualityLintIssue[] = [];
  const question = (prompt.question || '').trim();
  const answer = (prompt.answer || '').trim();
  const cue = (prompt.cue || '').trim();
  const type = prompt.prompt_type || 'focused_qa';

  if (!question) {
    issues.push({
      level: 'warning',
      message: 'Question cannot be empty.',
    });
    return { isValid: false, issues };
  }

  // 1. Length & Atomicity (FR-11.4)
  if (question.length < 10) {
    issues.push({
      level: 'warning',
      message: 'Question is very short. Ensure it provides enough context to test recall.',
    });
  } else if (question.length > 300) {
    issues.push({
      level: 'info',
      message: 'Question is quite long (>300 chars). Consider splitting into multiple focused cards.',
    });
  }

  // 2. Compound question check (multiple question marks)
  const questionMarkCount = (question.match(/\?/g) || []).length;
  if (questionMarkCount > 1) {
    issues.push({
      level: 'info',
      message: 'Multiple question marks detected. Best practice is one atomic question per prompt.',
    });
  }

  if (type !== 'cloze' && BINARY_QUESTION_PATTERNS.some((p) => p.test(question))) {
    issues.push({
      level: 'info',
      message: 'Binary yes/no framing is usually weak. Ask for the mechanism, condition, or contrast.',
    });
  }

  // 3. Vague cue check
  if (cue && VAGUE_CUE_PATTERNS.some((p) => p.test(cue))) {
    issues.push({
      level: 'warning',
      message: 'Cue is vague. Provide a specific conceptual domain or anchor instead.',
    });
  }

  // 4. Cloze syntax validation
  if (type === 'cloze') {
    const clozeRegex = /\{\{c\d+::[^\}]+?\}\}/g;
    if (!clozeRegex.test(question) && !clozeRegex.test(answer)) {
      issues.push({
        level: 'warning',
        message: 'Cloze deletion prompts require {{c1::hidden text}} syntax in question or passage.',
      });
    }
  }

  return {
    isValid: true,
    issues,
  };
}

export function promptHasSource(prompt: Pick<ReviewPromptRecord, 'annotation_id' | 'note_id'>): boolean {
  return Boolean(prompt.annotation_id || prompt.note_id);
}

export function createDefaultPromptRecord(params: {
  id?: string;
  annotation_id?: string | null;
  note_id?: string | null;
  prompt_type?: PromptType;
  question?: string;
  answer?: string;
  cue?: string;
  status?: PromptStatus;
}): ReviewPromptRecord {
  const now = new Date().toISOString();
  return {
    id: params.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `prompt-${Date.now()}`),
    annotation_id: params.annotation_id ?? null,
    note_id: params.note_id ?? null,
    prompt_type: params.prompt_type ?? 'focused_qa', // focused_qa is default; cloze is NOT default (FR-11.2)
    question: params.question ?? '',
    answer: params.answer ?? '',
    status: params.status ?? 'draft', // answer stays Draft until explicitly adopted (FR-11.5)
    adopted_at: params.status === 'adopted' ? now : null,
    cue: params.cue ?? '',
    priority: 0,
    paused_at: null,
    created_at: now,
    updated_at: now,
    provenance: 'user_authored',
  };
}
