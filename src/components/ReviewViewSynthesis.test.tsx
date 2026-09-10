// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ReviewView } from '../main';
import type { ReviewPromptRecord } from '../utils/promptTypes';
import type { NoteRecord } from '../utils/notesTypes';
import { getDailyReviewUsage, getDueReviewPrompts, recordReviewEvent, getReviewHistory, undoReviewEventIpc, getReviewSchedule } from '../utils/reviewIo';
import { clearActiveReviewSession } from '../utils/reviewSession';
import { scheduleReview } from '../utils/fsrsScheduler';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn().mockReturnValue(false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

const { mockPrompt, mockCreateNote, mockGetReviewPrompt } = vi.hoisted(() => {
  const prompt: ReviewPromptRecord = {
    id: 'prompt-synth-1',
    annotation_id: null,
    note_id: null,
    prompt_type: 'focused_qa',
    question: 'What is the primary role of the hippocampus in spatial memory?',
    answer: 'It maintains cognitive maps and encodes place fields.',
    cue: '',
    priority: 0,
    status: 'adopted',
    adopted_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    paused_at: null,
    provenance: 'user_authored',
  };
  const createNoteFn = vi.fn();
  const getPromptFn = vi.fn().mockResolvedValue(prompt);
  return { mockPrompt: prompt, mockCreateNote: createNoteFn, mockGetReviewPrompt: getPromptFn };
});

vi.mock('../utils/promptsIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/promptsIo')>();
  return {
    ...actual,
    getReviewPrompt: (id: string) => mockGetReviewPrompt(id),
  };
});

vi.mock('../utils/notesIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/notesIo')>();
  return {
    ...actual,
    createNote: (note: Partial<NoteRecord>) => mockCreateNote(note),
  };
});

vi.mock('../utils/reviewIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/reviewIo')>();
  return {
    ...actual,
    getDailyReviewUsage: vi.fn().mockResolvedValue({ completed_cards: 0, duration_ms: 0 }),
    getReviewHistory: vi.fn().mockResolvedValue([]),
    undoReviewEventIpc: vi.fn().mockResolvedValue(undefined),
    getDueReviewPrompts: vi.fn().mockResolvedValue([
      {
        prompt: mockPrompt,
        schedule: null,
      },
    ]),
    getReviewQueueStats: vi.fn().mockResolvedValue({
      due_count: 1,
      adopted_count: 1,
      paused_count: 0,
    }),
    getReviewSchedule: vi.fn().mockResolvedValue(null),
    recordReviewEvent: vi.fn().mockResolvedValue({
      schedule: {
        prompt_id: 'prompt-synth-1',
        desired_retention: 0.9,
        state: 'review',
        stability: 1.5,
        difficulty: 5.0,
        due_at: '2026-01-02T00:00:00Z',
        last_reviewed_at: '2026-01-01T00:00:00Z',
        last_outcome: 'good',
        fsrs_version: 'v5',
        updated_at: '2026-01-01T00:00:00Z',
        provenance: 'user_authored',
      },
      event: {
        id: 'event-1',
        prompt_id: 'prompt-synth-1',
        reviewed_at: '2026-01-01T00:00:00Z',
        outcome: 'good',
        duration_ms: 1500,
        user_response: '',
        provenance: 'user_authored',
      },
    }),
  };
});

