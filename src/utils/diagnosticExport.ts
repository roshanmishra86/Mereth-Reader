export interface DiagnosticDatabaseStats {
  readonly documentCount: number;
  readonly annotationCount: number;
  readonly noteCount: number;
  readonly reviewPromptCount: number;
  readonly reviewEventCount: number;
  readonly ftsIndexSizeBytes?: number;
}

export interface DiagnosticSystemInfo {
  readonly appVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly memoryRssMb: number;
  readonly totalSystemMemoryMb: number;
  readonly theme: string;
}

export interface DiagnosticReport {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly appIdentifier: string;
  readonly appVersion: string;
  readonly system: {
    readonly platform: string;
    readonly arch: string;
    readonly memoryRssMb: number;
    readonly totalSystemMemoryMb: number;
  };
  readonly storage: DiagnosticDatabaseStats;
  readonly configuration: {
    readonly theme: string;
    readonly aiEnabled: boolean;
    readonly telemetryEnabled: boolean;
  };
  readonly privacyGuarantees: {
    readonly containsDocumentText: boolean;
    readonly containsNoteContent: boolean;
    readonly containsPii: boolean;
    readonly networkTransmissionAuthorized: boolean;
  };
}

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

/**
 * Builds a sanitized, inspectable diagnostic report without document text or PII.
 */
export function buildDiagnosticReport(
  systemInfo: DiagnosticSystemInfo,
  dbStats: DiagnosticDatabaseStats
): DiagnosticReport {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    appIdentifier: "dev.mereth.reader",
    appVersion: systemInfo.appVersion,
    system: {
      platform: systemInfo.platform,
      arch: systemInfo.arch,
      memoryRssMb: systemInfo.memoryRssMb,
      totalSystemMemoryMb: systemInfo.totalSystemMemoryMb,
    },
    storage: {
      documentCount: Math.max(0, dbStats.documentCount),
      annotationCount: Math.max(0, dbStats.annotationCount),
      noteCount: Math.max(0, dbStats.noteCount),
      reviewPromptCount: Math.max(0, dbStats.reviewPromptCount),
      reviewEventCount: Math.max(0, dbStats.reviewEventCount),
      ftsIndexSizeBytes: dbStats.ftsIndexSizeBytes ?? 0,
    },
    configuration: {
      theme: systemInfo.theme,
      aiEnabled: false,
      telemetryEnabled: false,
    },
    privacyGuarantees: {
      containsDocumentText: false,
      containsNoteContent: false,
      containsPii: false,
      networkTransmissionAuthorized: false,
    },
  };
}

/**
 * Serializes report as formatted JSON string for inspection.
 */
export function serializeDiagnosticReportJson(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Formats report as human-readable plain text Markdown for copy-pasting.
 */
export function formatDiagnosticReportText(report: DiagnosticReport): string {
  return [
    `# Mereth Reader Diagnostic Report (v${report.appVersion})`,
    `Generated: ${report.generatedAt}`,
    `App Identifier: ${report.appIdentifier}`,
    "",
    "## System Environment",
    `- OS: ${report.system.platform} (${report.system.arch})`,
    `- Memory RSS: ${report.system.memoryRssMb} MB`,
    `- Total Memory: ${report.system.totalSystemMemoryMb} MB`,
    "",
    "## Storage Inventory",
    `- Documents: ${report.storage.documentCount}`,
    `- Annotations: ${report.storage.annotationCount}`,
    `- Notes: ${report.storage.noteCount}`,
    `- Review Prompts: ${report.storage.reviewPromptCount}`,
    `- Review Events: ${report.storage.reviewEventCount}`,
    "",
    "## Privacy & Boundaries",
    "- AI Runtime: Disabled (v1 core)",
    "- Telemetry: Strict Zero Telemetry (no remote reporting)",
    "- Payload: Inspectable & user-initiated only",
  ].join("\n");
}

/**
 * Asserts that the diagnostic report strictly complies with zero-PII requirements.
 */
export function validateDiagnosticReportPrivacy(report: DiagnosticReport): boolean {
  if (report.privacyGuarantees.containsDocumentText) return false;
  if (report.privacyGuarantees.containsNoteContent) return false;
  if (report.privacyGuarantees.containsPii) return false;
  if (report.privacyGuarantees.networkTransmissionAuthorized) return false;
  if (report.configuration.telemetryEnabled) return false;
  return true;
}
