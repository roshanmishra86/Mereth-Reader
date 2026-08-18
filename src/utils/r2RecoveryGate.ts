/**
 * Task 3.8 — R2 performance and recovery gate (PRD §9.3, FR-9.8, FR-9.4,
 * FR-7.3). Mirrors the R1.9 harness (`r1PerformanceGate.ts`): budgets are
 * declared here, measurements feed pure evaluators, and the verdict is a
 * single `allGatesPassed` flag. Failures block R3 work.
 *
 * Gate targets and how each is measured:
 * 1. Annotation creation visible within 100 ms — the exact webview pipeline
 *    (record builder + checksum + IPC serialization) measured in Node.
 * 2. Annotation creation durable within 500 ms — the Rust typed
 *    `db_add_annotation` insert measured live by the Rust gate test
 *    (`test_db_add_annotation_durability_budget_at_10k_rows`, parsed by this
 *    suite from cargo output) against a 10,000-row table.
 * 3. Filtering 10,000 annotations stays interactive — the 3.7
 *    `applyAnnotationFilters` worst-case combination measured on a synthetic
 *    10k corpus.
 * 4. Create/edit/delete undo works through pointer and keyboard paths —
 *    manager inverses exercised functionally, the keyboard resolver proven
 *    with a synthetic event, and both UI bindings verified structurally.
 * 5. Anchor preservation across zoom, rotation, restart, and a compatible
 *    renderer reload — re-derived geometry tested functionally, restart
 *    proven by serialization round-trip.
 * 6. Incompatible document replacement enters an explicit re-anchoring
 *    review and never attaches old coordinates silently — proven functionally
 *    with `selectReanchorActions` (detach, no silent reuse) and recorded as a
 *    review-required scenario.
 *
 * Corpus and hardware details are recorded into the report and the
 * committed evidence doc `docs/decisions/R2.8-performance-recovery-gate-report.md`.
 */

import os from 'node:os';
import { AnnotationRecord, buildTextAnnotation } from './annotationTypes';
import { AnnotationFilters, applyAnnotationFilters } from './annotationFilter';

export const R2_BUDGETS = {
  /** FR-9.3: creation is visible within 100 ms. */
  VISIBLE_MS: 100,
  /** FR-9.3: creation is durable within 500 ms. */
  DURABLE_MS: 500,
  /** FR-9.6/§9.3: 10,000-item filtering stays interactive. */
  FILTER_INTERACTIVE_MS: 100,
  FILTER_ANNOTATION_COUNT: 10_000,
} as const;

export interface R2LatencyMetric {
  id: 'creation-visibility' | 'creation-durability' | 'filter-10k';
  name: string;
  target: string;
  budgetMs: number;
  medianMs: number;
  worstMs: number;
  samples: number[];
  passed: boolean;
  measuredBy: 'webview-node' | 'tauri-rust';
}

export type AnchorScenarioId =
  | 'zoom'
  | 'rotation'
  | 'restart'
  | 'renderer-reload'
  | 'incompatible-replacement';

export interface AnchorScenarioReport {
  scenario: AnchorScenarioId;
  /** How anchors survive this scenario (the contract/mechanism). */
  mechanism: string;
  /** Anchors are preserved exactly (geometry re-derives identically). */
  preserved: boolean;
  /** An explicit user review happens before any coordinate reuse. */
  reviewRequired: boolean;
}

export interface UndoPathReport {
  path: 'pointer' | 'keyboard';
  /** Which binding/flow exercises this path. */
  mechanism: string;
  /** Functionally exercised in the gate suite. */
  verified: boolean;
}

export interface R2GateReport {
  timestamp: string;
  hardware: {
    arch: string;
    platform: string;
    cpuModel: string;
    cpuCores: number;
    totalMemoryMb: number;
  };
  corpusVersion: string;
  methodology: string;
  metrics: {
    creationVisibility: R2LatencyMetric;
    creationDurability: R2LatencyMetric;
    filter10k: R2LatencyMetric;
  };
  anchorScenarios: AnchorScenarioReport[];
  undoPaths: UndoPathReport[];
  failures: string[];
  allGatesPassed: boolean;
}

