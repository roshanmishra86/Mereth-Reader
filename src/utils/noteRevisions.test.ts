import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveCoordinator, diffNoteRevisions } from './noteRevisions';

describe('AutosaveCoordinator and Revision Diffs (Task 4.1 / FR-10.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debounces multiple keystrokes and persists the latest buffer', async () => {
    const coordinator = new AutosaveCoordinator(200);
    const persistMock = vi.fn().mockResolvedValue(undefined);

    coordinator.enqueue('note-1', 'Title 1', 'First line', persistMock);
    coordinator.enqueue('note-1', 'Title 1', 'First line\nSecond line', persistMock);
    coordinator.enqueue('note-1', 'Final Title', 'First line\nSecond line\nThird line', persistMock);

    expect(persistMock).not.toHaveBeenCalled();
    expect(coordinator.hasPending('note-1')).toBe(true);

    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(
      'note-1',
      'Final Title',
      'First line\nSecond line\nThird line'
    );
  });

  it('flush immediately invokes persistence without waiting for timer', async () => {
    const coordinator = new AutosaveCoordinator(500);
    const persistMock = vi.fn().mockResolvedValue(undefined);

    coordinator.enqueue('note-2', 'Unsaved', 'Content before blur', persistMock);
    expect(persistMock).not.toHaveBeenCalled();

    await coordinator.flush('note-2', persistMock);
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith('note-2', 'Unsaved', 'Content before blur');
    expect(coordinator.hasPending('note-2')).toBe(false);
  });

  it('diffNoteRevisions accurately computes line additions, removals, and title changes', () => {
    const rev1 = {
      title: 'Initial Title',
      body_markdown: 'Line A\nLine B\nLine C',
    };
    const rev2 = {
      title: 'Updated Title',
      body_markdown: 'Line A\nLine B modified\nLine C\nLine D',
    };

    const diff = diffNoteRevisions(rev1, rev2);
    expect(diff.titleChanged).toBe(true);
    expect(diff.addedLines).toBe(2); // 'Line B modified', 'Line D'
    expect(diff.removedLines).toBe(1); // 'Line B'
    expect(diff.description).toContain('Title modified');
    expect(diff.description).toContain('+2 lines');
    expect(diff.description).toContain('-1 lines');
  });
});
