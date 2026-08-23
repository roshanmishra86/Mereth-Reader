import * as os from "node:os";
import { runR1PerformanceGateProbe, calculateBenchmarkStats } from "./r1PerformanceGate";
import { measureCreationVisibilityPipeline } from "./r2RecoveryGate";
import { runR3R4RecoveryGate } from "./r3r4RecoveryGate";

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

export function evaluateReleasePerformanceGate(): ReleasePerformanceMetrics {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "unknown";

  const r1Report = runR1PerformanceGateProbe();
  const firstPageMedianMs = r1Report.metrics.coldFirstPageLoad.median;
  const cachedNavigationMedianMs = r1Report.metrics.cachedPageNavigation.median;
  const searchFirstResultMedianMs = r1Report.metrics.fullTextSearchLatency.median;

  const visibleSamples = measureCreationVisibilityPipeline(20);
  const annStats = calculateBenchmarkStats(visibleSamples);
  const annotationVisibleMedianMs = annStats.median;
  const annotationDurableMedianMs = annStats.worst;

  const r3r4Report = runR3R4RecoveryGate();
  const autosaveMedianMs = r3r4Report.autosaveMedianMs;
  const noteSearchMedianMs = r3r4Report.noteSearchMedianMs;
  const exportManifestMedianMs = r3r4Report.exportMedianMs;
  const backupManifestMedianMs = r3r4Report.backupMedianMs;
  const fsrsSchedulerMedianMs = r3r4Report.fsrsMedianMs;

  const memoryUsage = process.memoryUsage();
  const memoryRssMb = Math.round((memoryUsage.rss / (1024 * 1024)) * 100) / 100;

  const passed =
    firstPageMedianMs <= PRD_RELEASE_TARGETS.maxFirstPageMs &&
    cachedNavigationMedianMs <= PRD_RELEASE_TARGETS.maxCachedNavMs &&
    annotationVisibleMedianMs <= PRD_RELEASE_TARGETS.maxAnnotationVisibleMs &&
    annotationDurableMedianMs <= PRD_RELEASE_TARGETS.maxAnnotationDurableMs &&
    searchFirstResultMedianMs <= PRD_RELEASE_TARGETS.maxSearchFirstResultMs &&
    autosaveMedianMs <= PRD_RELEASE_TARGETS.maxAutosaveMs &&
    noteSearchMedianMs <= PRD_RELEASE_TARGETS.maxNoteSearchMs &&
    exportManifestMedianMs <= PRD_RELEASE_TARGETS.maxExportManifestMs &&
    backupManifestMedianMs <= PRD_RELEASE_TARGETS.maxBackupManifestMs &&
    fsrsSchedulerMedianMs <= PRD_RELEASE_TARGETS.maxFsrsSchedulerMs;

  return {
    platform: process.platform,
    arch: process.arch,
    cpus: cpuModel,
    totalMemoryBytes: os.totalmem(),
    timestamp: new Date().toISOString(),
    firstPageMedianMs,
    cachedNavigationMedianMs,
    annotationVisibleMedianMs,
    annotationDurableMedianMs,
    searchFirstResultMedianMs,
    autosaveMedianMs,
    noteSearchMedianMs,
    exportManifestMedianMs,
    backupManifestMedianMs,
    fsrsSchedulerMedianMs,
    memoryRssMb,
    allGatesPassed: passed,
  };
}

export function assertReleasePerformanceGate(metrics: ReleasePerformanceMetrics): void {
  if (!metrics.allGatesPassed) {
    throw new Error("Release performance gate failed against PRD §17.2 targets: " + JSON.stringify(metrics));
  }
}
