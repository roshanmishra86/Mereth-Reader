import { describe, it, expect } from 'vitest';
import {
  extractWikiLinks,
  formatWikiLink,
  renderWikiLinks,
} from './noteLinks';

describe('noteLinks utility functions', () => {
  it('extracts note, document, and annotation IDs from markdown text', () => {
    const md = `
# Cognitive Architecture

See [[mereth:note/note-123|Working Memory Capacity]] for details.
Refer to document [[mereth:doc/doc-456]] on page 12.
Also review highlight [[mereth:ann/ann-789|Miller's Law quote]].
Duplicate mention [[mereth:note/note-123]].
    `;

    const extracted = extractWikiLinks(md);
    expect(extracted.targetNoteIds).toEqual(['note-123']);
    expect(extracted.targetDocIds).toEqual(['doc-456']);
    expect(extracted.targetAnnIds).toEqual(['ann-789']);
  });

  it('formats wiki-links with and without custom labels', () => {
    expect(formatWikiLink('note', 'note-abc')).toBe('[[mereth:note/note-abc]]');
    expect(formatWikiLink('note', 'note-abc', 'Concept Title')).toBe('[[mereth:note/note-abc|Concept Title]]');
    expect(formatWikiLink('doc', 'doc-1', 'Principles of Psychology')).toBe('[[mereth:doc/doc-1|Principles of Psychology]]');
  });

  it('renders wiki-links for display by resolving titles', () => {
    const md = 'Check [[mereth:note/note-1]] and [[mereth:note/note-2|Custom Label]] and [[mereth:note/unknown-id]].';
    const titles = new Map<string, string>([['note-1', 'Active Recall']]);

    const rendered = renderWikiLinks(md, (kind, id) => {
      if (kind === 'note') return titles.get(id) ?? null;
      return null;
    });

    expect(rendered).toBe('Check Active Recall and Custom Label and [note:unknown-id].');
  });
});
