import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addEvidenceBlock,
  getNoteEvidenceBlocks,
  updateEvidenceBlockOrder,
  updateEvidenceBlockComment,
  deleteEvidenceBlock,
} from './evidenceIo';
import type { EvidenceBlockRecord } from './evidenceTypes';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('evidenceIo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockBlock: EvidenceBlockRecord = {
    id: 'eb-1',
    note_id: 'note-1',
    source_kind: 'quote',
    annotation_id: 'ann-1',
    image_asset_id: null,
    document_id: 'doc-1',
    page_index: 0,
    page_label: '1',
    quote: 'Sample excerpt',
    color: 'amber',
    tags: ['history'],
    user_comment: 'Commentary',
    sort_order: 1,
    created_at: '2026-08-21T00:00:00Z',
    provenance: 'source_extracted',
    original_provenance: null,
  };

  it('addEvidenceBlock invokes db_add_evidence_block', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockBlock);
    const result = await addEvidenceBlock(mockBlock);
    expect(invoke).toHaveBeenCalledWith('db_add_evidence_block', { block: mockBlock });
    expect(result).toEqual(mockBlock);
  });

  it('getNoteEvidenceBlocks invokes db_get_note_evidence_blocks', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([mockBlock]);
    const result = await getNoteEvidenceBlocks('note-1');
    expect(invoke).toHaveBeenCalledWith('db_get_note_evidence_blocks', { noteId: 'note-1' });
    expect(result).toEqual([mockBlock]);
  });

  it('updateEvidenceBlockOrder invokes db_update_evidence_block_order', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await updateEvidenceBlockOrder('note-1', ['eb-2', 'eb-1']);
    expect(invoke).toHaveBeenCalledWith('db_update_evidence_block_order', {
      noteId: 'note-1',
      blockIds: ['eb-2', 'eb-1'],
    });
  });

  it('updateEvidenceBlockComment invokes db_update_evidence_block_comment', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await updateEvidenceBlockComment('eb-1', 'New comment');
    expect(invoke).toHaveBeenCalledWith('db_update_evidence_block_comment', {
      id: 'eb-1',
      userComment: 'New comment',
    });
  });

  it('deleteEvidenceBlock invokes db_delete_evidence_block', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteEvidenceBlock('eb-1');
    expect(invoke).toHaveBeenCalledWith('db_delete_evidence_block', { id: 'eb-1' });
  });
});
