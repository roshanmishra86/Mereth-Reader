import { describe, expect, it } from "vitest";
import {
  evaluateReleasePerformanceGate,
  assertReleasePerformanceGate,
  PRD_RELEASE_TARGETS,
  ReleasePerformanceMetrics,
} from "./releasePerformanceGate";

describe("releasePerformanceGate", () => {
  it("defines PRD §17.2 release performance thresholds accurately", () => {
    expect(PRD_RELEASE_TARGETS.maxFirstPageMs).toBe(2000);
    expect(PRD_RELEASE_TARGETS.maxCachedNavMs).toBe(100);
    expect(PRD_RELEASE_TARGETS.maxAnnotationVisibleMs).toBe(100);
    expect(PRD_RELEASE_TARGETS.maxAnnotationDurableMs).toBe(500);
    expect(PRD_RELEASE_TARGETS.maxSearchFirstResultMs).toBe(300);
    expect(PRD_RELEASE_TARGETS.maxAutosaveMs).toBe(50);
    expect(PRD_RELEASE_TARGETS.maxNoteSearchMs).toBe(300);
    expect(PRD_RELEASE_TARGETS.maxExportManifestMs).toBe(300);
    expect(PRD_RELEASE_TARGETS.maxBackupManifestMs).toBe(300);
    expect(PRD_RELEASE_TARGETS.maxFsrsSchedulerMs).toBe(50);
  });

  it("evaluates live performance metrics and passes all budgets", () => {
    const metrics = evaluateReleasePerformanceGate();

    expect(metrics.allGatesPassed).toBe(true);
    expect(metrics.firstPageMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxFirstPageMs);
    expect(metrics.cachedNavigationMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxCachedNavMs);
    expect(metrics.annotationVisibleMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxAnnotationVisibleMs);
    expect(metrics.annotationDurableMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxAnnotationDurableMs);
    expect(metrics.searchFirstResultMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxSearchFirstResultMs);
    expect(metrics.autosaveMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxAutosaveMs);
    expect(metrics.noteSearchMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxNoteSearchMs);
    expect(metrics.exportManifestMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxExportManifestMs);
    expect(metrics.backupManifestMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxBackupManifestMs);
    expect(metrics.fsrsSchedulerMedianMs).toBeLessThanOrEqual(PRD_RELEASE_TARGETS.maxFsrsSchedulerMs);

    expect(() => assertReleasePerformanceGate(metrics)).not.toThrow();
  });

  it("throws when a performance budget is breached", () => {
    const failingMetrics: ReleasePerformanceMetrics = {
      platform: "linux",
      arch: "x64",
      cpus: "test-cpu",
      totalMemoryBytes: 8 * 1024 * 1024 * 1024,
      timestamp: new Date().toISOString(),
      firstPageMedianMs: 2500, // Breached
      cachedNavigationMedianMs: 120,
      annotationVisibleMedianMs: 15,
      annotationDurableMedianMs: 25,
      searchFirstResultMedianMs: 40,
      autosaveMedianMs: 2,
      noteSearchMedianMs: 15,
      exportManifestMedianMs: 5,
      backupManifestMedianMs: 8,
      fsrsSchedulerMedianMs: 1,
      memoryRssMb: 120,
      allGatesPassed: false,
    };

    expect(() => assertReleasePerformanceGate(failingMetrics)).toThrow(/Release performance gate failed/);
  });
});
