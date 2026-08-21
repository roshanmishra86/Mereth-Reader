import { describe, expect, it } from 'vitest';
import { parseDeepLinkTS } from './launchRouting';
import { resolveDeepLinkUiAction } from './deepLinkRouter';

describe('deepLinkRouter', () => {
  it('routes document links to reader page and annotation state', () => {
    const parsed = parseDeepLinkTS('mereth://document/doc-1?page=4&annotation=ann-1');
    expect(parsed.route && resolveDeepLinkUiAction(parsed.route)).toEqual({
      destination: 'reader',
      documentId: 'doc-1',
      page: 4,
      annotationId: 'ann-1',
    });
  });

  it('routes note and review links to concrete selected targets', () => {
    const note = parseDeepLinkTS('mereth://note/note-1').route;
    const review = parseDeepLinkTS('mereth://review/prompt-1').route;
    expect(note && resolveDeepLinkUiAction(note)).toEqual({ destination: 'notes', noteId: 'note-1' });
    expect(review && resolveDeepLinkUiAction(review)).toEqual({ destination: 'review', reviewPromptId: 'prompt-1' });
  });
});
