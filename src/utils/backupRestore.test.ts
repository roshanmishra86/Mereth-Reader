import { describe, expect, it } from 'vitest';
import { createJsonBackupArchive } from './exportManifest';
import { assertBackupRestoreIntegrity, previewBackupRestore } from './backupRestore';

describe('backup restore validation (4.12)', () => {
  it('previews counts for a valid clean-profile restore archive', () => {
    const backup = createJsonBackupArchive({
      documents: [],
      annotations: [],
      assets: [],
      notes: [],
      note_revisions: [],
      links: [],
      prompts: [],
      review_events: [],
      review_schedules: [],
      settings: {},
      provenance: {},
    });
    const preview = previewBackupRestore(backup);
    expect(preview.valid).toBe(true);
    expect(preview.counts.documents).toBe(0);
    expect(assertBackupRestoreIntegrity(backup)).toBe(backup);
  });

  it('rejects malformed backup archives before restore', () => {
    expect(() => assertBackupRestoreIntegrity({ schema: 'wrong' })).toThrow(/Unsupported JSON backup schema/);
  });
});
