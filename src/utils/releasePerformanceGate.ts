
export interface ReleasePerformanceMetrics {
  readonly platform: string;
  readonly arch: string;
  readonly cpus: string;
  readonly totalMemoryBytes: number;
  readonly timestamp: string;

  // PRD §17.2 Performance Targets
  readonly firstPageMedianMs: number;
  readonly cachedNavigationMedianMs: number;
  readonly annotationVisibleMedianMs: number;
  readonly annotationDurableMedianMs: number;
  readonly searchFirstResultMedianMs: number;
  readonly autosaveMedianMs: number;
  readonly noteSearchMedianMs: number;
  readonly exportManifestMedianMs: number;
  readonly backupManifestMedianMs: number;
  readonly fsrsSchedulerMedianMs: number;
  readonly memoryRssMb: number;

  readonly allGatesPassed: boolean;
}

export interface ReleaseGateThresholds {
  readonly maxFirstPageMs: number;
  readonly maxCachedNavMs: number;
  readonly maxAnnotationVisibleMs: number;
  readonly maxAnnotationDurableMs: number;
  readonly maxSearchFirstResultMs: number;
  readonly maxAutosaveMs: number;
  readonly maxNoteSearchMs: number;
  readonly maxExportManifestMs: number;
  readonly maxBackupManifestMs: number;
  readonly maxFsrsSchedulerMs: number;
}

export const PRD_RELEASE_TARGETS: ReleaseGateThresholds = {
  maxFirstPageMs: 2000,
  maxCachedNavMs: 100,
  maxAnnotationVisibleMs: 100,
  maxAnnotationDurableMs: 500,
  maxSearchFirstResultMs: 300,
  maxAutosaveMs: 50,
  maxNoteSearchMs: 300,
  maxExportManifestMs: 300,
  maxBackupManifestMs: 300,
  maxFsrsSchedulerMs: 50,
} as const;

export function assertReleasePerformanceGate(metrics: ReleasePerformanceMetrics): void {
  if (!metrics.allGatesPassed) {
    throw new Error("Release performance gate failed against PRD §17.2 targets: " + JSON.stringify(metrics));
  }
}
