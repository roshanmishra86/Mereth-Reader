import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  AutosaveCoordinator,
  diffNoteRevisions,
  saveRecoverableDraft,
  getRecoverableDraft,
  clearRecoverableDraft,
  registerPendingSaveHandler,
  flushAllPendingSaves,
} from './noteRevisions';
import { formatWikiLink } from './noteLinks';

const mockStorage = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockStorage.set(key, String(value));
  },
  removeItem: (key: string) => {
    mockStorage.delete(key);
  },
  clear: () => {
    mockStorage.clear();
  },
  get length() {
    return mockStorage.size;
  },
  key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeLocalStorage,
    writable: true,
    configurable: true,
  });
}

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

  it('cancel discards pending buffer and clears timer so persistence never fires', async () => {
    const coordinator = new AutosaveCoordinator(200);
    const persistMock = vi.fn().mockResolvedValue(undefined);

    coordinator.enqueue('note-3', 'Pending Title', 'Pending Body', persistMock);
    expect(coordinator.hasPending('note-3')).toBe(true);

    coordinator.cancel('note-3');
    expect(coordinator.hasPending('note-3')).toBe(false);
    expect(coordinator.getPending('note-3')).toBeUndefined();

    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();

    expect(persistMock).not.toHaveBeenCalled();
  });

  it('serializes persistence per note and prevents out-of-order completion when typing, blurring, and adding a related note', async () => {
    const coordinator = new AutosaveCoordinator(200);

    let persistedNote = { id: 'note-1', title: 'Initial Title', body_markdown: 'Initial body' };
    const persistedLinks: string[] = [];
    const executionEvents: string[] = [];

    // Create deferred promises to simulate asynchronous save completion in reverse order
    const deferredSave1 = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      return { promise, resolve };
    })();

    const deferredSave2 = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      return { promise, resolve };
    })();

    let saveCallIndex = 0;
    const persistMock = vi.fn(async (id: string, title: string, bodyMarkdown: string) => {
      saveCallIndex++;
      const currentCall = saveCallIndex;
      if (currentCall === 1) {
        executionEvents.push('blur-save-started');
        await deferredSave1.promise;
        persistedNote = { id, title, body_markdown: bodyMarkdown };
        executionEvents.push('blur-save-finished');
      } else if (currentCall === 2) {
        executionEvents.push('link-save-started');
        await deferredSave2.promise;
        persistedNote = { id, title, body_markdown: bodyMarkdown };
        if (bodyMarkdown.includes('mereth:note/target-99')) {
          persistedLinks.push('target-99');
        }
        executionEvents.push('link-save-finished');
      }
    });

    // 1. User types in the note editor
    let currentDraft = 'Typed draft text to keep';
    coordinator.enqueue('note-1', 'Initial Title', currentDraft, persistMock);
    expect(coordinator.hasPending('note-1')).toBe(true);

    // 2. User blurs the editor (triggers handleBlur -> coordinator.flush)
    const blurFlushPromise = coordinator.flush('note-1', persistMock);
    expect(executionEvents).toEqual(['blur-save-started']);
    expect(coordinator.hasInFlight('note-1')).toBe(true);

    // 3. User immediately clicks "Add related note" while blur save is still in-flight
    // Enters the same per-note serialization queue:
    const addLinkPromise = coordinator.runSerialized('note-1', async () => {
      const wikiLink = formatWikiLink('note', 'target-99', 'Target Note');
      const hasRelatedSection = /^## Related notes\s*$/im.test(currentDraft);
      const separator = currentDraft.trim() ? '\n\n' : '';
      const nextBody = hasRelatedSection
        ? `${currentDraft.trimEnd()}\n- ${wikiLink}`
        : `${currentDraft}${separator}## Related notes\n\n- ${wikiLink}`;
      currentDraft = nextBody;
      await persistMock('note-1', 'Initial Title', nextBody);
    });

    // Queue must ensure the second save does not start while the first save is in-flight
    expect(executionEvents).toEqual(['blur-save-started']);

    // 4. Attempt to resolve deferred saves in reverse order:
    // Even if Save 2's resolver is called or ready, Save 2 cannot run or finish before Save 1 finishes!
    deferredSave2.resolve();
    // Verify save 2 has still not finished because it waits for Save 1 in the queue
    expect(executionEvents).toEqual(['blur-save-started']);

    // Now resolve Save 1 (the blur save)
    deferredSave1.resolve();
    await blurFlushPromise;

    // Save 1 finished, allowing Save 2 to proceed and complete
    await addLinkPromise;

    expect(executionEvents).toEqual([
      'blur-save-started',
      'blur-save-finished',
      'link-save-started',
      'link-save-finished',
    ]);

    // Verify both latest draft AND related note link are in the persisted body and link graph
    expect(persistedNote.body_markdown).toBe(
      'Typed draft text to keep\n\n## Related notes\n\n- [[mereth:note/target-99|Target Note]]'
    );
    expect(persistedLinks).toEqual(['target-99']);
    expect(coordinator.hasInFlight('note-1')).toBe(false);
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

  it('retains pending edit buffer if flush persistence fails, preventing data loss', async () => {
    const coordinator = new AutosaveCoordinator(200);
    const failPersist = vi.fn().mockRejectedValue(new Error('Disk full or IPC failure'));

    coordinator.enqueue('note-fail', 'Unsaved Title', 'Critical unsaved thoughts', failPersist);
    expect(coordinator.hasPending('note-fail')).toBe(true);

    // Attempt flush; it rejects
    await expect(coordinator.flush('note-fail', failPersist)).rejects.toThrow('Disk full');

    // Crucial check: pending edit MUST still be retained in coordinator!
    expect(coordinator.hasPending('note-fail')).toBe(true);
    const pending = coordinator.getPending('note-fail');
    expect(pending?.bodyMarkdown).toBe('Critical unsaved thoughts');

    // Retry with working persist
    const okPersist = vi.fn().mockResolvedValue(undefined);
    await coordinator.flush('note-fail', okPersist);
    expect(okPersist).toHaveBeenCalledWith('note-fail', 'Unsaved Title', 'Critical unsaved thoughts');
    expect(coordinator.hasPending('note-fail')).toBe(false);
  });

  it('tracks draft generation numbers monotonically per note', () => {
    const coordinator = new AutosaveCoordinator(200);
    const persistMock = vi.fn().mockResolvedValue(undefined);

    const gen1 = coordinator.enqueue('note-gen', 'Title', 'Draft 1', persistMock);
    expect(gen1).toBe(1);
    expect(coordinator.getGeneration('note-gen')).toBe(1);

    const gen2 = coordinator.enqueue('note-gen', 'Title', 'Draft 2', persistMock);
    expect(gen2).toBe(2);
    expect(coordinator.getGeneration('note-gen')).toBe(2);

    expect(coordinator.getPending('note-gen')?.generation).toBe(2);
  });

  describe('WAL (Write-Ahead Log) recoverable drafts', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('saves, retrieves, and clears draft in localStorage', () => {
      const draft = {
        noteId: 'note-wal-1',
        title: 'Crash Proof Title',
        bodyMarkdown: 'Safe content',
        timestamp: Date.now(),
        generation: 1,
      };

      saveRecoverableDraft('note-wal-1', draft);
      const retrieved = getRecoverableDraft('note-wal-1');
      expect(retrieved).toEqual(draft);

      clearRecoverableDraft('note-wal-1');
      expect(getRecoverableDraft('note-wal-1')).toBeNull();
    });

    it('immediately saves draft to WAL upon enqueue', () => {
      const coordinator = new AutosaveCoordinator(300);
      const persistMock = vi.fn().mockResolvedValue(undefined);

      coordinator.enqueue('note-wal-2', 'Live Draft', 'Typing content...', persistMock);

      const savedDraft = getRecoverableDraft('note-wal-2');
      expect(savedDraft).not.toBeNull();
      expect(savedDraft?.title).toBe('Live Draft');
      expect(savedDraft?.bodyMarkdown).toBe('Typing content...');
      expect(savedDraft?.generation).toBe(1);
    });

    it('clears WAL draft after successful flush', async () => {
      const coordinator = new AutosaveCoordinator(300);
      const persistMock = vi.fn().mockResolvedValue(undefined);

      coordinator.enqueue('note-wal-3', 'Flush Title', 'Flushed body', persistMock);
      expect(getRecoverableDraft('note-wal-3')).not.toBeNull();

      await coordinator.flush('note-wal-3', persistMock);
      expect(persistMock).toHaveBeenCalledWith('note-wal-3', 'Flush Title', 'Flushed body');
      expect(getRecoverableDraft('note-wal-3')).toBeNull();
    });

    it('retains WAL draft if flush persistence rejects', async () => {
      const coordinator = new AutosaveCoordinator(300);
      const failPersist = vi.fn().mockRejectedValue(new Error('Network disconnected'));

      coordinator.enqueue('note-wal-4', 'Important', 'Do not lose me', failPersist);
      expect(getRecoverableDraft('note-wal-4')).not.toBeNull();

      await expect(coordinator.flush('note-wal-4', failPersist)).rejects.toThrow('Network disconnected');
      // WAL draft must still be present for crash recovery
      const recovered = getRecoverableDraft('note-wal-4');
      expect(recovered).not.toBeNull();
      expect(recovered?.bodyMarkdown).toBe('Do not lose me');
    });

    it('clears WAL draft when debounced timer persists successfully', async () => {
      const coordinator = new AutosaveCoordinator(200);
      const persistMock = vi.fn().mockResolvedValue(undefined);

      coordinator.enqueue('note-wal-5', 'Debounce Title', 'Debounced body', persistMock);
      expect(getRecoverableDraft('note-wal-5')).not.toBeNull();

      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(persistMock).toHaveBeenCalledWith('note-wal-5', 'Debounce Title', 'Debounced body');
      expect(getRecoverableDraft('note-wal-5')).toBeNull();
    });

    it('clears WAL draft when cancel is invoked', () => {
      const coordinator = new AutosaveCoordinator(200);
      const persistMock = vi.fn().mockResolvedValue(undefined);

      coordinator.enqueue('note-wal-6', 'Cancelled Title', 'Cancelled body', persistMock);
      expect(getRecoverableDraft('note-wal-6')).not.toBeNull();

      coordinator.cancel('note-wal-6');
      expect(getRecoverableDraft('note-wal-6')).toBeNull();
    });

    it('can cancel a buffered replacement without erasing its recovery WAL', () => {
      const coordinator = new AutosaveCoordinator(200);
      const persistMock = vi.fn().mockResolvedValue(undefined);

      coordinator.enqueue('note-wal-preserve', 'Draft', 'Keep this on failure', persistMock);
      coordinator.cancel('note-wal-preserve', { clearRecovery: false });

      expect(coordinator.hasPending('note-wal-preserve')).toBe(false);
      expect(getRecoverableDraft('note-wal-preserve')?.bodyMarkdown).toBe('Keep this on failure');
    });

    it('writes replacement WAL immediately and preserves newer typing after success', async () => {
      const coordinator = new AutosaveCoordinator(60_000);
      let resolve!: () => void;
      const persist = vi.fn(() => new Promise<void>(done => { resolve = done; }));
      const saving = coordinator.replace('replace-race', 'Title', 'With related link', persist);
      expect(getRecoverableDraft('replace-race')?.bodyMarkdown).toBe('With related link');
      coordinator.enqueue('replace-race', 'Title', 'Newer typing', persist);
      resolve();
      await saving;
      expect(getRecoverableDraft('replace-race')?.bodyMarkdown).toBe('Newer typing');
      coordinator.clearAll();
    });

    it('leaves the latest replacement pending after persistence fails', async () => {
      const coordinator = new AutosaveCoordinator(60_000);
      await expect(coordinator.replace('replace-fail', 'Title', 'Related link', async () => { throw new Error('disk'); })).rejects.toThrow('disk');
      expect(getRecoverableDraft('replace-fail')?.bodyMarkdown).toBe('Related link');
      await coordinator.flush('replace-fail', async () => {});
      expect(getRecoverableDraft('replace-fail')).toBeNull();
    });

    it('supports registering pending save handlers and flushing all', async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      const unregister1 = registerPendingSaveHandler(handler1);
      const unregister2 = registerPendingSaveHandler(handler2);

      await flushAllPendingSaves();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      unregister1();
      unregister2();

      await flushAllPendingSaves();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('propagates failure when a flush handler rejects or returns false', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('Flush persistence disk failure'));
      const successHandler = vi.fn().mockResolvedValue(undefined);

      const unregisterFail = registerPendingSaveHandler(failingHandler);
      const unregisterSuccess = registerPendingSaveHandler(successHandler);

      await expect(flushAllPendingSaves()).rejects.toThrow('Flush persistence disk failure');
      expect(failingHandler).toHaveBeenCalledTimes(1);
      // Other handlers must still have run via Promise.allSettled
      expect(successHandler).toHaveBeenCalledTimes(1);

      unregisterFail();
      unregisterSuccess();

      const falseHandler = vi.fn().mockResolvedValue(false);
      const unregisterFalse = registerPendingSaveHandler(falseHandler);
      await expect(flushAllPendingSaves()).rejects.toThrow('Pending note save failed');
      unregisterFalse();
    });
  });
});
