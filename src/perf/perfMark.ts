/**
 * Dev-only performance marks for the in-app R1 gate (task 2.9).
 *
 * Every recorded mark is a no-op unless VITE_PERF_MEASURE=1 is set at build/dev
 * time, so production bundles pay nothing and release builds carry no
 * measurement path. The marks are consumed by `src/perf/inAppPerf.ts`, which
 * drives the real UI surfaces of the running app.
 */

export interface PerfMark {
  name: string;
  at: number;
}

let enabled = import.meta.env.VITE_PERF_MEASURE === '1';
const marks: PerfMark[] = [];

/** Test hook: override the environment-derived enabled flag. */
export function setPerfEnabled(value: boolean): void {
  enabled = value;
}

export function isPerfEnabled(): boolean {
  return enabled;
}

/** Records a monotonic timestamped mark, or does nothing when disabled. */
export function perfMark(name: string): void {
  if (!enabled) return;
  marks.push({ name, at: performance.now() });
}

/** Ordered snapshot of all marks recorded since the last clear. */
export function perfMarks(): PerfMark[] {
  return marks.map((m) => ({ ...m }));
}

export function clearPerfMarks(): void {
  marks.length = 0;
}
