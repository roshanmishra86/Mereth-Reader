import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  calculateColdLoadMetrics,
  checkMemoryWorkingSet,
  parseOutlineItems,
  getViewportTransformMatrix,
  calculateSelectionTransform,
  getSecureDocumentLoadOptions
} from './pdfRendererSpike';

/**
 * Runs the plain-Node pdfjs-dist measurement harness and returns its JSON
 * result. vitest's module transform stalls on pdfjs-dist's worker
 * self-reference, so the real corpus loads happen in a child Node process (see
 * scripts/pdfjs_spike_probe.mjs); these tests assert on its measured output.
 */
function runSpikeProbe(): {
  coldLoads: Array<{ filename: string; loadTimeMs: number; numPages: number; firstPageTextItemCount: number; firstPageSample: string }>;
  checks: Record<string, boolean>;
  heapDeltaMb: number;
  allPassed: boolean;
  error?: string;
} {
  const probe = path.resolve(process.cwd(), 'scripts', 'pdfjs_spike_probe.mjs');
  const out = execFileSync('node', [probe], {
    encoding: 'utf-8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const jsonLine = out.trim().split('\n').pop() as string;
  return JSON.parse(jsonLine);
}

describe('R0.2 Renderer Spike — pure helpers', () => {
  it('calculates cold load metrics and checks against performance budget', () => {
    const resultFast = calculateColdLoadMetrics(1000, 1120, 500);
    expect(resultFast.loadTimeMs).toBe(120);
    expect(resultFast.isAcceptable).toBe(true);

    const resultSlow = calculateColdLoadMetrics(1000, 1800, 500);
    expect(resultSlow.loadTimeMs).toBe(800);
    expect(resultSlow.isAcceptable).toBe(false);
  });

  it('evaluates memory working set limits for active virtualized pages', () => {
    const check1 = checkMemoryWorkingSet(10, 0.5, 250);
    expect(check1.estimatedMemoryMb).toBe(5);
    expect(check1.withinLimit).toBe(true);

    const checkHeavy = checkMemoryWorkingSet(600, 0.5, 250);
    expect(checkHeavy.estimatedMemoryMb).toBe(300);
    expect(checkHeavy.withinLimit).toBe(false);
  });

  it('parses outline tree hierarchy recursively', () => {
    const rawOutline = [
      {
        title: 'Chapter 1',
        dest: 'page=1',
        items: [{ title: 'Section 1.1', dest: 'page=2' }]
      },
      {
        title: 'Chapter 2',
        dest: 'page=5'
      }
    ];

    const parsed = parseOutlineItems(rawOutline);
    expect(parsed.length).toBe(2);
    expect(parsed[0].title).toBe('Chapter 1');
    expect(parsed[0].children.length).toBe(1);
    expect(parsed[0].children[0].title).toBe('Section 1.1');
    expect(parsed[1].children).toEqual([]);
  });

  it('computes correct viewport matrix transforms for zoom and 0/90/180/270 degree rotation', () => {
    const m0 = getViewportTransformMatrix(1.5, 0);
    expect(m0.a).toBe(1.5);
    expect(m0.d).toBe(1.5);

    const m90 = getViewportTransformMatrix(1.0, 90);
    expect(m90.a).toBe(0);
    expect(m90.b).toBe(1);
    expect(m90.c).toBe(-1);
    expect(m90.d).toBe(0);
  });

  it('calculates scaled selection transforms for overlay rendering', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const result = calculateSelectionTransform(rect, 2.0, 0);

    expect(result.transformedRect).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 100
    });
    expect(result.cssTransform).toContain('matrix(2, 0, 0, 2, 0, 0)');
  });

  it('enforces disableScripting: true and isEvalSupported: false in secure document options', () => {
    const fakeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const options = getSecureDocumentLoadOptions(fakeBytes);

    expect(options.disableScripting).toBe(true);
    expect(options.isEvalSupported).toBe(false);
    expect(options.data).toEqual(fakeBytes);
  });
});

describe('R0.2 Renderer Spike — real pdfjs-dist corpus loads', () => {
  it('loads the corpus through pdfjs-dist and passes every failure-mode check', () => {
    const r = runSpikeProbe();

    expect(r.allPassed).toBe(true);
    expect(r.checks.book400Pages).toBe(true);
    expect(r.checks.book400HasText).toBe(true);
    expect(r.checks.book400Under6s).toBe(true);
    expect(r.checks.cjkHasCjk).toBe(true);
    expect(r.checks.rtlHasArabic).toBe(true);
    expect(r.checks.scannedEmpty).toBe(true);
    expect(r.checks.malformedRecovered).toBe(true);
    expect(r.checks.hostileHasJsBytes).toBe(true);
    expect(r.checks.hostileLoads).toBe(true);
    expect(r.checks.passwordRejectsNoPw).toBe(true);
    expect(r.checks.passwordOpensWithPw).toBe(true);
    expect(r.checks.v1v2Differ).toBe(true);
  }, 120000);

  it('records measured cold-load numbers for the ADR (R0.2 evidence)', () => {
    const r = runSpikeProbe();
    const book = r.coldLoads.find((c) => c.filename === 'large_book_400p.pdf');
    expect(book).toBeDefined();
    expect(book!.loadTimeMs).toBeLessThan(6000);
    expect(r.heapDeltaMb).toBeLessThan(250);

    // eslint-disable-next-line no-console
    console.log(
      'R0.2 cold-load summary:',
      r.coldLoads.map((c) => `${c.filename}=${c.loadTimeMs}ms/${c.numPages}p/${c.firstPageTextItemCount}items`).join(' | '),
      `| heapDelta=${r.heapDeltaMb}MB`
    );
  }, 120000);
});
