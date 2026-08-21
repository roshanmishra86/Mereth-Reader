import { describe, expect, it } from 'vitest';
import { resolveDestinationSafety, suggestCopyPath } from './destinationSafety';

describe('destination safety (FR-14.6)', () => {
  it('writes directly to new or idempotent destinations', () => {
    expect(resolveDestinationSafety({ path: 'out.csv', exists: false }).action).toBe('write');
    expect(resolveDestinationSafety({ path: 'out.csv', exists: true, currentSha256: 'a', nextSha256: 'a' }).action).toBe('write');
  });

  it('requires confirmation with a diff preview when content differs', () => {
    const decision = resolveDestinationSafety({ path: 'out.csv', exists: true, currentSha256: 'a', nextSha256: 'b', currentPreview: 'old', nextPreview: 'new' });
    expect(decision.action).toBe('confirm_overwrite');
    expect(decision.action === 'confirm_overwrite' ? decision.diffPreview : '').toContain('old');
  });

  it('suggests copy names without overwriting', () => {
    expect(suggestCopyPath('reviews.csv')).toBe('reviews copy.csv');
    expect(suggestCopyPath('reviews')).toBe('reviews copy');
  });
});
