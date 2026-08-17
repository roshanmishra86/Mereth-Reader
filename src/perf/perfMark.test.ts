import { describe, it, expect, beforeEach } from 'vitest';
import { perfMark, perfMarks, clearPerfMarks, setPerfEnabled, isPerfEnabled } from './perfMark';

describe('perfMark (task 2.9 in-app gate marks)', () => {
  beforeEach(() => {
    clearPerfMarks();
  });

  it('records an ordered mark with a monotonic timestamp when enabled', () => {
    setPerfEnabled(true);
    perfMark('load.start:book.pdf');
    perfMark('load.end');
    const marks = perfMarks();
    expect(marks).toHaveLength(2);
    expect(marks[0].name).toBe('load.start:book.pdf');
    expect(marks[1].name).toBe('load.end');
    expect(marks[1].at).toBeGreaterThanOrEqual(marks[0].at);
    expect(marks[0].at).toBeGreaterThan(0);
  });

  it('is a strict no-op when disabled (production default)', () => {
    setPerfEnabled(false);
    expect(isPerfEnabled()).toBe(false);
    perfMark('search.start');
    perfMark('search.end');
    expect(perfMarks()).toHaveLength(0);
  });

  it('applies the environment-derived default before any override', () => {
    // The module reads VITE_PERF_MEASURE at import time; the default state must
    // be "disabled" unless the env var is exactly '1'.
    clearPerfMarks();
    perfMark('x');
    // Snapshot whether marks were recorded — if the test runner happens to set
    // the env var, this documents that behavior rather than assuming.
    const recorded = perfMarks().length > 0;
    expect(recorded).toBe(import.meta.env.VITE_PERF_MEASURE === '1');
  });
});
