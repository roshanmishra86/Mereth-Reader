export interface ArchitectureDecisions {
  oq9_libraryModel: 'open_in_place';
  /**
   * FR-7.2 defines TWO ownership modes. `open_in_place` is the recommended
   * onboarding DEFAULT (OQ-9, provisional pending the R1 usability test), but
   * managed-library copy remains a fully supported, explicitly chosen
   * alternative on import. This flag exists so the "both modes preserved"
   * decision is testable, not just prose.
   */
  oq9_managedLibrarySupported: true;
  oq10_annotationScope: 'text_and_area_capture';
  oq16_targetPlatform: 'win11_x64';
  oq17_printStrategy: 'system_dialog';
  oq18_windowMode: 'single_instance';
  oq19_passwordPolicy: 'in_memory_prompt';
}

export const APP_CONFIG: ArchitectureDecisions = {
  oq9_libraryModel: 'open_in_place',
  oq9_managedLibrarySupported: true,
  oq10_annotationScope: 'text_and_area_capture',
  oq16_targetPlatform: 'win11_x64',
  oq17_printStrategy: 'system_dialog',
  oq18_windowMode: 'single_instance',
  oq19_passwordPolicy: 'in_memory_prompt'
} as const;

export function validateAppConfig(config: ArchitectureDecisions): boolean {
  return (
    config.oq9_libraryModel === 'open_in_place' &&
    config.oq9_managedLibrarySupported === true &&
    config.oq10_annotationScope === 'text_and_area_capture' &&
    config.oq16_targetPlatform === 'win11_x64' &&
    config.oq17_printStrategy === 'system_dialog' &&
    config.oq18_windowMode === 'single_instance' &&
    config.oq19_passwordPolicy === 'in_memory_prompt'
  );
}
