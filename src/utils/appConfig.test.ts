import { describe, it, expect } from 'vitest';
import { APP_CONFIG, validateAppConfig } from './appConfig';

describe('R0.8 Architecture Decisions & Config Validation', () => {
  it('exports valid binding architectural decisions for OQ-9 through OQ-19', () => {
    expect(APP_CONFIG.oq9_libraryModel).toBe('open_in_place');
    // OQ-9: open-in-place is the default, but managed-library copy (FR-7.2)
    // must remain supported — the ADR/PRD wording must not eliminate it.
    expect(APP_CONFIG.oq9_managedLibrarySupported).toBe(true);
    expect(APP_CONFIG.oq10_annotationScope).toBe('text_and_area_capture');
    expect(APP_CONFIG.oq16_targetPlatform).toBe('win11_x64');
    expect(APP_CONFIG.oq17_printStrategy).toBe('system_dialog');
    expect(APP_CONFIG.oq18_windowMode).toBe('single_instance');
    expect(APP_CONFIG.oq19_passwordPolicy).toBe('in_memory_prompt');
  });

  it('validates config object against requirements', () => {
    expect(validateAppConfig(APP_CONFIG)).toBe(true);
  });
});
