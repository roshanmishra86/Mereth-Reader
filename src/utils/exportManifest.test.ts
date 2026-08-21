import { describe, expect, it } from 'vitest';
import { createJsonBackupArchive, createMarkdownPackageManifest, serializeMarkdownPackageManifest, validateJsonBackupArchive, validateMarkdownPackageManifest } from './exportManifest';

describe('Export schemas (FR-14.2 / FR-14.4)', () => {
  it('creates and serializes the stable Markdown package manifest', () => {
    const manifest = createMarkdownPackageManifest({ notes: [{ id: 'note-1', path: 'notes/note-1.md', kind: 'markdown' }] });
    expect(validateMarkdownPackageManifest(manifest).valid).toBe(true);
    expect(serializeMarkdownPackageManifest(manifest)).toContain('"schema": "mereth.markdown-package"');
    expect(manifest.directories).toEqual(['notes', 'sources', 'assets', 'reviews']);
  });

  it('rejects traversal and absolute asset paths', () => {
    const result = validateMarkdownPackageManifest(createMarkdownPackageManifest({ assets: [{ id: 'asset-1', path: '../secret.png', kind: 'asset' }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('assets');
  });

  it('requires every backup collection and preserves optional response-capable review events', () => {
    const backup = createJsonBackupArchive({ documents: [], annotations: [], assets: [], notes: [], note_revisions: [], links: [], prompts: [], review_events: [{ id: 'event-1', prompt_id: 'p-1', reviewed_at: 'now', outcome: 'good', duration_ms: 1000, user_response: 'I recalled it.', provenance: 'user_authored' }], review_schedules: [], settings: {}, provenance: {} });
    expect(validateJsonBackupArchive(backup).valid).toBe(true);
    expect(backup.review_events[0].user_response).toBe('I recalled it.');
    const broken = { ...backup, notes: undefined };
    expect(validateJsonBackupArchive(broken).valid).toBe(false);
  });
});
