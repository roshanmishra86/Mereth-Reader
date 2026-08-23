import { useState } from 'react';
import type { ReviewPromptRecord } from '../utils/promptTypes';
import { buildPromptRepair, getPromptRepairOptions, type PromptRepairAction } from '../utils/promptRepair';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface PromptRepairModalProps {
  isOpen: boolean;
  prompt: ReviewPromptRecord;
  failureCount: number;
  onClose: () => void;
  onRepair: (result: ReturnType<typeof buildPromptRepair>) => void;
}

export function PromptRepairModal({ isOpen, prompt, failureCount, onClose, onRepair }: PromptRepairModalProps) {
  const [action, setAction] = useState<PromptRepairAction>('add_cue');
  const [input, setInput] = useState('');
  const [secondInput, setSecondInput] = useState('');
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });
  const options = getPromptRepairOptions(failureCount);
  if (!isOpen || options.length === 0) return null;

  const submit = () => {
    const result = action === 'split'
      ? buildPromptRepair(prompt, action, { questions: [input, secondInput] })
      : action === 'narrow'
        ? buildPromptRepair(prompt, action, { question: input })
        : buildPromptRepair(prompt, action, { cue: input });
    onRepair(action === 'retire' ? buildPromptRepair(prompt, action) : result);
    if (action === 'retire' || !result.requiresInput) onClose();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="prompt-repair-title">
      <div ref={trapRef} className="modal prompt-modal">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close prompt repair">x</button>
        <span className="eyebrow">FR-11.12 repeated failure</span>
        <h2 id="prompt-repair-title">Repair this prompt</h2>
        <p>This prompt has failed {failureCount} times. Choose a repair; the queue will not punish you by shrinking its interval forever.</p>
        <div role="radiogroup" aria-label="Prompt repair options">
          {options.map((option) => (
            <label className={`import-choice ${action === option.action ? 'selected' : ''}`} key={option.action}>
              <input type="radio" name="prompt-repair" checked={action === option.action} onChange={() => setAction(option.action)} />
              <span><b>{option.label}</b><small>{option.description}</small></span>
            </label>
          ))}
        </div>
        {action !== 'retire' && (
          <label className="field-label" htmlFor="prompt-repair-input">
            {action === 'add_cue' ? 'New cue' : action === 'narrow' ? 'Narrow question' : 'First focused question'}
            <textarea id="prompt-repair-input" value={input} onChange={(event) => setInput(event.target.value)} />
          </label>
        )}
        {action === 'split' && (
          <label className="field-label" htmlFor="prompt-repair-second-input">
            Second focused question
            <textarea id="prompt-repair-second-input" value={secondInput} onChange={(event) => setSecondInput(event.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="button" onClick={submit}>{action === 'retire' ? 'Stop reviewing' : 'Apply repair'}</button>
        </div>
      </div>
    </div>
  );
}
