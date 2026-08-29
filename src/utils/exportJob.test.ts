import { describe, expect, it } from 'vitest';
import {
  EXPORT_DEFINITIONS,
  EXPORT_JOB_CONTRACT,
  exportProgressFor,
  getExportDefinition,
  nativeWriterUnavailableMessage,
} from './exportJob';

describe('export job contract', () => {
  it('lists every v1 export without claiming the unconnected PDF writer is ready', () => {
    expect(EXPORT_DEFINITIONS.map(({ format }) => format)).toEqual([
      'markdown', 'json_backup', 'review_csv', 'review_tsv', 'annotated_pdf',
    ]);
    expect(getExportDefinition('annotated_pdf').capability).toBe('native_writer_required');
    expect(nativeWriterUnavailableMessage('annotated_pdf')).toMatch(/not connected/i);
  });

  it('keeps native atomicity and cancellation requirements explicit', () => {
    expect(EXPORT_JOB_CONTRACT.atomicCommit).toBe('native_staging_and_rename_required');
    expect(EXPORT_JOB_CONTRACT.cancellation).toBe('native_cooperation_required');
  });

  it('maps user-visible progress without inventing a cancellation state', () => {
    expect(exportProgressFor('inspecting_destination').message).toMatch(/Checking/);
    expect(exportProgressFor('failed').message).toMatch(/cannot verify/i);
  });
});