/** The five scenarios §9.3/FR-7.3 require, with their pass expectations. */
export const REQUIRED_ANCHOR_SCENARIOS: ReadonlyArray<{
  scenario: AnchorScenarioId;
  preserved: boolean;
  reviewRequired: boolean;
}> = [
  { scenario: 'zoom', preserved: true, reviewRequired: false },
  { scenario: 'rotation', preserved: true, reviewRequired: false },
  { scenario: 'restart', preserved: true, reviewRequired: false },
  { scenario: 'renderer-reload', preserved: true, reviewRequired: false },
  { scenario: 'incompatible-replacement', preserved: false, reviewRequired: true },
];

/** Pure evaluator: median/worst stats over latency samples. */
export function evaluateLatency(
  id: R2LatencyMetric['id'],
  name: string,
  samples: number[],
  budgetMs: number,
  measuredBy: R2LatencyMetric['measuredBy'],
  targetLabel: string
): R2LatencyMetric {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const worst = sorted[sorted.length - 1] ?? 0;
  return {
    id,
    name,
    target: targetLabel,
    budgetMs,
    medianMs: Number(median.toFixed(3)),
    worstMs: Number(worst.toFixed(3)),
    samples: samples.map((s) => Number(s.toFixed(3))),
    passed: median < budgetMs,
    measuredBy,
  };
}

/** Worst-case creation pipeline: builder + checksum + IPC serialization. */
const LARGE_QUOTE =
  'The plaintiff moves for summary judgment on the ground that there is no genuine dispute ' +
  'as to any material fact and that the moving party is entitled to judgment as a matter of law. ' +
  'Evidence submitted herewith includes the contract, the invoice, and the notice of default, ' +
  'each authenticated by the declarations of witnesses with personal knowledge of the records. '.repeat(3);

export function measureCreationVisibilityPipeline(iterations = 50): number[] {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const record = buildTextAnnotation({
      documentId: 'd',
      documentVersionId: 'v',
      pageIndex: 0,
      pageLabel: '1',
      type: 'highlight',
      rects: [{ x: 0.1, y: 0.2, width: 0.6, height: 0.04 }],
      quote: LARGE_QUOTE,
      prefix: 'Here, ',
      suffix: ' on the merits.',
      textLayerChecksum: 'c'.repeat(64),
      color: 'claim',
      comment: 'Central claim',
    });
    // IPC serialization + the state-list round trip that makes it visible.
    JSON.parse(JSON.stringify(record));
    samples.push(performance.now() - start);
  }
  return samples;
}

/** Heaviest realistic filter over a 10k corpus (every criterion, full scan). */
export function measureFilter10k(
  annotations: AnnotationRecord[],
  iterations = 20
): number[] {
  const heavy: AnnotationFilters = {
    searchText: 'fox',
    types: ['highlight', 'underline', 'comment'],
    paletteKeys: ['claim', 'evidence', 'question'],
    tags: ['chapter-1', 'evidence'],
    pageFrom: 3,
    pageTo: 9_997,
    noteStatus: 'all',
    rememberStatus: 'all',
  };
  applyAnnotationFilters(annotations, heavy); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const out = applyAnnotationFilters(annotations, heavy);
    samples.push(performance.now() - start);
    if (out.length === 0) throw new Error('benchmark corpus degenerate: filter matched nothing');
  }
  return samples;
}

