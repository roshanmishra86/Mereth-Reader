import type { ReviewPromptRecord } from './promptTypes';
import type { ReviewEventRecord } from './reviewIo';

export type ReviewExportFormat = 'csv' | 'tsv';

export interface ReviewExportRow {
  prompt: ReviewPromptRecord;
  sourceReference: string;
  events: ReviewEventRecord[];
}

function escapeCsv(value: string, delimiter: ',' | '\t'): string {
  if (delimiter === '\t') return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  const needsQuote = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function exportReviewPromptsTable(rows: readonly ReviewExportRow[], format: ReviewExportFormat): string {
  const delimiter = format === 'csv' ? ',' : '\t';
  const header = ['prompt_id', 'type', 'status', 'question', 'answer', 'cue', 'source_reference', 'last_outcome', 'last_response'];
  const lines = rows.map((row) => {
    const last = row.events[0] ?? null;
    return [
      row.prompt.id,
      row.prompt.prompt_type,
      row.prompt.status,
      row.prompt.question,
      row.prompt.answer,
      row.prompt.cue,
      row.sourceReference,
      last?.outcome ?? '',
      last?.user_response ?? '',
    ].map((value) => escapeCsv(String(value), delimiter)).join(delimiter);
  });
  return `${header.join(delimiter)}\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}