describe('ReviewView synthesis completion and linking', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveReviewSession();
    vi.mocked(getDailyReviewUsage).mockResolvedValue({ completed_cards: 0, duration_ms: 0 });
    vi.mocked(getDueReviewPrompts).mockResolvedValue([{ prompt: mockPrompt, schedule: null }]);
    mockCreateNote.mockImplementation(async (note) => ({
      id: 'synth-note-1',
      document_id: null,
      note_type: 'concept',
      title: note.title ?? 'Synthesis',
      body_markdown: note.body_markdown ?? '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    }));
  });

  it('stops Again relearning at the daily rating limit and allows undo', async () => {
    vi.mocked(getDailyReviewUsage).mockResolvedValue({ completed_cards: 998, duration_ms: 0 });
    render(<ReviewView reviewPreferences={{ dailyCardLimit: 999, dailyTimeLimitMinutes: 15, queuePaused: false }} />);
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /again \(1\)/i }));
    expect(await screen.findByText('What changed in your understanding?')).toBeDefined();
    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    expect(getReviewHistory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(undoReviewEventIpc).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /again \(1\)/i })).toBeDefined();
  });

  it('uses cumulative persisted daily minutes before loading cards', async () => {
    vi.mocked(getDailyReviewUsage).mockResolvedValue({ completed_cards: 3, duration_ms: 15 * 60_000 });
    render(<ReviewView reviewPreferences={{ dailyCardLimit: 999, dailyTimeLimitMinutes: 15, queuePaused: false }} />);
    expect(await screen.findByText(/Daily review budget reached/)).toBeDefined();
    expect(getDueReviewPrompts).not.toHaveBeenCalled();
  });

  it('keeps an unscheduled cloze identity through Again and its next rating', async () => {
    const prompt = { ...mockPrompt, prompt_type: 'cloze' as const, question: '{{c1::one}} {{c2::two}}' };
    vi.mocked(getDueReviewPrompts).mockResolvedValue([{ prompt, schedule: null, cloze_index: 2 }]);
    render(<ReviewView />);
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /again \(1\)/i }));
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /good \(3\)/i }));
    expect(await screen.findByText('What changed in your understanding?')).toBeDefined();
    expect(recordReviewEvent).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(recordReviewEvent).mock.calls;
    expect(calls.map(([event]) => event.cloze_index)).toEqual([2, 2]);
    // A schedule inserted after the first rating must be reused for relearning.
    expect(calls[1][1].stability).not.toBe(calls[0][1].stability);
  });

  it('retains in-session relearning cards when navigating away and resuming ReviewView', async () => {
    const prompt = { ...mockPrompt, id: 'prompt-relearn', question: 'Relearning question?' };
    vi.mocked(getDueReviewPrompts).mockResolvedValueOnce([{ prompt, schedule: null, cloze_index: 0 }]);
    const { unmount } = render(<ReviewView />);

    // Reveal and rate Again
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /again \(1\)/i }));
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(1));

    // Simulate navigating to source by unmounting ReviewView
    unmount();

    // In DB, the card is now scheduled for tomorrow, so getDueReviewPrompts returns empty
    vi.mocked(getDueReviewPrompts).mockResolvedValue([]);
    mockGetReviewPrompt.mockResolvedValue(prompt);

    // Return to Review by remounting ReviewView
    render(<ReviewView />);

    // The relearning card must still be retained in the session queue!
    expect(await screen.findByText('Relearning question?')).toBeDefined();
    expect(screen.getByRole('button', { name: /reveal answer and source/i })).toBeDefined();
  });

  it('restores saved schedule for retained retries after leaving and returning to Review (Again -> leave -> return -> rate)', async () => {
    const prompt = { ...mockPrompt, id: 'prompt-relearn-schedule', question: 'Relearning schedule question?' };
    vi.mocked(getDueReviewPrompts).mockResolvedValueOnce([{ prompt, schedule: null, cloze_index: 0 }]);
    const { unmount } = render(<ReviewView />);

    // Step 1: Rate Again
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /again \(1\)/i }));
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(1));

    const firstScheduled = vi.mocked(recordReviewEvent).mock.calls[0][1];
    expect(firstScheduled.state).toBe('relearning');

    // Step 2: Leave (unmount ReviewView)
    unmount();

    // Step 3: Return (remount ReviewView)
    // In DB, the card is now scheduled for tomorrow, so getDueReviewPrompts returns empty
    vi.mocked(getDueReviewPrompts).mockResolvedValue([]);
    mockGetReviewPrompt.mockResolvedValue(prompt);
    vi.mocked(getReviewSchedule).mockResolvedValue(firstScheduled);

    render(<ReviewView />);

    expect(await screen.findByText('Relearning schedule question?')).toBeDefined();
    await waitFor(() => {
      expect(getReviewSchedule).toHaveBeenCalledWith('prompt-relearn-schedule', 0);
    });

    // Step 4: Rate Good
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /good \(3\)/i }));
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(2));

    const secondScheduled = vi.mocked(recordReviewEvent).mock.calls[1][1];
    // Rating the retry must use previousSchedule = firstScheduled instead of null
    // If previousSchedule were null, difficulty would equal initialDifficulty(3)
    const freshGoodSchedule = scheduleReview({ promptId: prompt.id, outcome: 'good', reviewedAt: new Date() }).schedule;
    expect(secondScheduled.difficulty).not.toBe(freshGoodSchedule.difficulty);
    expect(secondScheduled.stability).not.toBe(freshGoodSchedule.stability);
    expect(secondScheduled.last_outcome).toBe('good');
  });

  it('blocks rating actions and shortcuts until schedule restoration finishes (delayed-response regression)', async () => {
    const prompt = { ...mockPrompt, id: 'prompt-relearn-delayed', question: 'Relearning delayed question?' };
    vi.mocked(getDueReviewPrompts).mockResolvedValueOnce([{ prompt, schedule: null, cloze_index: 0 }]);
    const { unmount } = render(<ReviewView />);

    // Step 1: Rate Again
    fireEvent.click(await screen.findByRole('button', { name: /reveal answer and source/i }));
    fireEvent.click(await screen.findByRole('button', { name: /again \(1\)/i }));
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(1));

    const firstScheduled = vi.mocked(recordReviewEvent).mock.calls[0][1];
    expect(firstScheduled.state).toBe('relearning');

    // Step 2: Leave (unmount ReviewView)
    unmount();

    // Step 3: Return with a DELAYED getReviewSchedule promise
    let resolveSchedule!: (value: typeof firstScheduled) => void;
    const schedulePromise = new Promise<typeof firstScheduled>((resolve) => {
      resolveSchedule = resolve;
    });

    vi.mocked(getDueReviewPrompts).mockResolvedValue([]);
    mockGetReviewPrompt.mockResolvedValue(prompt);
    vi.mocked(getReviewSchedule).mockReturnValue(schedulePromise);

    render(<ReviewView />);

    // While retrieval is pending, loading indicator is displayed and rating actions are blocked
    expect(screen.getByText(/Loading review queue/i)).toBeDefined();

    // Attempt to bypass loading via keyboard shortcuts (Space -> 3)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: '3' });

    // Assert that rating was blocked and NO second review event was recorded while retrieval was pending
    expect(recordReviewEvent).toHaveBeenCalledTimes(1);

    // Step 4: Resolve delayed schedule restoration
    resolveSchedule(firstScheduled);

    // Prompt is revealed and interactive now that schedules are loaded
    expect(await screen.findByText('Relearning delayed question?')).toBeDefined();

    // Trigger reveal and rate Good via keyboard shortcuts now that schedules are restored
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: '3' });
    await waitFor(() => expect(recordReviewEvent).toHaveBeenCalledTimes(2));

    const secondScheduled = vi.mocked(recordReviewEvent).mock.calls[1][1];
    const freshGoodSchedule = scheduleReview({ promptId: prompt.id, outcome: 'good', reviewedAt: new Date() }).schedule;
    // Rating used the restored schedule rather than previousSchedule = null
    expect(secondScheduled.difficulty).not.toBe(freshGoodSchedule.difficulty);
    expect(secondScheduled.stability).not.toBe(freshGoodSchedule.stability);
    expect(secondScheduled.last_outcome).toBe('good');
  });

  it('rates the final card, displays synthesis screen, and saves concept note with evidence links', async () => {
    render(<ReviewView />);

    // Wait for prompt card to load
    await waitFor(() => {
      expect(screen.getByText('What is the primary role of the hippocampus in spatial memory?')).toBeDefined();
    });

    // Reveal answer
    const showAnswerBtn = screen.getByRole('button', { name: /reveal answer and source/i });
    fireEvent.click(showAnswerBtn);

    // Rate card as Good to complete the session
    const goodBtn = await screen.findByRole('button', { name: /good \(3\)/i });
    fireEvent.click(goodBtn);

    // Synthesis screen should appear
    await waitFor(() => {
      expect(screen.getByText('What changed in your understanding?')).toBeDefined();
    });

    // Type synthesis text
    const textarea = screen.getByLabelText('What changed in your understanding?');
    fireEvent.change(textarea, {
      target: { value: 'Spatial memory relies on hippocampal place cell dynamics.' },
    });

    // Save to Concept Note
    const saveBtn = screen.getByRole('button', { name: /save to concept note/i });
    fireEvent.click(saveBtn);

    // Assert createNote was called with synthesis note containing date and prompt question
    await waitFor(() => {
      expect(mockCreateNote).toHaveBeenCalledTimes(1);
    });

    const notePayload = mockCreateNote.mock.calls[0][0];
    expect(notePayload.note_type).toBe('concept');
    expect(notePayload.body_markdown).toContain('Spatial memory relies on hippocampal place cell dynamics.');
    expect(notePayload.body_markdown).toContain('What is the primary role of the hippocampus in spatial memory?');
    const today = new Date().toISOString().split('T')[0];
    expect(notePayload.body_markdown).toContain(today);
  });
});
