/**
 * Resilient State Matrix (PRD §17.6, Appendix A).
 * Defines the 18-condition taxonomy of user and error states, ensuring that every state:
 * 1. Reports honest data.
 * 2. Preserves prior user work.
 * 3. Identifies what remains usable.
 * 4. Offers a safe, deterministic next action.
 * Strict TypeScript without `any`.
 */

export type ResilientStateKey =
  | 'first_run'
  | 'empty'
  | 'loading'
  | 'success'
  | 'cancellation'
  | 'no_results'
  | 'permission_denied'
  | 'moved_file'
  | 'duplicate_import'
  | 'version_mismatch'
  | 'malformed_pdf'
  | 'encrypted_pdf'
  | 'scanned_pdf'
  | 'disk_full_autosave'
  | 'migration_failure'
  | 'export_conflict'
  | 'corrupt_cache_rebuild'
  | 'restore_failure';

export type ResilientStateCategory =
  | 'lifecycle'
  | 'query_and_search'
  | 'document_integrity'
  | 'storage_and_io'
  | 'backup_and_migration';

export interface ResilientAction {
  id: string;
  label: string;
  isPrimary: boolean;
  destructive?: boolean;
  description: string;
}

export interface ResilientStateDescriptor {
  key: ResilientStateKey;
  category: ResilientStateCategory;
  title: string;
  description: string;
  preservedData: string;
  usableFeatures: string[];
  suggestedActions: ResilientAction[];
}

export interface ResilientEvaluationInput {
  documentCount?: number;
  searchQuery?: string;
  searchResultsCount?: number;
  jobState?: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  isEncrypted?: boolean;
  isMalformed?: boolean;
  hasTextLayer?: boolean;
  fileHashMatched?: boolean;
  fileExists?: boolean;
  diskFreeBytes?: number;
  cacheValid?: boolean;
  backupValid?: boolean;
}

/**
 * Full 18-state resilience specification catalog.
 */
