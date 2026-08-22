/**
 * Typed domain models and validation heuristics for Notes (PRD R3, Tasks 4.1).
 *
 * Implements:
 * - Three distinct note types: source, concept, scratch (FR-10.3)
 * - Concept title guidance: complete claim or question heuristics (FR-10.4)
 * - Revision tracking models (FR-10.8)
 */

export type NoteType = 'source' | 'concept' | 'scratch';

export interface NoteRecord {
  id: string;
  note_type: NoteType;
  title: string;
  body_markdown: string;
  document_id?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  provenance: string;
  original_provenance?: string | null;
}

export interface NoteRevisionRecord {
  id: string;
  note_id: string;
  revision_number: number;
  title: string;
  body_markdown: string;
  created_at: string;
  provenance: string;
  original_provenance?: string | null;
}

export interface ConceptTitleGuidanceResult {
  isStrongTitle: boolean;
  isQuestion: boolean;
  isClaim: boolean;
  suggestion?: string;
}

/**
 * Evaluates concept note title quality (FR-10.4).
 * Encourages a complete claim or question without blocking save.
 */
export function validateConceptTitleGuidance(title: string): ConceptTitleGuidanceResult {
  const trimmed = title.trim();
  if (!trimmed) {
    return {
      isStrongTitle: false,
      isQuestion: false,
      isClaim: false,
      suggestion: 'Enter a complete claim or question for this concept.',
    };
  }

  // Question heuristic
  const questionWords = /^(why|how|what|when|where|which|who|whom|whose|is|are|can|could|should|would|does|do|did)\b/i;
  const isQuestion = trimmed.endsWith('?') || questionWords.test(trimmed);

  if (isQuestion) {
    return {
      isStrongTitle: true,
      isQuestion: true,
      isClaim: false,
    };
  }

  // Claim heuristic: needs a verb or predicate structure (at least 3 words)
  const words = trimmed.split(/\s+/).filter(Boolean);
  const commonVerbs = /\b(is|are|was|were|enhances|improves|causes|leads|requires|produces|creates|prevents|reduces|increases|correlates|outperforms|strengthens|weakens|depends|results|drives)\b/i;

  const hasVerb = commonVerbs.test(trimmed);
  const isClaim = words.length >= 3 && hasVerb;

  if (isClaim) {
    return {
      isStrongTitle: true,
      isQuestion: false,
      isClaim: true,
    };
  }

  if (words.length <= 2) {
    return {
      isStrongTitle: false,
      isQuestion: false,
      isClaim: false,
      suggestion: 'Tip: State a complete claim with a verb (e.g. "Testing enhances delayed retention") or formulate as a question.',
    };
  }

  return {
    isStrongTitle: true,
    isQuestion: false,
    isClaim: true,
  };
}

/**
 * Builds a new in-memory NoteRecord with defaults.
 */
export function createDefaultNoteRecord(params: {
  id?: string;
  note_type: NoteType;
  title?: string;
  body_markdown?: string;
  document_id?: string | null;
  provenance?: string;
}): NoteRecord {
  const now = new Date().toISOString();
  return {
    id: params.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`),
    note_type: params.note_type,
    title: params.title ?? '',
    body_markdown: params.body_markdown ?? '',
    document_id: params.document_id ?? null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    provenance: params.provenance ?? 'user_authored',
    original_provenance: null,
  };
}
