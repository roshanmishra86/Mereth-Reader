import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';
import {
  createReviewPrompt,
  getReviewPrompt,
  listReviewPrompts,
  listPromptsForSource,
  updateReviewPrompt,
  adoptReviewPrompt,
  retireReviewPrompt,
  deleteReviewPrompt,
} from './promptsIo';
import { createDefaultPromptRecord } from './promptTypes';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('promptsIo IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes db_create_review_prompt correctly', async () => {
    const prompt = createDefaultPromptRecord({
      annotation_id: 'ann-123',
      question: 'What is the testing effect?',
    });
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(prompt);

    const result = await createReviewPrompt(prompt);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_create_review_prompt', { prompt });
    expect(result.id).toBe(prompt.id);
  });

  it('invokes db_get_review_prompt correctly', async () => {
    const prompt = createDefaultPromptRecord({ id: 'p-1', question: 'Test?' });
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(prompt);

    const result = await getReviewPrompt('p-1');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_review_prompt', { id: 'p-1' });
    expect(result?.id).toBe('p-1');
  });

  it('invokes db_list_review_prompts with optional filter', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce([]);

    await listReviewPrompts('draft');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_list_review_prompts', {
      statusFilter: 'draft',
    });
  });

  it('invokes db_list_prompts_for_source correctly', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce([]);

    await listPromptsForSource('ann-1', null);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_list_prompts_for_source', {
      annotationId: 'ann-1',
      noteId: null,
    });
  });

  it('invokes db_adopt_review_prompt and db_retire_review_prompt', async () => {
    const prompt = createDefaultPromptRecord({ id: 'p-1', status: 'adopted' });
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(prompt);

    const adopted = await adoptReviewPrompt('p-1');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_adopt_review_prompt', { id: 'p-1' });
    expect(adopted.status).toBe('adopted');

    vi.mocked(tauriCore.invoke).mockResolvedValueOnce({ ...prompt, status: 'retired' });
    const retired = await retireReviewPrompt('p-1');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_retire_review_prompt', { id: 'p-1' });
    expect(retired.status).toBe('retired');
  });

  it('invokes db_delete_review_prompt correctly', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(undefined);

    await deleteReviewPrompt('p-1');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_delete_review_prompt', { id: 'p-1' });
  });
});
