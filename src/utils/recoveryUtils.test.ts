import { describe, it, expect } from 'vitest';
import {
  mapErrorToRecoveryState,
  validatePdfPassword,
  detectScannedPdf,
  getEmptyStateDetails,
} from './recoveryUtils';

describe('recoveryUtils', () => {
  describe('mapErrorToRecoveryState', () => {
    it('maps malformed error correctly', () => {
      const state = mapErrorToRecoveryState('malformed', { filePath: '/path/test.pdf' });
      expect(state.title).toBe('Malformed or Unsupported PDF');
      expect(state.isRecoverable).toBe(false);
      expect(state.primaryButtonText).toBe('Return to Library');
      expect(state.message).toContain('/path/test.pdf');
    });

    it('maps password_required error correctly', () => {
      const state = mapErrorToRecoveryState('password_required');
      expect(state.title).toBe('Password-Protected PDF');
      expect(state.isRecoverable).toBe(true);
      expect(state.primaryButtonText).toBe('Unlock Document');
    });

    it('maps password_rejected error correctly', () => {
      const state = mapErrorToRecoveryState('password_rejected');
      expect(state.title).toBe('Incorrect Password');
      expect(state.isRecoverable).toBe(true);
    });

    it('maps missing_file error correctly', () => {
      const state = mapErrorToRecoveryState('missing_file', { filePath: '/docs/missing.pdf' });
      expect(state.title).toBe('File Moved or Missing');
      expect(state.primaryButtonText).toBe('Locate File...');
      expect(state.secondaryButtonText).toBe('Remove from Library');
    });

    it('maps permission_denied error correctly', () => {
      const state = mapErrorToRecoveryState('permission_denied');
      expect(state.title).toBe('Permission Denied');
      expect(state.isRecoverable).toBe(true);
    });

    it('maps scanned_pdf warning correctly', () => {
      const state = mapErrorToRecoveryState('scanned_pdf');
      expect(state.title).toBe('Image-Only / Scanned PDF');
      expect(state.primaryButtonText).toBe('Use Area Capture');
    });

    it('maps version_mismatch error correctly', () => {
      const state = mapErrorToRecoveryState('version_mismatch', { filePath: 'modified.pdf' });
      expect(state.title).toBe('Document Version Changed');
      expect(state.primaryButtonText).toBe('Re-anchor Annotations');
    });

    it('maps renderer_crash error correctly', () => {
      const state = mapErrorToRecoveryState('renderer_crash', { detail: 'Canvas context lost' });
      expect(state.title).toBe('PDF Renderer Error');
      expect(state.message).toBe('Canvas context lost');
      expect(state.primaryButtonText).toBe('Retry Rendering');
    });
  });

  describe('validatePdfPassword', () => {
    it('rejects empty or whitespace passwords', () => {
      expect(validatePdfPassword('')).toEqual({ isValid: false, error: 'Password cannot be empty.' });
      expect(validatePdfPassword('   ')).toEqual({ isValid: false, error: 'Password cannot be empty.' });
    });

    it('accepts valid passwords', () => {
      expect(validatePdfPassword('secret123')).toEqual({ isValid: true });
    });
  });

  describe('detectScannedPdf', () => {
    it('detects scanned PDF when text items are below threshold', () => {
      const result = detectScannedPdf(2, 1, true);
      expect(result.isScanned).toBe(true);
      expect(result.availableActions).toContain('area_capture');
    });

    it('detects normal PDF when text items are above threshold', () => {
      const result = detectScannedPdf(120, 1, true);
      expect(result.isScanned).toBe(false);
      expect(result.availableActions).toContain('text_highlight');
    });
  });

  describe('getEmptyStateDetails', () => {
    it('returns truthful empty library details', () => {
      const state = getEmptyStateDetails('library');
      expect(state.title).toBe('Library is empty');
      expect(state.primaryActionLabel).toBe('+ Import PDF');
    });

    it('returns truthful search details with query', () => {
      const state = getEmptyStateDetails('search', { searchQuery: 'quantum' });
      expect(state.title).toBe('No matching search results');
      expect(state.description).toContain('"quantum"');
    });

    it('returns truthful outline empty state', () => {
      const state = getEmptyStateDetails('outline');
      expect(state.title).toBe('No document outline');
    });

    it('returns truthful annotations empty state', () => {
      const state = getEmptyStateDetails('annotations');
      expect(state.title).toBe('No annotations yet');
    });

    it('returns truthful collections empty state', () => {
      const state = getEmptyStateDetails('collections');
      expect(state.title).toBe('No collections created');
    });

    it('returns truthful jobs empty state', () => {
      const state = getEmptyStateDetails('jobs');
      expect(state.title).toBe('No active or background tasks');
    });
  });
});
