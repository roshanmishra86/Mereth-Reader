// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PromptEditorModal } from './PromptEditorModal';
import { CollectionManagerModal } from './CollectionManagerModal';
import { ImportModal } from './ImportModal';
import type { CollectionItem } from '../utils/libraryUtils';
import type { DocumentRecord } from '../utils/pdfImport';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn().mockReturnValue(false),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

describe('Modal conditional hooks and isOpen toggling', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('PromptEditorModal', () => {
    const defaultProps = {
      onClose: vi.fn(),
      sourceContext: {
        title: 'Quantum Computing Notes',
        quote: 'Superposition allows simultaneous states.',
        annotationId: 'ann-1',
      },
      onSaved: vi.fn(),
    };

    it('returns null when isOpen is false', () => {
      const { container } = render(
        <PromptEditorModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when isOpen is true', () => {
      render(<PromptEditorModal isOpen={true} {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText(/Remember: Author Prompt/i)).toBeTruthy();
    });

    it('preserves hook ordering and does not throw when toggling isOpen false -> true -> false', () => {
      const { rerender, container } = render(
        <PromptEditorModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<PromptEditorModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<PromptEditorModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();
    });

    it('preserves hook ordering when toggling isOpen true -> false -> true', () => {
      const { rerender, container } = render(
        <PromptEditorModal isOpen={true} {...defaultProps} />
      );
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<PromptEditorModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<PromptEditorModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('CollectionManagerModal', () => {
    const dummyCollections: CollectionItem[] = [
      {
        id: 'col-1',
        name: 'Distributed Systems',
        description: 'Papers on consensus and replication',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const defaultProps = {
      collections: dummyCollections,
      onClose: vi.fn(),
      onUpdateCollections: vi.fn(),
    };

    it('returns null when isOpen is false', () => {
      const { container } = render(
        <CollectionManagerModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when isOpen is true', () => {
      render(<CollectionManagerModal isOpen={true} {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByText(/Collection Manager/i)).toBeTruthy();
    });

    it('preserves hook ordering and does not throw when toggling isOpen false -> true -> false', () => {
      const { rerender, container } = render(
        <CollectionManagerModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<CollectionManagerModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<CollectionManagerModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();
    });

    it('preserves hook ordering when toggling isOpen true -> false -> true', () => {
      const { rerender, container } = render(
        <CollectionManagerModal isOpen={true} {...defaultProps} />
      );
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<CollectionManagerModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<CollectionManagerModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('ImportModal', () => {
    const dummyDocs: DocumentRecord[] = [];

    const defaultProps = {
      existingDocuments: dummyDocs,
      onClose: vi.fn(),
      onImportComplete: vi.fn(),
      mode: 'open' as const,
    };

    it('returns null when isOpen is false', () => {
      const { container } = render(
        <ImportModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the dialog when isOpen is true', () => {
      render(<ImportModal isOpen={true} {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getAllByText(/Open PDF/i).length).toBeGreaterThan(0);
    });

    it('preserves hook ordering and does not throw when toggling isOpen false -> true -> false', () => {
      const { rerender, container } = render(
        <ImportModal isOpen={false} {...defaultProps} />
      );
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<ImportModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<ImportModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();
    });

    it('preserves hook ordering when toggling isOpen true -> false -> true', () => {
      const { rerender, container } = render(
        <ImportModal isOpen={true} {...defaultProps} />
      );
      expect(screen.getByRole('dialog')).toBeTruthy();

      expect(() => {
        rerender(<ImportModal isOpen={false} {...defaultProps} />);
      }).not.toThrow();
      expect(container.firstChild).toBeNull();

      expect(() => {
        rerender(<ImportModal isOpen={true} {...defaultProps} />);
      }).not.toThrow();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });
});
