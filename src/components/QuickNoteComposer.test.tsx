// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QuickNoteComposer } from './QuickNoteComposer';
import { quickNoteTitle, QuickNoteSourceSnapshot } from '../utils/notesTypes';

describe('QuickNoteComposer component and interactions', () => {
  const dummySource: QuickNoteSourceSnapshot = {
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    pageIndex: 4,
    pageLabel: '5',
    selectedQuote: 'The quick brown fox jumps over the lazy dog.',
    rectsJson: '[]',
  };

  let onSave: ReturnType<typeof vi.fn<(body: string, source: QuickNoteSourceSnapshot) => Promise<void>>>;
  let onDismiss: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onSave = vi.fn<(body: string, source: QuickNoteSourceSnapshot) => Promise<void>>().mockResolvedValue(undefined);
    onDismiss = vi.fn<() => void>();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('automatically focuses the textarea upon mounting', () => {
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });
    expect(document.activeElement).toBe(textarea);
  });

  it('renders quote when present in source snapshot', () => {
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    expect(screen.getByText(/quick brown fox/i)).toBeTruthy();
  });

  it('bare Enter produces a newline and does NOT trigger onSave', () => {
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });

    fireEvent.change(textarea, { target: { value: 'Line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter triggers onSave with trimmed note body', async () => {
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });

    fireEvent.change(textarea, { target: { value: '   My insight on the text   ' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('My insight on the text', dummySource);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Save button triggers onSave with trimmed note body', async () => {
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });
    const saveBtn = screen.getByRole('button', { name: /save note/i });

    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'Important finding' } });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Important finding', dummySource);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate submissions on rapid double submit', async () => {
    let callCount = 0;
    const slowSave = vi.fn<(body: string, source: QuickNoteSourceSnapshot) => Promise<void>>().mockImplementation(
      async () => {
        callCount++;
        await new Promise((res) => setTimeout(res, 10));
      }
    );

    render(<QuickNoteComposer source={dummySource} onSave={slowSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });

    fireEvent.change(textarea, { target: { value: 'Single submit check' } });

    await act(async () => {
      // Fire Ctrl+Enter twice in quick succession while save is in-flight
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
      await new Promise((res) => setTimeout(res, 30));
    });

    expect(slowSave).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses cleanly when clicking outside on an empty note', () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />
      </div>
    );

    const outside = screen.getByTestId('outside-area');
    fireEvent.pointerDown(outside);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows discard confirmation bar when clicking outside on a dirty note', () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />
      </div>
    );

    const textarea = screen.getByRole('textbox', { name: /quick note text/i });
    fireEvent.change(textarea, { target: { value: 'Pending thought' } });

    const outside = screen.getByTestId('outside-area');
    fireEvent.pointerDown(outside);

    // Should NOT immediately dismiss
    expect(onDismiss).not.toHaveBeenCalled();

    // Discard confirm dialog appears
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/unsaved changes\. discard note\?/i)).toBeTruthy();

    // Clicking Discard in confirm bar calls onDismiss
    const discardBtn = screen.getByRole('button', { name: /^discard$/i });
    fireEvent.click(discardBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape triggers discard confirm when dirty, and dismisses when clean', () => {
    const { unmount } = render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    let textarea = screen.getByRole('textbox', { name: /quick note text/i });

    // Clean Escape dismisses immediately
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();

    // Dirty Escape shows confirmation bar
    onDismiss.mockClear();
    render(<QuickNoteComposer source={dummySource} onSave={onSave} onDismiss={onDismiss} />);
    textarea = screen.getByRole('textbox', { name: /quick note text/i });

    fireEvent.change(textarea, { target: { value: 'Draft content' } });
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved changes\. discard note\?/i)).toBeTruthy();
  });

  it('retains draft and displays error message when onSave fails', async () => {
    const failingSave = vi.fn().mockRejectedValue(new Error('Disk write error'));

    render(<QuickNoteComposer source={dummySource} onSave={failingSave} onDismiss={onDismiss} />);
    const textarea = screen.getByRole('textbox', { name: /quick note text/i });

    fireEvent.change(textarea, { target: { value: 'Preserved note draft' } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    });

    expect(failingSave).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    // Draft is still present in textarea
    expect((textarea as HTMLTextAreaElement).value).toBe('Preserved note draft');

    // Error alert is rendered
    expect(screen.getByRole('alert').textContent).toContain('Disk write error');
  });

  it('extracts first line for quick note title correctly', () => {
    expect(quickNoteTitle('First line of my note\nSecond line')).toBe('First line of my note');
    expect(quickNoteTitle('   Trimmed line   \nOther')).toBe('Trimmed line');
    expect(quickNoteTitle('\n\nEmpty leading lines\nDone')).toBe('Empty leading lines');
    expect(quickNoteTitle('   ')).toBe('Quick note');
  });

  it('caps long note titles at 120 characters', () => {
    const long = 'A'.repeat(200);
    expect(quickNoteTitle(long)).toHaveLength(120);
  });
});
