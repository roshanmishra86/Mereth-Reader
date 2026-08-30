export type ExportFormat = 'markdown' | 'json_backup' | 'review_csv' | 'review_tsv' | 'annotated_pdf';

export type ExportDestinationKind = 'directory' | 'file';
export type ExportCapability = 'ready' | 'native_writer_required';

export interface ExportDefinition {
  format: ExportFormat;
  label: string;
  description: string;
  destinationKind: ExportDestinationKind;
  defaultFileName?: string;
  extensions?: readonly string[];
  capability: ExportCapability;
}

/**
 * The frontend cannot make an `invoke` atomic or cancellable by itself. This
 * contract keeps those guarantees explicit until every native writer reports
 * its staging/commit lifecycle and accepts cancellation requests.
 */
export interface ExportJobContract {
  progress: 'native_events_required';
  cancellation: 'native_cooperation_required';
  atomicCommit: 'native_staging_and_rename_required';
  cleanupAfterFailure: 'native_writer_required';
}

export const EXPORT_JOB_CONTRACT: ExportJobContract = {
  progress: 'native_events_required',
  cancellation: 'native_cooperation_required',
  atomicCommit: 'native_staging_and_rename_required',
  cleanupAfterFailure: 'native_writer_required',
};

export const EXPORT_DEFINITIONS: readonly ExportDefinition[] = [
  {
    format: 'markdown',
    label: 'Markdown package',
    description: 'Notes, sources, assets, reviews, and a manifest readable without Mereth.',
    destinationKind: 'directory',
    capability: 'ready',
  },
  {
    format: 'json_backup',
    label: 'JSON backup',
    description: 'Versioned documents, annotations, notes, links, prompts, review history, settings, and provenance.',
    destinationKind: 'file',
    defaultFileName: 'mereth-backup.json',
    extensions: ['json'],
    capability: 'ready',
  },
  {
    format: 'review_csv',
    label: 'Review CSV',
    description: 'Prompt text, source references, and the most recent review response for spreadsheets.',
    destinationKind: 'file',
    defaultFileName: 'mereth-review-prompts.csv',
    extensions: ['csv'],
    capability: 'ready',
  },
  {
    format: 'review_tsv',
    label: 'Review TSV',
    description: 'The same review data in tab-separated form for tools that prefer TSV.',
    destinationKind: 'file',
    defaultFileName: 'mereth-review-prompts.tsv',
    extensions: ['tsv'],
    capability: 'ready',
  },
  {
    format: 'annotated_pdf',
    label: 'Annotated PDF copy',
    description: 'A separate PDF copy with supported highlights and area annotations; it never replaces the source PDF.',
    destinationKind: 'file',
    defaultFileName: 'annotated-copy.pdf',
    extensions: ['pdf'],
    capability: 'native_writer_required',
  },
] as const;

export function getExportDefinition(format: ExportFormat): ExportDefinition {
  const definition = EXPORT_DEFINITIONS.find((item) => item.format === format);
  if (!definition) throw new Error(`Unknown export format: ${format}`);
  return definition;
}

export type ExportProgressStage = 'idle' | 'choosing_destination' | 'inspecting_destination' | 'writing' | 'committing' | 'completed' | 'failed';

export interface ExportProgress {
  stage: ExportProgressStage;
  message: string;
}

export function exportProgressFor(stage: ExportProgressStage): ExportProgress {
  const message: Record<ExportProgressStage, string> = {
    idle: '',
    choosing_destination: 'Choosing a native destination…',
    inspecting_destination: 'Checking the destination for existing files…',
    writing: 'Writing export data…',
    committing: 'Finishing the export…',
    completed: 'Export completed.',
    failed: 'Export failed. The frontend cannot verify cleanup or destination recovery; inspect the destination before retrying.',
  };
  return { stage, message: message[stage] };
}

export function nativeWriterUnavailableMessage(format: ExportFormat): string | null {
  return getExportDefinition(format).capability === 'native_writer_required'
    ? 'Annotated PDF copy export is not connected to a native writer in this build. No destination was selected and no source PDF was changed.'
    : null;
}
