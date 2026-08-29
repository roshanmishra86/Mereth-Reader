/**
 * Task 4.4 — Prompt Editor Modal for Remember actions (PRD R4, FR-11.1 - FR-11.5).
 *
 * Never silently creates a card (FR-11.1). Offers the 5 prompt types (FR-11.2),
 * links to source context (FR-11.3), provides real-time advisory quality linting (FR-11.4),
 * and preserves Draft status until explicit adoption (FR-11.5).
 */

import React, { useEffect, useState, useMemo } from 'react';
import type {
  PromptType,
  ReviewPromptRecord,
} from '../utils/promptTypes';
import {
  PROMPT_TYPE_DESCRIPTIONS,
  lintPromptQuality,
  createDefaultPromptRecord,
  promptHasSource,
} from '../utils/promptTypes';
import { createReviewPrompt, updateReviewPrompt } from '../utils/promptsIo';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface PromptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: Partial<ReviewPromptRecord> | null;
  sourceContext?: {
    title: string;
    quote?: string | null;
    annotationId?: string | null;
    noteId?: string | null;
  };
  onSaved?: (prompt: ReviewPromptRecord) => void;
}

export const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
  isOpen,
  onClose,
  initialPrompt,
  sourceContext,
  onSaved,
}) => {
  const [promptType, setPromptType] = useState<PromptType>(
    initialPrompt?.prompt_type ?? 'focused_qa'
  );
  const [question, setQuestion] = useState(initialPrompt?.question ?? '');
  const [answer, setAnswer] = useState(
    initialPrompt?.answer ?? (sourceContext?.quote ?? '')
  );
  const [cue, setCue] = useState(initialPrompt?.cue ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPromptType(initialPrompt?.prompt_type ?? 'focused_qa');
    setQuestion(initialPrompt?.question ?? '');
    setAnswer(initialPrompt?.answer ?? (sourceContext?.quote ?? ''));
    setCue(initialPrompt?.cue ?? '');
    setSaveError(null);
  }, [
    isOpen,
    initialPrompt?.id,
    initialPrompt?.prompt_type,
    initialPrompt?.question,
    initialPrompt?.answer,
    initialPrompt?.cue,
    sourceContext?.annotationId,
    sourceContext?.noteId,
    sourceContext?.quote,
  ]);

  // Advisory real-time quality linting (FR-11.4)
  const lintResult = useMemo(
    () =>
      lintPromptQuality({
        prompt_type: promptType,
        question,
        answer,
        cue,
      }),
    [promptType, question, answer, cue]
  );

  // U12: advisory lint is never blocking — "Keep anyway" hides the panel until
  // the issues change, and cue-related warnings get a one-click fix affordance.
  const [lintDismissed, setLintDismissed] = useState(false);
  const [dismissedIssueCount, setDismissedIssueCount] = useState(0);
  useEffect(() => {
    setLintDismissed(false);
    setDismissedIssueCount(0);
  }, [lintResult.issues.length]);

  const cueIssue = useMemo(
    () => lintResult.issues.find((issue) => issue.message.toLowerCase().includes('cue')) ?? null,
    [lintResult.issues]
  );
  const showLintPanel = lintResult.issues.length > 0 && !lintDismissed;

  if (!isOpen) return null;

  const handleSave = async (adopt: boolean) => {
    if (!question.trim()) return;

    const source = {
      annotation_id: initialPrompt?.annotation_id ?? sourceContext?.annotationId ?? null,
      note_id: initialPrompt?.note_id ?? sourceContext?.noteId ?? null,
    };
    if (!promptHasSource(source)) {
      setSaveError('A review prompt must stay linked to a source annotation, evidence block, or note.');
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    try {
      const record = createDefaultPromptRecord({
        id: initialPrompt?.id,
        annotation_id: source.annotation_id,
        note_id: source.note_id,
        prompt_type: promptType,
        question: question.trim(),
        answer: answer.trim(),
        cue: cue.trim(),
        status: adopt ? 'adopted' : 'draft',
      });

      let saved: ReviewPromptRecord;
      if (initialPrompt?.id) {
        saved = await updateReviewPrompt(record);
      } else {
        saved = await createReviewPrompt(record);
      }

      onSaved?.(saved);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save prompt.');
    } finally {
      setIsSaving(false);
    }
  };

  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="prompt-modal-title">
      <div ref={trapRef} className="modal-card prompt-editor-modal" style={{ maxWidth: '600px', width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 id="prompt-modal-title" style={{ margin: 0, fontSize: '16px' }}>
            {initialPrompt?.id ? 'Edit Review Prompt' : 'Remember: Author Prompt'}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            x
          </button>
        </div>

        {/* Source context reference (FR-11.3) */}
        {sourceContext && (
          <div
            style={{
              padding: '8px 10px',
              background: '#eae9e9',
              border: '1px solid rgba(32,30,29,.2)',
              borderRadius: '2px',
              marginBottom: '12px',
              fontSize: '11px',
            }}
          >
            <strong style={{ display: 'block', color: '#201e1d', marginBottom: '2px' }}>
              Source: {sourceContext.title}
            </strong>
            {sourceContext.quote && (
              <blockquote style={{ margin: '4px 0 0', fontStyle: 'italic', color: '#444141' }}>
              "{sourceContext.quote}"
              </blockquote>
            )}
          </div>
        )}

        {/* Prompt Type Selector (FR-11.2 - Cloze is NOT default) */}
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            Prompt Type:
          </label>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {(Object.keys(PROMPT_TYPE_DESCRIPTIONS) as PromptType[]).map((type) => {
              const meta = PROMPT_TYPE_DESCRIPTIONS[type];
              const isSelected = promptType === type;
              return (
                <button
                  key={type}
                  type="button"
                  className={`button micro ${isSelected ? 'primary' : ''}`}
                  onClick={() => setPromptType(type)}
                  title={meta.description}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <small style={{ display: 'block', color: '#605d5d', fontSize: '10px', marginTop: '4px' }}>
            {PROMPT_TYPE_DESCRIPTIONS[promptType].description}
          </small>
        </div>

        {/* Question Input */}
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label htmlFor="prompt-question" style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            Question / Prompt:
          </label>
          <textarea
            id="prompt-question"
            rows={3}
            placeholder={
              promptType === 'cloze'
                ? 'e.g. {{c1::Retrieval practice}} enhances delayed retention.'
                : 'State an atomic question testing key concept recall...'
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ width: '100%', padding: '8px', fontSize: '12px', resize: 'vertical' }}
            autoFocus
          />
        </div>

        {/* Answer Input (Draft / Adopted per FR-11.5) */}
        {promptType !== 'cloze' && (
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label htmlFor="prompt-answer" style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
              Target Answer:
            </label>
            <textarea
              id="prompt-answer"
              rows={3}
              placeholder="Concise, definitive answer or supporting explanation..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              style={{ width: '100%', padding: '8px', fontSize: '12px', resize: 'vertical' }}
            />
          </div>
        )}

        {/* Optional Cue / Context Anchor */}
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label htmlFor="prompt-cue" style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
            Retrieval Cue / Domain (optional):
          </label>
          <input
            id="prompt-cue"
            type="text"
            placeholder="e.g. Cognitive Psychology · Memory Models"
            value={cue}
            onChange={(e) => setCue(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: '12px' }}
          />
        </div>

        {/* Advisory Quality Lint (FR-11.4) — advisory only; Keep anyway dismisses until issues change */}
        {showLintPanel && (
          <div
            style={{
              padding: '8px 10px',
              background: '#fff3cd',
              border: '1px solid #ffeeba',
              borderRadius: '2px',
              marginBottom: '14px',
              fontSize: '11px',
              color: '#856404',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '2px' }}>
              Prompt Quality Tips (Advisory):
            </strong>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {lintResult.issues.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
              {(cueIssue || !cue.trim()) && (
                <button
                  type="button"
                  className="button micro"
                  onClick={() => {
                    if (cueIssue) setCue('');
                    document.getElementById('prompt-cue')?.focus();
                  }}
                  title={cueIssue ? 'Clear the vague cue and enter a specific conceptual anchor' : 'Jump to the retrieval cue field'}
                >
                  Add a cue
                </button>
              )}
              <button
                type="button"
                className="button micro"
                onClick={() => {
                  setLintDismissed(true);
                  setDismissedIssueCount(lintResult.issues.length);
                }}
                title="These tips are advisory — keep the prompt as written"
              >
                Keep anyway
              </button>
            </div>
          </div>
        )}
        {lintDismissed && dismissedIssueCount > 0 && (
          <p style={{ margin: '0 0 10px', fontSize: '10px', color: '#856404' }}>
            {dismissedIssueCount} quality tip{dismissedIssueCount === 1 ? '' : 's'} kept as written.
          </p>
        )}

        {saveError && (
          <div
            role="alert"
            style={{
              padding: '8px 10px',
              background: '#f8d7da',
              border: '1px solid #f5c2c7',
              borderRadius: '2px',
              marginBottom: '14px',
              fontSize: '11px',
              color: '#842029',
            }}
          >
            {saveError}
          </div>
        )}

        {/* Actions (FR-11.5: Draft vs Adopted) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(32,30,29,.2)', paddingTop: '10px' }}>
          <button type="button" className="button" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={!question.trim() || isSaving}
            onClick={() => handleSave(false)}
            title="Save as Draft (will not appear in active review queue until adopted)"
          >
            Save as Draft
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!question.trim() || isSaving}
            onClick={() => handleSave(true)}
            title="Adopt Prompt (activates card for spaced repetition review)"
          >
            Adopt Prompt (FR-11.5)
          </button>
        </div>
      </div>
    </div>
  );
};
