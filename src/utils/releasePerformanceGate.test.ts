import { describe, expect, it } from "vitest";
import {
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
