import { describe, it, expect } from 'vitest';
import {
  roleLabel,
  roleBadgeClass,
  filterSearchResultsByRole,
  NoteSearchResult,
} from './noteSearch';

describe('noteSearch utility functions', () => {
  it('returns appropriate role labels and badge classes', () => {
    expect(roleLabel('title')).toBe('Title');
    expect(roleLabel('prose')).toBe('Prose');
    expect(roleLabel('evidence_quote')).toBe('Source Quote');
    expect(roleLabel('evidence_comment')).toBe('Comment');
    expect(roleLabel('tag')).toBe('Tag');

    expect(roleBadgeClass('title')).toBe('badge-role-title');
    expect(roleBadgeClass('prose')).toBe('badge-role-prose');
  });

  it('filters search results by selected text roles', () => {
    const results: NoteSearchResult[] = [
      {
        note_id: 'n1',
        note_title: 'Recall Dynamics',
        note_type: 'concept',
        text_role: 'title',
        matched_text: 'Recall Dynamics',
        snippet: 'Recall Dynamics',
      },
      {
        note_id: 'n1',
        note_title: 'Recall Dynamics',
        note_type: 'concept',
        text_role: 'prose',
        matched_text: 'Active recall strengthens synapses.',
        snippet: 'Active recall strengthens synapses.',
      },
      {
        note_id: 'n2',
        note_title: 'Working Memory',
        note_type: 'concept',
        text_role: 'tag',
        matched_text: 'recall',
        snippet: 'Tag: recall',
      },
    ];

    const titleOnly = filterSearchResultsByRole(results, ['title']);
    expect(titleOnly).toHaveLength(1);
    expect(titleOnly[0].text_role).toBe('title');

    const titleAndTag = filterSearchResultsByRole(results, ['title', 'tag']);
    expect(titleAndTag).toHaveLength(2);

    const emptyFilter = filterSearchResultsByRole(results, []);
    expect(emptyFilter).toHaveLength(3);
  });
});