export const RESILIENT_STATE_CATALOG: Record<ResilientStateKey, ResilientStateDescriptor> = {
  first_run: {
    key: 'first_run',
    category: 'lifecycle',
    title: 'Welcome to Mereth Reader',
    description: 'Fresh application profile initialized with empty SQLite database.',
    preservedData: 'Default configurations and empty library tables initialized.',
    usableFeatures: ['Import PDF', 'Configure Settings', 'View Shortcuts'],
    suggestedActions: [
      {
        id: 'import_first_pdf',
        label: 'Import PDF',
        isPrimary: true,
        description: 'Open file picker to import your first PDF document.',
      },
    ],
  },
  empty: {
    key: 'empty',
    category: 'lifecycle',
    title: 'No Documents in Current View',
    description: 'Current collection or filter contains zero items.',
    preservedData: 'All existing collections, tags, and notes remain intact.',
    usableFeatures: ['Clear Filter', 'Switch Collection', 'Import PDF'],
    suggestedActions: [
      {
        id: 'clear_view_filter',
        label: 'Clear Filters',
        isPrimary: true,
        description: 'Reset active filter tags to view all documents.',
      },
    ],
  },
  loading: {
    key: 'loading',
    category: 'lifecycle',
    title: 'Loading Document',
    description: 'Asynchronously parsing PDF structures, page trees, and text layers.',
    preservedData: 'Previous document tab state and annotation drafts retained.',
    usableFeatures: ['Cancel Loading', 'Switch Tab', 'Access Library'],
    suggestedActions: [
      {
        id: 'cancel_loading',
        label: 'Cancel',
        isPrimary: true,
        destructive: false,
        description: 'Safely abort document loading without corrupting session.',
      },
    ],
  },
  success: {
    key: 'success',
    category: 'lifecycle',
    title: 'Document Ready',
    description: 'Document outline, canvas render, and text layer fully synchronized.',
    preservedData: 'Full reading position, annotations, and outlines persisted.',
    usableFeatures: ['Read', 'Annotate', 'Search', 'Review', 'Export'],
    suggestedActions: [
      {
        id: 'begin_reading',
        label: 'Read',
        isPrimary: true,
        description: 'Navigate document pages and create annotations.',
      },
    ],
  },
  cancellation: {
    key: 'cancellation',
    category: 'lifecycle',
    title: 'Operation Cancelled',
    description: 'Background worker task aborted cleanly upon user request.',
    preservedData: 'Database transactions rolled back cleanly; zero partial records written.',
    usableFeatures: ['Retry Operation', 'Access Other Jobs', 'Return to Reader'],
    suggestedActions: [
      {
        id: 'restart_job',
        label: 'Restart Operation',
        isPrimary: true,
        description: 'Queue the cancelled background task again.',
      },
    ],
  },
  no_results: {
    key: 'no_results',
    category: 'query_and_search',
    title: 'No Matches Found',
    description: 'No text or notes matched the current search query.',
    preservedData: 'Original search query and document state preserved.',
    usableFeatures: ['Refine Search Query', 'Toggle Case Sensitivity', 'Clear Search'],
    suggestedActions: [
      {
        id: 'clear_search',
        label: 'Clear Search',
        isPrimary: true,
        description: 'Dismiss search query and reset highlight overlays.',
      },
    ],
  },
  permission_denied: {
    key: 'permission_denied',
    category: 'storage_and_io',
    title: 'File Access Denied',
    description: 'Operating system denied read or write permissions to the target path.',
    preservedData: 'Document metadata record remains preserved in SQLite library.',
    usableFeatures: ['Choose Alternate Directory', 'Locate File', 'View Cached Metadata'],
    suggestedActions: [
      {
        id: 'reselect_location',
        label: 'Choose Different Location',
        isPrimary: true,
        description: 'Select an accessible file path with proper OS permissions.',
      },
    ],
  },
  moved_file: {
    key: 'moved_file',
    category: 'storage_and_io',
    title: 'Document File Moved or Missing',
    description: 'The physical PDF file at the recorded filepath was not found on disk.',
    preservedData: 'All annotations, tags, reading history, and notes remain safe in SQLite.',
    usableFeatures: ['Locate File', 'Delete Record', 'Export Notes'],
    suggestedActions: [
      {
        id: 'locate_moved_file',
        label: 'Locate File',
        isPrimary: true,
        description: 'Browse disk to point to the relocated PDF and verify fingerprint.',
      },
      {
        id: 'delete_missing_record',
        label: 'Delete Record',
        isPrimary: false,
        destructive: true,
        description: 'Remove missing document record from library.',
      },
    ],
  },
  duplicate_import: {
    key: 'duplicate_import',
    category: 'document_integrity',
    title: 'Duplicate File Detected',
    description: 'A file with identical SHA-256 hash already exists in your library.',
    preservedData: 'Existing document record and all existing annotations preserved untouched.',
    usableFeatures: ['Open Existing Document', 'Replace Metadata', 'Cancel Import'],
    suggestedActions: [
      {
        id: 'open_existing',
        label: 'Open Existing Document',
        isPrimary: true,
        description: 'Jump directly to the existing library document.',
      },
    ],
  },
  version_mismatch: {
    key: 'version_mismatch',
    category: 'document_integrity',
    title: 'Document Version Mismatch',
    description: 'Selected file content hash differs from the original document record.',
    preservedData: 'All original annotations and text quotes are preserved and matched by quote text.',
    usableFeatures: ['Re-anchor Annotations', 'Ignore Hash Mismatch', 'Cancel Relocation'],
    suggestedActions: [
      {
        id: 'reanchor_annotations',
        label: 'Re-anchor Annotations',
        isPrimary: true,
        description: 'Match existing highlights against the new text layer via quote matching.',
      },
    ],
  },
  malformed_pdf: {
    key: 'malformed_pdf',
    category: 'document_integrity',
    title: 'Malformed PDF File',
    description: 'PDF structure is corrupted or missing standard trailer / xref tables.',
    preservedData: 'Document record retained; non-corrupt documents unaffected.',
    usableFeatures: ['Retry Parse', 'Close Document', 'Remove Record'],
    suggestedActions: [
      {
        id: 'retry_malformed',
        label: 'Retry Opening',
        isPrimary: true,
        description: 'Attempt fault-tolerant fallback parsing.',
      },
      {
        id: 'close_malformed',
        label: 'Close Document',
        isPrimary: false,
        description: 'Return to Library view safely.',
      },
    ],
  },
  encrypted_pdf: {
    key: 'encrypted_pdf',
    category: 'document_integrity',
    title: 'Password Protected PDF',
    description: 'Document requires decryption password to open.',
    preservedData: 'Document file remains intact on disk; password never stored in plaintext.',
    usableFeatures: ['Enter Password', 'Cancel Opening'],
    suggestedActions: [
      {
        id: 'prompt_password',
        label: 'Enter Password',
        isPrimary: true,
        description: 'Provide decryption password to unlock document content.',
      },
    ],
  },
  scanned_pdf: {
    key: 'scanned_pdf',
    category: 'document_integrity',
    title: 'Scanned Document (No Text Layer)',
    description: 'PDF contains raster images without an embedded OCR text stream.',
    preservedData: 'All pages render crisply via canvas; bookmarks and area captures supported.',
    usableFeatures: ['Area Capture', 'Page Bookmarks', 'Page Navigation', 'Zoom'],
    suggestedActions: [
      {
        id: 'enable_area_capture',
        label: 'Use Area Capture',
        isPrimary: true,
        description: 'Switch to one-drag visual area capture to highlight diagrams and tables.',
      },
    ],
  },
  disk_full_autosave: {
    key: 'disk_full_autosave',
    category: 'storage_and_io',
    title: 'Disk Space Exhausted During Save',
    description: 'Operating system reported full disk while persisting annotations or notes.',
    preservedData: 'In-memory dirty state buffer preserved; no truncated files written.',
    usableFeatures: ['Retry Save', 'Export In-Memory Notes', 'Manage Disk Space'],
    suggestedActions: [
      {
        id: 'retry_save',
        label: 'Retry Save',
        isPrimary: true,
        description: 'Attempt to flush in-memory write buffer to disk.',
      },
      {
        id: 'export_in_memory',
        label: 'Export Notes to Clipboard',
        isPrimary: false,
        description: 'Copy pending changes to clipboard to prevent any work loss.',
      },
    ],
  },
  migration_failure: {
    key: 'migration_failure',
    category: 'backup_and_migration',
    title: 'Database Migration Failed',
    description: 'Database schema upgrade failed during startup.',
    preservedData: 'Pre-migration SQLite database backup automatically preserved.',
    usableFeatures: ['Restore Pre-Migration Backup', 'Export Raw DB', 'Restart in Safe Mode'],
    suggestedActions: [
      {
        id: 'restore_migration_backup',
        label: 'Restore Backup',
        isPrimary: true,
        description: 'Revert to pre-migration SQLite backup file.',
      },
    ],
  },
  export_conflict: {
    key: 'export_conflict',
    category: 'storage_and_io',
    title: 'Export Destination File Exists',
    description: 'Target export file already exists on disk.',
    preservedData: 'Source annotations, notes, and PDF remain unaffected.',
    usableFeatures: ['Overwrite Existing File', 'Save with Unique Name', 'Cancel Export'],
    suggestedActions: [
      {
        id: 'rename_export',
        label: 'Save as New Name',
        isPrimary: true,
        description: 'Append timestamp or index to generate unique filename.',
      },
      {
        id: 'overwrite_export',
        label: 'Overwrite',
        isPrimary: false,
        destructive: true,
        description: 'Replace existing target file with new export.',
      },
    ],
  },
  corrupt_cache_rebuild: {
    key: 'corrupt_cache_rebuild',
    category: 'storage_and_io',
    title: 'Cache Inconsistency Detected',
    description: 'Page thumbnail or render cache is corrupted or stale.',
    preservedData: 'All primary SQLite database records and raw PDF files remain untouched.',
    usableFeatures: ['Rebuild Cache', 'Clear Cache', 'Continue Reading'],
    suggestedActions: [
      {
        id: 'rebuild_cache',
        label: 'Rebuild Cache',
        isPrimary: true,
        description: 'Evict stale cache entries and re-render thumbnails safely.',
      },
    ],
  },
  restore_failure: {
    key: 'restore_failure',
    category: 'backup_and_migration',
    title: 'Backup Restoration Failed',
    description: 'Supplied backup archive is invalid, malformed, or has checksum mismatch.',
    preservedData: 'Active library database untouched; zero destructive schema changes made.',
    usableFeatures: ['Select Another Backup', 'Inspect Backup Error', 'Cancel Restore'],
    suggestedActions: [
      {
        id: 'choose_other_backup',
        label: 'Choose Another File',
        isPrimary: true,
        description: 'Select a valid JSON backup file.',
      },
    ],
  },
};

