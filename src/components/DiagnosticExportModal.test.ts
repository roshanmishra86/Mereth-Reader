import { describe, expect, it } from "vitest";
import {
  DiagnosticReport,
  buildDiagnosticReport,
  formatDiagnosticReportText,
  serializeDiagnosticReportJson,
} from "../utils/diagnosticExport";
import { DiagnosticExportModalProps } from "./DiagnosticExportModal";

describe("DiagnosticExportModal", () => {
  const dummyReport: DiagnosticReport = buildDiagnosticReport(
    {
      appVersion: "0.1.0",
      platform: "linux",
      arch: "x64",
      memoryRssMb: 140,
      totalSystemMemoryMb: 8192,
      theme: "light",
    },
    {
      documentCount: 5,
      annotationCount: 20,
      noteCount: 10,
      reviewPromptCount: 8,
      reviewEventCount: 15,
      ftsIndexSizeBytes: 65536,
    }
  );

  it("conforms to DiagnosticExportModalProps type contract", () => {
    let closed = false;
    let savedContent = "";

    const props: DiagnosticExportModalProps = {
      isOpen: true,
      onClose: () => { closed = true; },
      report: dummyReport,
      onCopy: (text: string) => { savedContent = text; },
      onSaveJson: (json: string) => { savedContent = json; },
    };

    expect(props.isOpen).toBe(true);
    expect(props.report.appIdentifier).toBe("dev.mereth.reader");

    props.onClose();
    expect(closed).toBe(true);

    if (props.onCopy) {
      props.onCopy(formatDiagnosticReportText(dummyReport));
      expect(savedContent).toContain("Mereth Reader Diagnostic Report");
    }

    if (props.onSaveJson) {
      props.onSaveJson(serializeDiagnosticReportJson(dummyReport));
      expect(savedContent).toContain("dev.mereth.reader");
    }
  });
});
