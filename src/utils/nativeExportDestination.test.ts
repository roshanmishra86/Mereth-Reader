import { describe, expect, it } from 'vitest';
import { getNativeDestinationOptions } from './nativeExportDestination';

describe('native export destination options', () => {
  it('uses a folder chooser only for Markdown packages', () => {
    expect(getNativeDestinationOptions('markdown')).toEqual({ directory: true });
  });

  it('uses extension-constrained file destinations for backups and review tables', () => {
    expect(getNativeDestinationOptions('json_backup')).toMatchObject({ defaultPath: 'mereth-backup.json', filters: [{ extensions: ['json'] }] });
    expect(getNativeDestinationOptions('review_csv')).toMatchObject({ defaultPath: 'mereth-review-prompts.csv', filters: [{ extensions: ['csv'] }] });
    expect(getNativeDestinationOptions('review_tsv')).toMatchObject({ defaultPath: 'mereth-review-prompts.tsv', filters: [{ extensions: ['tsv'] }] });
    expect(getNativeDestinationOptions('annotated_pdf')).toMatchObject({ defaultPath: 'annotated-copy.pdf', filters: [{ extensions: ['pdf'] }] });
  });
});
