import type { AnnotationRecord, AnnotationAssetRecord } from './annotationTypes';
import type { DocumentRecord } from './pdfImport';
import type { NoteRecord, NoteRevisionRecord } from './notesTypes';
import type { NoteLinkRecord } from './noteLinks';
import type { ReviewEventRecord } from './reviewIo';
import type { ReviewPromptRecord } from './promptTypes';
import type { EvidenceBlockRecord } from './evidenceTypes';

export const MARKDOWN_PACKAGE_SCHEMA = 'mereth.markdown-package';
export const JSON_BACKUP_SCHEMA = 'mereth.json-backup';
export const EXPORT_SCHEMA_VERSION = 1;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ExportManifestEntry { id: string; path: string; kind: 'markdown' | 'asset' | 'review'; provenance?: string | null; }
export interface MarkdownPackageManifest {
  schema: typeof MARKDOWN_PACKAGE_SCHEMA; schema_version: number; exported_at: string;
  directories: ['notes', 'sources', 'assets', 'reviews'];
  notes: ExportManifestEntry[]; sources: ExportManifestEntry[]; assets: ExportManifestEntry[]; reviews: ExportManifestEntry[];
}

export interface JsonBackupArchive {
  schema: typeof JSON_BACKUP_SCHEMA; schema_version: number; exported_at: string;
  documents: DocumentRecord[]; annotations: AnnotationRecord[]; assets: AnnotationAssetRecord[];
  asset_files?: Record<string, string>; evidence_blocks?: EvidenceBlockRecord[];
  notes: NoteRecord[]; note_revisions: NoteRevisionRecord[]; links: NoteLinkRecord[];
  prompts: ReviewPromptRecord[]; review_events: ReviewEventRecord[]; review_schedules: JsonValue[];
  settings: Record<string, string>; provenance: Record<string, string | null>;
}

function validRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !/^[a-z]:[\\/]/i.test(path) && !path.split('/').some((part) => part === '..' || part === '');
}
function validEntry(entry: ExportManifestEntry): boolean { return Boolean(entry.id.trim()) && validRelativePath(entry.path); }

export function createMarkdownPackageManifest(input: Partial<Omit<MarkdownPackageManifest, 'schema' | 'schema_version' | 'exported_at'>> & { exported_at?: string } = {}): MarkdownPackageManifest {
  return { schema: MARKDOWN_PACKAGE_SCHEMA, schema_version: EXPORT_SCHEMA_VERSION, exported_at: input.exported_at ?? new Date().toISOString(), directories: ['notes', 'sources', 'assets', 'reviews'], notes: input.notes ?? [], sources: input.sources ?? [], assets: input.assets ?? [], reviews: input.reviews ?? [] };
}

export function validateMarkdownPackageManifest(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['Manifest must be an object.'] };
  const manifest = value as Partial<MarkdownPackageManifest>;
  if (manifest.schema !== MARKDOWN_PACKAGE_SCHEMA) errors.push('Unsupported Markdown package schema.');
  if (manifest.schema_version !== EXPORT_SCHEMA_VERSION) errors.push('Unsupported Markdown package version.');
  if (JSON.stringify(manifest.directories) !== JSON.stringify(['notes', 'sources', 'assets', 'reviews'])) errors.push('Manifest directories are incomplete or reordered.');
  for (const key of ['notes', 'sources', 'assets', 'reviews'] as const) {
    if (!Array.isArray(manifest[key])) errors.push(`${key} must be an array.`);
    else if (manifest[key].some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.path !== 'string' || !validEntry(entry))) errors.push(`${key} contains an invalid entry.`);
  }
  return { valid: errors.length === 0, errors };
}

export function serializeMarkdownPackageManifest(manifest: MarkdownPackageManifest): string {
  const result = validateMarkdownPackageManifest(manifest);
  if (!result.valid) throw new Error(result.errors.join(' '));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function validateJsonBackupArchive(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['Backup must be an object.'] };
  const backup = value as Partial<JsonBackupArchive>;
  if (backup.schema !== JSON_BACKUP_SCHEMA) errors.push('Unsupported JSON backup schema.');
  if (backup.schema_version !== EXPORT_SCHEMA_VERSION) errors.push('Unsupported JSON backup version.');
  for (const key of ['documents', 'annotations', 'assets', 'notes', 'note_revisions', 'links', 'prompts', 'review_events', 'review_schedules'] as const) if (!Array.isArray(backup[key])) errors.push(`${key} must be an array.`);
  if (!backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) errors.push('settings must be an object.');
  if (!backup.provenance || typeof backup.provenance !== 'object' || Array.isArray(backup.provenance)) errors.push('provenance must be an object.');
  return { valid: errors.length === 0, errors };
}

export function createJsonBackupArchive(input: Omit<JsonBackupArchive, 'schema' | 'schema_version' | 'exported_at'> & { exported_at?: string }): JsonBackupArchive {
  return { ...input, schema: JSON_BACKUP_SCHEMA, schema_version: EXPORT_SCHEMA_VERSION, exported_at: input.exported_at ?? new Date().toISOString() };
}

export function serializeJsonBackupArchive(backup: JsonBackupArchive): string {
  const result = validateJsonBackupArchive(backup);
  if (!result.valid) throw new Error(result.errors.join(' '));
  return `${JSON.stringify(backup, null, 2)}\n`;
}
