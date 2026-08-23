import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  serializeDiagnosticReportJson,
  formatDiagnosticReportText,
  validateDiagnosticReportPrivacy,
  DIAGNOSTIC_SCHEMA_VERSION,
} from "./diagnosticExport";

describe("diagnosticExport", () => {
  const dummySystem = {
    appVersion: "0.1.0",
    platform: "linux",
    arch: "x64",
    memoryRssMb: 128.5,
    totalSystemMemoryMb: 8192,
    theme: "light",
  };

  const dummyDb = {
    documentCount: 14,
    annotationCount: 156,
    noteCount: 42,
    reviewPromptCount: 28,
    reviewEventCount: 89,
    ftsIndexSizeBytes: 1048576,
  };

  it("builds a structured diagnostic report conforming to schema version 1", () => {
    const report = buildDiagnosticReport(dummySystem, dummyDb);

    expect(report.schemaVersion).toBe(DIAGNOSTIC_SCHEMA_VERSION);
    expect(report.appIdentifier).toBe("dev.mereth.reader");
    expect(report.appVersion).toBe("0.1.0");
    expect(report.system.platform).toBe("linux");
    expect(report.storage.documentCount).toBe(14);
    expect(report.storage.annotationCount).toBe(156);
    expect(report.configuration.telemetryEnabled).toBe(false);
    expect(report.privacyGuarantees.containsDocumentText).toBe(false);
    expect(report.privacyGuarantees.containsNoteContent).toBe(false);
  });

  it("validates zero-PII privacy guarantees", () => {
    const report = buildDiagnosticReport(dummySystem, dummyDb);
    expect(validateDiagnosticReportPrivacy(report)).toBe(true);

    const taintedReport = {
      ...report,
      privacyGuarantees: {
        ...report.privacyGuarantees,
        containsDocumentText: true,
      },
    };
    expect(validateDiagnosticReportPrivacy(taintedReport)).toBe(false);
  });

  it("serializes to JSON and formats readable Markdown report text", () => {
    const report = buildDiagnosticReport(dummySystem, dummyDb);
    const json = serializeDiagnosticReportJson(report);
    expect(json).toContain("dev.mereth.reader");

    const parsed = JSON.parse(json);
    expect(parsed.storage.noteCount).toBe(42);

    const text = formatDiagnosticReportText(report);
    expect(text).toContain("# Mereth Reader Diagnostic Report");
    expect(text).toContain("- Documents: 14");
    expect(text).toContain("Strict Zero Telemetry");
  });
});
