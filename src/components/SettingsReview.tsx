import { useState } from 'react';
import type { ReviewQueuePreferences } from '../utils/queueControls';

interface SettingsReviewProps {
  preferences?: ReviewQueuePreferences;
  onChange?: (preferences: ReviewQueuePreferences) => void;
}

const DEFAULTS: ReviewQueuePreferences = { dailyCardLimit: 20, dailyTimeLimitMinutes: 15, queuePaused: false };

export function SettingsReview({ preferences = DEFAULTS, onChange }: SettingsReviewProps) {
  const [draft, setDraft] = useState(preferences);
  const update = (patch: Partial<ReviewQueuePreferences>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange?.(next);
  };

  return (
    <div className="settings-review-view">
      <span className="eyebrow">FR-11.10 FR-11.11</span>
      <h1>Review queue</h1>
      <p>Set a calm daily limit. Cards beyond the limit remain due for another day; there are no streaks to lose.</p>
      <div className="destination-rule" />
      <section className="setting-group">
        <h3>Daily budget</h3>
        <label className="field-label" htmlFor="review-card-limit">Cards per day</label>
        <input id="review-card-limit" type="number" min={0} max={999} value={draft.dailyCardLimit} onChange={(event) => update({ dailyCardLimit: Number(event.target.value) })} />
        <label className="field-label" htmlFor="review-time-limit">Minutes per day</label>
        <input id="review-time-limit" type="number" min={0} max={1440} value={draft.dailyTimeLimitMinutes} onChange={(event) => update({ dailyTimeLimitMinutes: Number(event.target.value) })} />
      </section>
      <section className="setting-group">
        <h3>Queue state</h3>
        <label className="radio-row">
          <input type="checkbox" checked={draft.queuePaused} onChange={(event) => update({ queuePaused: event.target.checked })} />
          <span />
          <div><b>Pause review queue</b><small>Reading and note-taking stay available while reviews wait.</small></div>
        </label>
      </section>
    </div>
  );
}
