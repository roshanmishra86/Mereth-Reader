import type { JsonBackupArchive } from './exportManifest';
import { validateJsonBackupArchive } from './exportManifest';

export interface RestorePreview {
  valid: boolean;
  errors: string[];
  counts: Record<string, number>;
}

const COLLECTION_KEYS = [
  'documents',
  'annotations',
  'assets',
  'notes',
  'note_revisions',
  'links',
  'prompts',
  'review_events',
  'review_schedules',
] as const;

export function previewBackupRestore(value: unknown): RestorePreview {
  const result = validateJsonBackupArchive(value);
  if (!result.valid) return { valid: false, errors: result.errors, counts: {} };
  const backup = value as JsonBackupArchive;
  return {
    valid: true,
    errors: [],
    counts: Object.fromEntries(COLLECTION_KEYS.map((key) => [key, backup[key].length])),
  };
}

export function assertBackupRestoreIntegrity(value: unknown): JsonBackupArchive {
  const preview = previewBackupRestore(value);
  if (!preview.valid) {
    throw new Error(preview.errors.join(' '));
  }
  return value as JsonBackupArchive;
}

