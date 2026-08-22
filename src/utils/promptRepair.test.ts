import { describe, expect, it } from 'vitest';
import { buildPromptRepair, getPromptRepairOptions, hasRepeatedFailures } from './promptRepair';
import { createDefaultPromptRecord } from './promptTypes';

describe('prompt repair', () => {
  const prompt = createDefaultPromptRecord({ id: 'prompt-1', status: 'adopted', question: 'What explains the entire chapter?', answer: 'The answer', cue: '' });

  it('only offers repair after repeated failures', () => {
    expect(hasRepeatedFailures(2)).toBe(false);
    expect(getPromptRepairOptions(2)).toHaveLength(0);
    expect(getPromptRepairOptions(3).map((option) => option.action)).toEqual(['add_cue', 'split', 'narrow', 'retire']);
  });

  it('builds cue, split, narrow, and retire repairs', () => {
    expect(buildPromptRepair(prompt, 'add_cue', { cue: 'Memory encoding' }).prompts[0].cue).toBe('Memory encoding');
    expect(buildPromptRepair(prompt, 'split', { questions: ['What is encoding?', 'Why does retrieval help?'] }).prompts).toHaveLength(2);
    expect(buildPromptRepair(prompt, 'narrow', { question: 'What is encoding?' }).prompts[0].question).toBe('What is encoding?');
    expect(buildPromptRepair(prompt, 'retire').prompts[0].status).toBe('retired');
  });
});
