import { useState } from 'react';
import type { AnnotationRecord } from '../utils/annotationTypes';
import {
  buildSynthesisNoteMarkdown,
  completeSynthesisAttempt,
  createSessionSynthesisState,
  skipSynthesisAttempt,
  updateSynthesisAnswer,
} from '../utils/sessionSynthesis';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface SessionSynthesisModalProps {
  isOpen: boolean;
  annotations: AnnotationRecord[];
  onClose: () => void;
  onSaveNote: (title: string, bodyMarkdown: string) => Promise<void> | void;
}

export function SessionSynthesisModal({
  isOpen,
  annotations,
  onClose,
  onSaveNote,
}: SessionSynthesisModalProps) {
  const [state, setState] = useState(() => createSessionSynthesisState());
  const [isSaving, setIsSaving] = useState(false);
  const trapRef = useFocusTrap<HTMLElement>({ isOpen, onClose });
  if (!isOpen) return null;

  const reveal = () => setState((prev) => completeSynthesisAttempt(prev));
  const skip = () => setState((prev) => skipSynthesisAttempt(prev));
  const save = async () => {
    setIsSaving(true);
    try {
      await onSaveNote('Session synthesis', buildSynthesisNoteMarkdown(state, annotations));
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="session-synthesis-title">
      <section ref={trapRef} className="modal prompt-modal">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close synthesis">x</button>
        <span className="eyebrow">Optional recall</span>
        <h2 id="session-synthesis-title">End-of-session synthesis</h2>
        <p>Answer from memory first. Session annotations stay hidden until you reveal or skip.</p>

        {state.answers.map((item) => (
          <label className="field-label" key={item.questionId}>
            {item.question}
            <textarea
              value={item.answer}
              onChange={(event) => setState((prev) => updateSynthesisAnswer(prev, item.questionId, event.target.value))}
            />
          </label>
        ))}

        {state.sourceVisible && (
          <div className="evidence-block">
            <b>Session annotations</b>
            {annotations.length === 0 ? (
              <small>No annotations were created in this session.</small>
            ) : (
              annotations.slice(0, 8).map((annotation) => (
                <small key={annotation.id}>p. {annotation.page_label || annotation.page_index + 1}: {annotation.quote || annotation.comment || annotation.annotation_type}</small>
              ))
            )}
          </div>
        )}

        <div className="modal-actions">
          {!state.sourceVisible && <button className="button" type="button" onClick={skip}>Skip and show sources</button>}
          {!state.sourceVisible && <button className="button primary" type="button" onClick={reveal}>Reveal session sources</button>}
          {state.sourceVisible && <button className="button" type="button" onClick={onClose}>Close</button>}
          {state.sourceVisible && (
            <button className="button primary" type="button" onClick={() => void save()} disabled={isSaving}>
              Save as synthesis note
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

