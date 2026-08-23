import { describe, it, expect } from 'vitest';
import {
  RESILIENT_STATE_CATALOG,
  evaluateResilientState,
  getAllResilientStates,
  type ResilientStateKey,
} from './resilientStateMatrix';

describe('Task 5.3 Complete Resilient-State Matrix (PRD §17.6, Appendix A)', () => {
  const EXPECTED_STATES: ResilientStateKey[] = [
    'first_run',
    'empty',
    'loading',
    'success',
    'cancellation',
    'no_results',
    'permission_denied',
    'moved_file',
    'duplicate_import',
    'version_mismatch',
    'malformed_pdf',
    'encrypted_pdf',
    'scanned_pdf',
    'disk_full_autosave',
    'migration_failure',
    'export_conflict',
    'corrupt_cache_rebuild',
    'restore_failure',
  ];

  it('defines all 18 resilient states in the catalog taxonomy', () => {
    const states = getAllResilientStates();
    expect(states.length).toBe(18);

    for (const key of EXPECTED_STATES) {
      const descriptor = RESILIENT_STATE_CATALOG[key];
      expect(descriptor).toBeDefined();
      expect(descriptor.key).toBe(key);
      expect(descriptor.title.length).toBeGreaterThan(0);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.preservedData.length).toBeGreaterThan(0);
      expect(descriptor.usableFeatures.length).toBeGreaterThan(0);
      expect(descriptor.suggestedActions.length).toBeGreaterThan(0);
      expect(descriptor.suggestedActions.some((a) => a.isPrimary)).toBe(true);
    }
  });

  describe('1. Failure Mode Evaluation & Recovery Flow', () => {
    it('evaluates first_run state when document count is 0', () => {
      const state = evaluateResilientState({ documentCount: 0 });
      expect(state.key).toBe('first_run');
      expect(state.suggestedActions[0].id).toBe('import_first_pdf');
    });

    it('distinguishes an empty filtered view from a first-run library', () => {
      expect(evaluateResilientState({ documentCount: 0, isFirstRun: false }).key).toBe('empty');
      expect(evaluateResilientState({ documentCount: 0, hasActiveLibraryFilter: true }).key).toBe('empty');
    });

    it('evaluates duplicate imports and export conflicts', () => {
      expect(evaluateResilientState({ duplicateDetected: true }).key).toBe('duplicate_import');
      expect(evaluateResilientState({ exportConflict: true }).key).toBe('export_conflict');
    });

    it('evaluates migration_failure and preserves pre-migration backup', () => {
      const state = evaluateResilientState({ errorCode: 'MIGRATION_FAILED' });
      expect(state.key).toBe('migration_failure');
      expect(state.preservedData).toContain('backup');
      expect(state.suggestedActions[0].id).toBe('restore_migration_backup');
    });

    it('evaluates restore_failure without mutating active database', () => {
      const state = evaluateResilientState({ backupValid: false });
      expect(state.key).toBe('restore_failure');
      expect(state.preservedData).toContain('database untouched');
    });

    it('evaluates disk_full_autosave and preserves in-memory edit buffer', () => {
      const state = evaluateResilientState({ diskFreeBytes: 0 });
      expect(state.key).toBe('disk_full_autosave');
      expect(state.preservedData).toContain('buffer');
    });

    it('evaluates permission_denied error state', () => {
      const state = evaluateResilientState({ errorCode: 'PERMISSION_DENIED' });
      expect(state.key).toBe('permission_denied');
    });

    it('evaluates moved_file when file does not exist on disk', () => {
      const state = evaluateResilientState({ fileExists: false });
      expect(state.key).toBe('moved_file');
      expect(state.suggestedActions.some((a) => a.id === 'locate_moved_file')).toBe(true);
    });

    it('evaluates corrupt_cache_rebuild state', () => {
      const state = evaluateResilientState({ cacheValid: false });
      expect(state.key).toBe('corrupt_cache_rebuild');
      expect(state.suggestedActions[0].id).toBe('rebuild_cache');
    });

    it('evaluates encrypted_pdf requiring password prompt', () => {
      const state = evaluateResilientState({ isEncrypted: true });
      expect(state.key).toBe('encrypted_pdf');
      expect(state.suggestedActions[0].id).toBe('prompt_password');
    });

    it('evaluates malformed_pdf state', () => {
      const state = evaluateResilientState({ isMalformed: true });
      expect(state.key).toBe('malformed_pdf');
      expect(state.suggestedActions.some((a) => a.id === 'retry_malformed')).toBe(true);
    });

    it('evaluates version_mismatch for re-anchoring annotations', () => {
      const state = evaluateResilientState({ fileHashMatched: false });
      expect(state.key).toBe('version_mismatch');
      expect(state.suggestedActions[0].id).toBe('reanchor_annotations');
    });

    it('evaluates scanned_pdf lacking text layer and suggests area capture', () => {
      const state = evaluateResilientState({ hasTextLayer: false });
      expect(state.key).toBe('scanned_pdf');
      expect(state.suggestedActions[0].id).toBe('enable_area_capture');
    });

    it('evaluates cancellation cleanly rolling back jobs', () => {
      const state = evaluateResilientState({ jobState: 'cancelled' });
      expect(state.key).toBe('cancellation');
    });

    it('evaluates loading during in-progress worker jobs', () => {
      const state = evaluateResilientState({ jobState: 'in_progress' });
      expect(state.key).toBe('loading');
    });

    it('evaluates no_results for zero search matches', () => {
      const state = evaluateResilientState({ searchQuery: 'missing term', searchResultsCount: 0 });
      expect(state.key).toBe('no_results');
    });

    it('evaluates success state for standard healthy document reading', () => {
      const state = evaluateResilientState({ documentCount: 5 });
      expect(state.key).toBe('success');
      expect(state.usableFeatures).toContain('Annotate');
    });
  });

  describe('2. Preservation and Determinism Invariants', () => {
    it('guarantees every resilient state specifies what user work is preserved', () => {
      for (const descriptor of getAllResilientStates()) {
        expect(descriptor.preservedData).toBeDefined();
        expect(descriptor.preservedData.trim().length).toBeGreaterThan(10);
      }
    });

    it('guarantees every resilient state has a primary recovery action', () => {
      for (const descriptor of getAllResilientStates()) {
        const primary = descriptor.suggestedActions.find((a) => a.isPrimary);
        expect(primary).toBeDefined();
        expect(primary?.label.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