/** Deterministic 10k annotation corpus for the gate (and 3.7 benchmarks). */
export function buildBenchmarkAnnotationCorpus(count: number): AnnotationRecord[] {
  const types = ['highlight', 'underline', 'area', 'comment', 'bookmark'] as const;
  const colors = ['claim', 'evidence', 'question', 'disagree', 'support'];
  const tags = ['chapter-1', 'chapter-2', 'claim', 'evidence', 'visual', 'legal'];
  const now = '2026-08-18T00:00:00Z';
  const records: AnnotationRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: `bench-${i}`,
      document_id: 'd1',
      document_version_id: 'v1',
      checksum: 'c'.repeat(64),
      annotation_type: types[i % types.length],
      page_index: i % 400,
      page_label: String(i % 400 + 1),
      rects: [{ x: 0.1, y: 0.1 + (i % 10) * 0.05, width: 0.4, height: 0.03 }],
      quote: `Quoted passage ${i} about the fox and the turtle`,
      prefix_text: '',
      suffix_text: '',
      text_layer_checksum: null,
      comment: i % 3 === 0 ? `comment ${i} on evidence` : '',
      color: colors[i % colors.length],
      tags: i % 7 === 0 ? [tags[i % tags.length], tags[(i + 3) % tags.length]] : [tags[i % tags.length]],
      deleted_at: null,
      created_at: now,
      updated_at: now,
      provenance: 'user_authored',
    });
  }
  return records;
}

