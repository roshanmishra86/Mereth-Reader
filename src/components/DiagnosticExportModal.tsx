import { useEffect, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  DiagnosticReport,
  formatDiagnosticReportText,
  serializeDiagnosticReportJson,
} from "../utils/diagnosticExport";

export interface DiagnosticExportModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly report: DiagnosticReport;
  readonly onCopy?: (text: string) => void;
  readonly onSaveJson?: (json: string) => void | Promise<void>;
}

export function DiagnosticExportModal({
  isOpen,
  onClose,
  report,
  onCopy,
  onSaveJson,
}: DiagnosticExportModalProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"summary" | "json">("summary");
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      setViewMode("summary");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const textSummary = formatDiagnosticReportText(report);
  const jsonReport = serializeDiagnosticReportJson(report);

  const handleCopy = () => {
    const content = viewMode === "summary" ? textSummary : jsonReport;
    if (onCopy) {
      onCopy(content);
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (onSaveJson) {
      await onSaveJson(jsonReport);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-modal-title"
    >
      <div ref={trapRef} className="modal" style={{ width: "min(640px, 100%)" }}>
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close diagnostics dialog"
        >
          x
        </button>
        <span className="eyebrow">PRD §19 · Local Diagnostics</span>
        <h2 id="diagnostic-modal-title">System & Storage Diagnostics</h2>
        <p>
          Inspectable, local diagnostics package. Contains <b>zero document text</b>,{" "}
          <b>zero note contents</b>, and <b>no telemetry</b>. All data remains strictly on your
          device.
        </p>

        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <button
            type="button"
            className={`button ${viewMode === "summary" ? "primary" : ""}`}
            onClick={() => setViewMode("summary")}
            style={{ padding: "4px 10px", fontSize: "13px" }}
          >
            Formatted Summary
          </button>
          <button
            type="button"
            className={`button ${viewMode === "json" ? "primary" : ""}`}
            onClick={() => setViewMode("json")}
            style={{ padding: "4px 10px", fontSize: "13px" }}
          >
            Raw JSON
          </button>
        </div>

        <pre
          style={{
            background: "var(--color-ground-raised, #f3f2f2)",
            padding: "12px",
            border: "1px solid var(--color-border, #e5e5e5)",
            borderRadius: "0",
            maxHeight: "220px",
            overflowY: "auto",
            fontSize: "12px",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {viewMode === "summary" ? textSummary : jsonReport}
        </pre>

        <div className="modal-actions" style={{ marginTop: "16px" }}>
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
          {onSaveJson && (
            <button className="button" type="button" onClick={handleSave}>
              Save JSON File
            </button>
          )}
          <button className="button primary" type="button" onClick={handleCopy}>
            {copied ? "Copied to Clipboard!" : "Copy Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
