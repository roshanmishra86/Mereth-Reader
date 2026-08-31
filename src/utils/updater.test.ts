import { describe, expect, it } from 'vitest';
import { appendUpdateLog, consumeDownloadEvent, parseUpdateLog, shouldRunScheduledCheck, UPDATE_ENDPOINT, UPDATE_INTERVAL_MS } from './updater';

describe('updater policy', () => {
  it('checks only after consent and at the six hour boundary', () => {
    const now = Date.parse('2026-08-31T12:00:00Z');
    expect(shouldRunScheduledCheck(null, null, now)).toBe(false);
    expect(shouldRunScheduledCheck('declined', null, now)).toBe(false);
    expect(shouldRunScheduledCheck('accepted', null, now)).toBe(true);
    expect(shouldRunScheduledCheck('accepted', new Date(now - UPDATE_INTERVAL_MS + 1).toISOString(), now)).toBe(false);
    expect(shouldRunScheduledCheck('accepted', new Date(now - UPDATE_INTERVAL_MS).toISOString(), now)).toBe(true);
  });

  it('keeps only 50 sanitized endpoint-bound activity entries', () => {
    let entries = [] as ReturnType<typeof parseUpdateLog>;
    for (let i = 0; i < 55; i++) entries = appendUpdateLog(entries, { timestamp: new Date(i).toISOString(), operation: 'check', endpoint: UPDATE_ENDPOINT, result: 'no update' });
    expect(entries).toHaveLength(50);
    expect(parseUpdateLog(JSON.stringify([...entries, { timestamp: 'x', operation: 'check', endpoint: 'https://evil.test', result: 'x' }]))).toHaveLength(50);
  });

  it('tracks determinate and indeterminate downloads', () => {
    expect(consumeDownloadEvent({ downloaded: 0, total: null }, { event: 'Started', data: { contentLength: 100 } })).toEqual({ downloaded: 0, total: 100 });
    expect(consumeDownloadEvent({ downloaded: 5, total: null }, { event: 'Progress', data: { chunkLength: 7 } })).toEqual({ downloaded: 12, total: null });
  });
});