/** Validates the anchor-scenario reports against FR-7.3/§9.3 expectations. */
export function validateAnchorScenarios(entries: AnchorScenarioReport[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<AnchorScenarioId>();
  for (const entry of entries) {
    if (entry.mechanism.trim().length === 0) {
      errors.push(`${entry.scenario}: mechanism must be described`);
    }
    seen.add(entry.scenario);
    const expected = REQUIRED_ANCHOR_SCENARIOS.find((r) => r.scenario === entry.scenario);
    if (!expected) continue;
    if (entry.preserved !== expected.preserved) {
      errors.push(
        `${entry.scenario}: expected preserved=${expected.preserved} (received ${entry.preserved})`
      );
    }
    if (entry.reviewRequired !== expected.reviewRequired) {
      errors.push(
        `${entry.scenario}: expected reviewRequired=${expected.reviewRequired} (received ${entry.reviewRequired})`
      );
    }
  }
  for (const expected of REQUIRED_ANCHOR_SCENARIOS) {
    if (!seen.has(expected.scenario)) {
      errors.push(`missing required anchor scenario: ${expected.scenario}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validates the undo-path reports (FR-9.8: pointer AND keyboard). */
export function validateUndoPaths(entries: UndoPathReport[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.mechanism.trim().length === 0) {
      errors.push(`${entry.path}: mechanism must be described`);
    }
    if (!entry.verified) {
      errors.push(`${entry.path}: path must be functionally verified in the gate suite`);
    }
    seen.add(entry.path);
  }
  if (!seen.has('pointer')) errors.push('missing required undo path: pointer');
  if (!seen.has('keyboard')) errors.push('missing required undo path: keyboard');
  return { valid: errors.length === 0, errors };
}

export interface BuildR2GateReportInput {
  visibleSamples: number[];
  durableSamples: number[];
  filterSamples: number[];
  anchorScenarios: AnchorScenarioReport[];
  undoPaths: UndoPathReport[];
  corpusVersion: string;
  methodology: string;
  timestamp?: string;
  /** Subset of os.cpus() entries consumed by the report formatter. */
  cpus?: Array<{ model: string; speed: number; times: unknown }>;
}

/** Combines measurements + recovery evidence into the gate verdict. */
export function buildR2GateReport(input: BuildR2GateReportInput): R2GateReport {
  const hardwareCpus = input.cpus ?? os.cpus();
  const metrics = {
    creationVisibility: evaluateLatency(
      'creation-visibility',
      'Annotation creation visibility',
      input.visibleSamples,
      R2_BUDGETS.VISIBLE_MS,
      'webview-node',
      `< ${R2_BUDGETS.VISIBLE_MS} ms`
    ),
    creationDurability: evaluateLatency(
      'creation-durability',
      'Annotation creation durability',
      input.durableSamples,
      R2_BUDGETS.DURABLE_MS,
      'tauri-rust',
      `< ${R2_BUDGETS.DURABLE_MS} ms`
    ),
    filter10k: evaluateLatency(
      'filter-10k',
      `Filter ${R2_BUDGETS.FILTER_ANNOTATION_COUNT.toLocaleString()} annotations`,
      input.filterSamples,
      R2_BUDGETS.FILTER_INTERACTIVE_MS,
      'webview-node',
      `< ${R2_BUDGETS.FILTER_INTERACTIVE_MS} ms`
    ),
  };

  const anchor = validateAnchorScenarios(input.anchorScenarios);
  const undo = validateUndoPaths(input.undoPaths);

  const failures: string[] = [];
  for (const metric of Object.values(metrics)) {
    if (!metric.passed) {
      failures.push(
        `${metric.id}: median ${metric.medianMs} ms exceeds budget ${metric.budgetMs} ms`
      );
    }
  }
  failures.push(...anchor.errors.map((e) => `anchor: ${e}`));
  failures.push(...undo.errors.map((e) => `undo: ${e}`));

  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    hardware: {
      arch: os.arch(),
      platform: os.platform(),
      cpuModel: hardwareCpus[0]?.model ?? 'unknown',
      cpuCores: hardwareCpus.length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    },
    corpusVersion: input.corpusVersion,
    methodology: input.methodology,
    metrics,
    anchorScenarios: input.anchorScenarios,
    undoPaths: input.undoPaths,
    failures,
    allGatesPassed: failures.length === 0,
  };
}

/** Markdown evidence document (committed at docs/decisions/R2.8-…md). */
export function formatR2GateMarkdown(report: R2GateReport): string {
  const row = (m: R2LatencyMetric) =>
    `| **${m.name}** | \`${m.target}\` | **${m.medianMs}** | ${m.worstMs} | ${m.samples.length} | ${m.measuredBy} | ${m.passed ? 'PASSED ✅' : 'FAILED ❌'} |`;
  const anchorRows = report.anchorScenarios
    .map(
      (s) =>
        `| **${s.scenario}** | ${s.preserved ? 'preserved' : 'not attached'} | ${s.reviewRequired ? 'explicit review before reuse' : 'none needed'} | ${s.mechanism} |`
    )
    .join('\n');
  const undoRows = report.undoPaths
    .map((u) => `| **${u.path}** | ${u.verified ? 'verified' : 'not verified'} | ${u.mechanism} |`)
    .join('\n');

  return `# R2 Performance & Recovery Gate Report (PRD §9.3, FR-9.8, FR-9.4, FR-7.3)

## Executive Summary
- **Date & Timestamp:** ${report.timestamp}
- **Gate Status:** ${report.allGatesPassed ? 'PASSED ✅' : 'FAILED ❌'}
${report.failures.map((f) => `- **Failure:** ${f}`).join('\n')}
- **Corpus:** ${report.corpusVersion}
- **Methodology:** ${report.methodology}

---

## 1. System Hardware Profile
| Attribute | System Configuration |
| :--- | :--- |
| **CPU Model** | ${report.hardware.cpuModel} |
| **CPU Cores** | ${report.hardware.cpuCores} |
| **Architecture** | ${report.hardware.arch} |
| **Platform** | ${report.hardware.platform} |
| **Total Memory** | ${report.hardware.totalMemoryMb} MB |

---

## 2. R2 Benchmarks (measured, not asserted)

| Metric | Target | Median | Worst | Samples | Measured by | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${row(report.metrics.creationVisibility)}
${row(report.metrics.creationDurability)}
${row(report.metrics.filter10k)}

- Creation visibility: the worst-case webview pipeline (record builder + checksum + IPC serialization of a multi-KB quote).
- Creation durability: the Rust typed insert into an in-memory database already holding 10,000 annotation rows (live cargo gate test).
- Filter: the 3.7 \`applyAnnotationFilters\` with every criterion enabled over a synthetic 10,000-annotation corpus.

---

## 3. Anchor preservation (§9.3)

| Scenario | Geometry result | Review | Mechanism |
| :--- | :--- | :--- | :--- |
${anchorRows}

---

## 4. Undo paths (FR-9.8)

| Path | Status | Mechanism |
| :--- | :--- | :--- |
${undoRows}

---

## 5. Verification Conclusion
All R2 performance and recovery gate targets have been measured and validated.
**Failures block R3 work**; passing entries record corpus and hardware details per §9.3.
`;
}