/**
 * Determines the resilient state from runtime inputs and diagnostic telemetry.
 */
export function evaluateResilientState(input: ResilientEvaluationInput): ResilientStateDescriptor {
  // Check migration and restore failures
  if (input.errorCode === 'MIGRATION_FAILED') {
    return RESILIENT_STATE_CATALOG.migration_failure;
  }
  if (input.backupValid === false || input.errorCode === 'RESTORE_CORRUPT') {
    return RESILIENT_STATE_CATALOG.restore_failure;
  }

  // Check storage & I/O states
  if (input.diskFreeBytes !== undefined && input.diskFreeBytes <= 0) {
    return RESILIENT_STATE_CATALOG.disk_full_autosave;
  }
  if (input.errorCode === 'PERMISSION_DENIED') {
    return RESILIENT_STATE_CATALOG.permission_denied;
  }
  if (input.fileExists === false) {
    return RESILIENT_STATE_CATALOG.moved_file;
  }
  if (input.cacheValid === false) {
    return RESILIENT_STATE_CATALOG.corrupt_cache_rebuild;
  }

  // Check document integrity states
  if (input.isEncrypted) {
    return RESILIENT_STATE_CATALOG.encrypted_pdf;
  }
  if (input.isMalformed) {
    return RESILIENT_STATE_CATALOG.malformed_pdf;
  }
  if (input.fileHashMatched === false) {
    return RESILIENT_STATE_CATALOG.version_mismatch;
  }
  if (input.hasTextLayer === false) {
    return RESILIENT_STATE_CATALOG.scanned_pdf;
  }

  // Check job lifecycle
  if (input.jobState === 'cancelled') {
    return RESILIENT_STATE_CATALOG.cancellation;
  }
  if (input.jobState === 'in_progress') {
    return RESILIENT_STATE_CATALOG.loading;
  }

  // Check query / search states
  if (input.searchQuery && input.searchResultsCount === 0) {
    return RESILIENT_STATE_CATALOG.no_results;
  }

  // Check library view states
  if (input.documentCount === 0) {
    return RESILIENT_STATE_CATALOG.first_run;
  }

  return RESILIENT_STATE_CATALOG.success;
}

/**
 * Returns all 18 resilient state descriptors for audit and compliance inspection.
 */
export function getAllResilientStates(): ResilientStateDescriptor[] {
  return Object.values(RESILIENT_STATE_CATALOG);
}
