import type { AnnotationRecord } from './annotationTypes';

export const SESSION_SYNTHESIS_QUESTIONS = [
  'What central claim or problem did this session clarify?',
  'What finding was surprising or easy to misremember?',
  'How does this connect to something you already know?',
  'What question, limitation, or uncertainty remains open?',
] as const;

export type SessionSynthesisQuestionId = 0 | 1 | 2 | 3;

export interface SessionSynthesisAnswer {
  questionId: SessionSynthesisQuestionId;
  question: string;
  answer: string;
}

export interface SessionSynthesisState {
  answers: SessionSynthesisAnswer[];
  completed: boolean;
  sourceVisible: boolean;
}

export function createSessionSynthesisState(): SessionSynthesisState {
  return {
    answers: SESSION_SYNTHESIS_QUESTIONS.map((question, index) => ({
      questionId: index as SessionSynthesisQuestionId,
      question,
      answer: '',
    })),
    completed: false,
    sourceVisible: false,
  };
}

export function updateSynthesisAnswer(
  state: SessionSynthesisState,
  questionId: SessionSynthesisQuestionId,
  answer: string
): SessionSynthesisState {
  return {
    ...state,
    answers: state.answers.map((item) => item.questionId === questionId ? { ...item, answer } : item),
  };
}

export function completeSynthesisAttempt(state: SessionSynthesisState): SessionSynthesisState {
  return { ...state, completed: true, sourceVisible: true };
}

export function skipSynthesisAttempt(state: SessionSynthesisState): SessionSynthesisState {
  return { ...state, completed: false, sourceVisible: true };
}

export function buildSynthesisNoteMarkdown(
  state: SessionSynthesisState,
  annotations: readonly AnnotationRecord[]
): string {
  const answerLines = state.answers
    .filter((item) => item.answer.trim())
    .map((item) => `## ${item.question}\n\n${item.answer.trim()}`)
    .join('\n\n');
  const sourceLines = annotations
    .map((annotation) => {
      const text = annotation.quote || annotation.comment || annotation.annotation_type;
      return `- p. ${annotation.page_label || annotation.page_index + 1}: ${text}`;
    })
    .join('\n');
  return [answerLines, sourceLines ? `## Session sources\n\n${sourceLines}` : ''].filter(Boolean).join('\n\n');
}
