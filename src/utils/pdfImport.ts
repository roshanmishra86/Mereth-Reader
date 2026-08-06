import { APP_CONFIG } from './appConfig';

export type OwnershipMode = 'open_in_place' | 'managed_library';

export interface DocumentRecord {
  id: string;
  title: string;
  filepath: string;
  original_filepath?: string;
  sha256_hash: string;
  page_count: number;
  created_at: string;
  updated_at: string;
  provenance: string;
  ownership_mode: OwnershipMode;
  is_missing?: boolean;
  author?: string;
  subject?: string;
  keywords?: string;
  creation_date?: string;
  doi?: string;
  isbn?: string;
  is_favourite?: boolean;
  is_archived?: boolean;
  last_opened_at?: string;
  tags?: string[];
  collections?: string[];
  is_password_protected?: boolean;
  is_malformed?: boolean;
  is_scanned?: boolean;
  is_version_mismatch?: boolean;
}

export interface ImportCandidate {
  filepath: string;
  filename: string;
  sha256_hash: string;
  file_size_bytes: number;
  exists: boolean;
  page_count?: number;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingDocument?: DocumentRecord;
}

export interface RelocateValidationResult {
  valid: boolean;
  hashMatches: boolean;
  error?: string;
}

/**
 * Returns the recommended onboarding default ownership mode per ADR R0.8 (OQ-9).
 */
export function getDefaultOwnershipMode(): OwnershipMode {
  return APP_CONFIG.oq9_libraryModel; // 'open_in_place'
}

/**
 * Validates whether a file path has a valid PDF extension and basic non-empty path formatting.
 */
export function validatePdfFilePath(filepath: string): { valid: boolean; error?: string } {
  if (!filepath || !filepath.trim()) {
    return { valid: false, error: 'File path cannot be empty.' };
  }
  const cleanPath = filepath.trim().replace(/\\/g, '/');
  const filename = cleanPath.split('/').pop() ?? '';
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext !== 'pdf') {
    return { valid: false, error: `Invalid file format '.${ext ?? ''}'. Only PDF documents are supported.` };
  }

  return { valid: true };
}

/**
 * Checks if a candidate SHA-256 fingerprint matches any existing document in the library.
 */
export function detectDuplicateDocument(
  sha256Hash: string,
  existingDocuments: DocumentRecord[]
): DuplicateCheckResult {
  if (!sha256Hash) {
    return { isDuplicate: false };
  }

  const match = existingDocuments.find(doc => doc.sha256_hash === sha256Hash);
  if (match) {
    return {
      isDuplicate: true,
      existingDocument: match,
    };
  }

  return { isDuplicate: false };
}

/**
 * Creates a formatted DocumentRecord object for persistence.
 * For managed_library mode, preserves original_filepath as metadata (FR-7.2).
 */
export function createDocumentRecord(params: {
  id?: string;
  title?: string;
  filepath: string;
  original_filepath?: string;
  sha256_hash: string;
  page_count: number;
  ownership_mode: OwnershipMode;
}): DocumentRecord {
  const now = new Date().toISOString();
  const id = params.id ?? `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const filename = extractFilenameFromPath(params.filepath);
  const title = params.title ?? (filename ? filename.replace(/\.pdf$/i, '') : 'Untitled Document');

  return {
    id,
    title,
    filepath: params.filepath,
    original_filepath: params.ownership_mode === 'managed_library' ? (params.original_filepath ?? params.filepath) : undefined,
    sha256_hash: params.sha256_hash,
    page_count: params.page_count,
    created_at: now,
    updated_at: now,
    provenance: params.ownership_mode,
    ownership_mode: params.ownership_mode,
    is_missing: false,
  };
}

/**
 * Verifies if an in-place file exists on disk.
 */
export function verifyInPlaceFileStatus(
  filepath: string,
  fileExistsFn: (path: string) => boolean
): { exists: boolean; filepath: string } {
  const exists = fileExistsFn(filepath);
  return { exists, filepath };
}

/**
 * Validates a relocated file picked during the "Locate file" flow (PRD §7.2).
 */
export function validateRelocatedFile(
  expectedHash: string,
  newFileHash: string
): RelocateValidationResult {
  if (!newFileHash) {
    return { valid: false, hashMatches: false, error: 'Could not compute hash for relocated file.' };
  }

  const hashMatches = expectedHash === newFileHash;
  return {
    valid: true,
    hashMatches,
    error: hashMatches ? undefined : 'Fingerprint differs from original document record. The file contents may have changed.',
  };
}

/**
 * Utility to extract filename from both Windows and POSIX file paths.
 */
export function extractFilenameFromPath(filepath: string): string {
  if (!filepath) return '';
  const normalized = filepath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? '';
}

/**
 * Utility to format file byte sizes into human readable strings.
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = Math.round((bytes / Math.pow(1024, i)) * 10) / 10;
  return `${size} ${units[i]}`;
}
