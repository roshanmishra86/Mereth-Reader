/**
 * In-app performance gate driver (task 2.9), DEV only.
 *
 * Imported dynamically from main.tsx only when VITE_PERF_MEASURE=1. It drives
 * the REAL user surfaces of the running `pnpm tauri dev` app — the toolbar page
 * input, the search input, the jobs drawer cancel/restart buttons, and the
 * reader scroll surface — and measures the REAL pipeline end to end:
 *
 *  1. cold first page: from `load.start` (the render-first load effect) until a
 *     real PDF canvas is painted in the reader;
 *  2. cached navigation: page input → React state → scroll → canvas (five
 *     targets after the first page is warm);
 *  3. job cancellation + restart through the jobs drawer UI while text
 *     extraction is running;
 *  4. search: real query typing → `performAdvancedSearch` memo → match UI,
 *     latency from both the memo marks and the UI update;
 *  5. working set: RSS of the app process + its WebKit child processes sampled
 *     while programmatically scrolling the reader through the document.
 *
 * Results are written through the dev-only `perf_write_report` command into
 * `$MERETH_PERF_REPORT_DIR` (see src-tauri/src/perf.rs). The runner script
 * `scripts/run_inapp_perf_gate.sh` launches the app, waits for the report, and
 * `scripts/assert_inapp_perf.py` checks every budget.
 */
import { invoke } from '@tauri-apps/api/core';
import { perfMark, perfMarks } from './perfMark';

// ---------------------------------------------------------------- plumbing ----

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  label: string,
  predicate: () => boolean,
  timeoutMs = 15_000,
  pollMs = 120,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  console.warn(`[in-app-perf] waitFor timed out: ${label}`);
  return false;
}

/** True when any visible reader canvas already carries opaque (painted) pixels. */
function anyCanvasPainted(): boolean {
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.pdf-page-canvas'));
  if (canvases.length === 0) return false;
  for (const canvas of canvases) {
    if (canvasPainted(canvas)) return true;
  }
  return false;
}

/**
 * True once the given page's canvas shows opaque pixels — the page the user
 * can actually see. pdf.js leaves canvases transparent until paint, so a
 * canvas element existing with a size is NOT a paint signal.
 */
function canvasPainted(canvas: HTMLCanvasElement): boolean {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  // Sample four small blocks spread over the page (a page of prose paints
  // glyphs through every region; an unpainted canvas is fully transparent).
  const points = [
    [0.50, 0.12],
    [0.20, 0.55],
    [0.80, 0.55],
    [0.50, 0.88],
  ] as const;
  for (const [fx, fy] of points) {
    try {
      const x = Math.max(0, Math.min(canvas.width - 2, Math.floor(canvas.width * fx)));
      const y = Math.max(0, Math.min(canvas.height - 2, Math.floor(canvas.height * fy)));
      const data = ctx.getImageData(x, y, 2, 2).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true;
      }
    } catch {
      // tainted/blocked readback — treat as unpainted and move on
    }
  }
  return false;
}

function capturedCanvasState(): number[] {
  const sig: number[] = [];
  for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.pdf-page-canvas'))) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.clientWidth === 0) {
      sig.push(-1);
      continue;
    }
    try {
      const d = ctx.getImageData(0, 0, 4, 4).data;
      for (let i = 0; i < d.length; i += 4) sig.push(d[i], d[i + 1], d[i + 2]);
    } catch {
      sig.push(-2);
    }
  }
  return sig;
}

function byLabel(selector: string, label: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(selector);
  return el;
}

function railButton(text: string): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.rail-item'));
  return buttons.find((b) => b.textContent?.trim().includes(text)) ?? null;
}

function clickByText(root: ParentNode, selector: string, text: string): HTMLElement | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const hit = els.find((el) => el.textContent?.trim().includes(text)) ?? null;
  if (hit) (hit as HTMLElement).click();
  return hit;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

interface NavSample {
  target: number;
  ms: number;
}

interface RssSample {
  at: number;
  total_kb: number;
  app_kb: number;
  descendants_kb: number;
}

// ------------------------------------------------------------------ driver ----

export interface InAppPerfReport {
  status: 'completed' | 'timeout' | 'failed';
  timestamp: string;
  app: string;
  document: string;
  hardware: {
    platform: string;
    cores: number;
    viewport: string;
  };
  metrics: Record<string, unknown>;
  marks: Array<{ name: string; at: number }>;
}

const POLL_MS = 150;
const DEADLINE_MS = 4 * 60 * 1000; // 4 minutes hard cap for the whole run

// StrictMode mounts the app twice in dev, so the importer can invoke this
// twice; a second concurrent driver would fight the first for the same UI.
let gateStarted = false;

export async function runInAppPerfGate(): Promise<void> {
  if (gateStarted) return;
  gateStarted = true;
  const report: InAppPerfReport = {
    status: 'completed',
    timestamp: new Date().toISOString(),
    app: 'mereth-reader (pnpm tauri dev)',
    document: 'unknown',
    hardware: {
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency ?? 0,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
    metrics: {},
    marks: [],
  };

  const deadline = performance.now() + DEADLINE_MS;
  const remaining = () => deadline - performance.now();
  console.info('[in-app-perf] gate run started');

  try {
    // 1. Cold first page: wait for the load to begin, then for real paint
    // (opaque canvas pixels — a laid-out but unpainted canvas is not a
    // paint signal). The paint is attributed to the load that produced it.
    const loadStarted = await waitFor('load.start mark', () =>
      perfMarks().some((m) => m.name.startsWith('load.start')),
    );
    if (!loadStarted) throw new Error('document load never started (launch routing did not open the PDF?)');

    // The paint is attributed to the newest load.start observed AT THE PAINT
    // MOMENT (the load that produced the paint; an already-superseded earlier
    // load must not inflate the measurement).
    const coldLoad = { name: '', at: -1 };
    let coldLoadSeen = false;
    const pagePainted = await waitFor(
      'first page canvas paint',
      () => {
        if (!anyCanvasPainted()) return false;
        const starts = perfMarks().filter((m) => m.name.startsWith('load.start'));
        if (starts.length > 0) {
          const last = starts[starts.length - 1];
          coldLoad.name = last.name;
          coldLoad.at = last.at;
          coldLoadSeen = true;
        }
        return true;
      },
      Math.min(remaining(), 60_000),
      80,
    );
    if (!pagePainted) throw new Error('first page never painted');

    const loadEnd = perfMarks().find((m) => m.name === 'load.end');
    const paintAt = performance.now();
    const coldMs = coldLoadSeen ? paintAt - coldLoad.at : -1;
    report.metrics.coldFirstPageMs = {
      description: 'open → first painted PDF canvas (real IPC byte transfer + pdf.js render)',
      ms: Number(coldMs.toFixed(1)),
    };
    if (coldLoadSeen && loadEnd) {
      report.metrics.loadIpcMs = {
        description: 'loadPdfDocument Promise: binary IPC + pdf.js document setup',
        ms: Number((loadEnd.at - coldLoad.at).toFixed(1)),
      };
    }
    report.document = coldLoad.name.slice('load.start:'.length) || 'unknown';

    // 2. Cancel + restart the running extraction job through the jobs drawer —
    // IMMEDIATELY, while the text pass is still inside its ~few-second window.
    const cancelSample = await measureCancelAndRestart(remaining());
    if (cancelSample) report.metrics.cancellation = cancelSample;

    // Return to the reader: it remounts, re-opens the active document, and the
    // (restarted) extraction job drives the text pass again. Wait for that
    // pass to complete so later stages measure uncontended navigation.
    railButton('Reader')?.click();
    await waitFor('reader after cancel', () => document.querySelector('input[aria-label="Search document text"]') !== null, 15_000);
    await waitFor('extraction completion after remount', () => extractionProgress().last >= 400, 60_000, 250);

    // 3. Cached navigation through the real page input. Each target gets a
    // warm visit and a warm adjacent visit so the timed visit is genuinely
    // cached: input → React commit → scroll → the target page already painted.
    await waitFor('toolbar page input', () => document.querySelector('input[aria-label="Target page number"]') !== null, 15_000);
    const navSamples: NavSample[] = [];
    const navDiagnostics: Array<Record<string, unknown>> = [];
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Target page number"]');
    if (input) {
      for (const target of [150, 200, 250, 300]) {
        const diag: { target: number; warm: Record<string, unknown>; timed: Record<string, unknown> } = { target, warm: {}, timed: {} };
        // Warm visit: render the target into the virtualized cache.
        setInputValue(input, String(target));
        const warmWaitStart = performance.now();
        const warmedPromise = waitFor('warm target page painted', () => {
          diag.warm.valueAccepted = input.value === String(target);
          diag.warm.pageElFound = Array.from(document.querySelectorAll<HTMLElement>('.pdf-page'))
            .some((p) => Number(p.getAttribute('data-page-number')) === target);
          diag.warm.canvasCount = document.querySelectorAll('canvas.pdf-page-canvas').length;
          diag.warm.scrollTop = document.querySelector('.reader-scroll')?.scrollTop ?? -1;
          if (!diag.warm.valueAccepted) return false;
          const el = Array.from(document.querySelectorAll<HTMLElement>('.pdf-page'))
            .find((p) => Number(p.getAttribute('data-page-number')) === target);
          const canvas = el?.querySelector<HTMLCanvasElement>('canvas.pdf-page-canvas');
          if (canvas) diag.warm.canvasFound = true;
          return canvas ? canvasPainted(canvas) : false;
        }, 20_000, 100);
        const warmed = await warmedPromise;
        diag.warm.waitedMs = Number((performance.now() - warmWaitStart).toFixed(0));
        if (!warmed) {
          navSamples.push({ target, ms: -1 });
          navDiagnostics.push(diag);
          continue;
        }
        // Warm adjacent visit (keeps the cache window over the target).
        const neighbor = target + 1;
        setInputValue(input, String(neighbor));
        await waitFor('warm neighbor painted', () => {
          const el = Array.from(document.querySelectorAll<HTMLElement>('.pdf-page'))
            .find((p) => Number(p.getAttribute('data-page-number')) === neighbor);
          const canvas = el?.querySelector<HTMLCanvasElement>('canvas.pdf-page-canvas');
          return canvas ? canvasPainted(canvas) : false;
        }, 15_000, 100);

        // Timed cached visit back to the target. For a genuinely cached page
        // the canvases are already painted (no repaint signal), so the end
        // marker is the scroll commit on the reader surface; a pixel-change
        // repaint is the fallback for content that actually re-renders.
        const scroller = document.querySelector<HTMLElement>('.reader-scroll');
        const scrollBefore = scroller?.scrollTop ?? 0;
        const t0 = performance.now();
        const beforeState = capturedCanvasState();
        setInputValue(input, String(target));
        const accepted = await waitFor('cached page value accepted', () => input.value === String(target), 10_000, 25);
        diag.timed.valueAccepted = accepted;
        let endSignal = false;
        if (accepted) {
          const scrollCommitted = await waitFor(
            'scroll commit',
            () => (scroller?.scrollTop ?? 0) !== scrollBefore,
            2_000,
            25,
          );
          diag.timed.scrollCommitted = scrollCommitted;
          if (scrollCommitted) {
            await new Promise(requestAnimationFrame);
            endSignal = true;
          } else {
            endSignal = await waitFor('cached repaint', () => {
              const after = capturedCanvasState();
              if (after.length !== beforeState.length) return true;
              for (let i = 0; i < after.length; i++) {
                if (after[i] !== beforeState[i]) return true;
              }
              return false;
            }, 5_000, 30);
            diag.timed.repaint = endSignal;
          }
        }
        const t1 = performance.now();
        navSamples.push({ target, ms: endSignal && accepted ? Number((t1 - t0).toFixed(1)) : -1 });
        navDiagnostics.push(diag);
        await sleep(300);
      }
    }
    report.metrics.cachedNavigationMs = {
      description: 'page input → React commit → repaint, target pre-rendered in the cache window (warm + neighbor visits first)',
      samples: navSamples.map((s) => ({ target: s.target, ms: Number(s.ms.toFixed(1)) })),
      medianMs: Number(median(navSamples.filter((s) => s.ms > 0).map((s) => s.ms)).toFixed(2)),
      diagnostics: navDiagnostics,
    };

    // 4. Search latency: distinct queries guaranteed to hit every page of the
    // corpus, measured from the search input after extraction completed.
    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search document text"]');
    if (searchInput) {
      const searchMetrics = await measureSearch(searchInput, remaining());
      if (searchMetrics) report.metrics.search = searchMetrics;
    }

    // 5. Working set during long scroll: sample app + WebKit RSS.
    const workingSet = await measureWorkingSet(remaining());
    if (workingSet) report.metrics.workingSetMb = workingSet;
  } catch (err) {
    report.status = 'failed';
    report.metrics.error = String(err);
  }

  report.marks = perfMarks();
  report.status = remaining() <= 0 && report.status === 'completed' ? 'timeout' : report.status;

  try {
    const path = await invoke<string>('perf_write_report', { filename: 'inapp-perf-report.json', contents: JSON.stringify(report, null, 2) });
    console.info(`[in-app-perf] report written: ${path}`);
  } catch (err) {
    console.error('[in-app-perf] could not write report:', err);
    // Keep a console-visible fallback for manual runs.
    console.info('[in-app-perf] report payload:\n' + JSON.stringify(report, null, 2));
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ExtractionProgress {
  count: number;
  last: number;
  total: number;
}

function extractionProgress(): ExtractionProgress {
  // Mark names are `extract.progress:<processed>:<total>` — splitting on ':'
  // yields ['extract.progress', processed, total], so the segments start at
  // index 1 (a naive [:2] slice would always read the total as "processed").
  const marks = perfMarks().filter((m) => m.name.startsWith('extract.progress:'));
  if (marks.length === 0) return { count: 0, last: 0, total: 0 };
  const last = marks[marks.length - 1];
  const segments = last.name.split(':');
  const processed = Number(segments[1] ?? 0);
  const total = Number(segments[2] ?? 0);
  return { count: marks.length, last: processed, total };
}

async function measureCancelAndRestart(timeoutMs: number): Promise<Record<string, unknown> | null> {
  const deadline = performance.now() + timeoutMs;
  const hit = await waitFor('extraction progress marks', () =>
    perfMarks().some((m) => m.name.startsWith('extract.progress:')),
  );
  if (!hit) {
    return { skipped: 'no extraction progress observed — nothing to cancel' };
  }
  // Record the progress count before cancelling so the restart can be proven
  // by NEW marks rather than by ordering against stale ones.
  const progressBeforeCancel = extractionProgress().count;

  // The Jobs trigger lives in the Library destination.
  railButton('Library')?.click();
  const jobsButtonVisible = await waitFor(
    'jobs button',
    () => Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Jobs')),
    Math.min(15_000, deadline - performance.now()),
  );
  if (!jobsButtonVisible) {
    return { skipped: 'jobs button not found in Library — cancellation not exercised' };
  }

  const jobsCandidates = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.textContent?.includes('Jobs'))
    .map((b) => ({ text: b.textContent?.trim(), cls: b.className, title: b.title }));
  let jobsButton = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Jobs'),
  );
  jobsButton?.click();
  let drawerOpened = await waitFor(
    'jobs drawer sheet',
    () => document.querySelector('.job-queue-sheet') !== null || document.querySelector('[aria-label="Close jobs drawer"]') !== null,
    3_000,
    100,
  );
  if (!drawerOpened && jobsButton) {
    // Retry through the same trigger once (the first synthetic click may have
    // landed before the Library view finished mounting).
    jobsButton.click();
    drawerOpened = await waitFor(
      'jobs drawer sheet after retry',
      () => document.querySelector('.job-queue-sheet') !== null,
      3_000,
      100,
    );
  }
  const jobStatusesSeen = Array.from(document.querySelectorAll('.status-badge')).map((el) => el.textContent?.trim());

  const cancelVisible = await waitFor(
    'Cancel Job button',
    () => Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Cancel Job'),
    10_000,
  );
  if (!cancelVisible) {
    return {
      skipped: 'Cancel Job button not found — extraction finished before the stage reached the drawer',
      drawerOpened,
      jobsCandidates,
      jobStatusesSeen,
      progressMarksBeforeCancel: progressBeforeCancel,
    };
  }

  const t0 = performance.now();
  const cancelButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel Job');
  cancelButton?.click();
  const cancelledShown = await waitFor(
    'CANCELLED status badge + Restart button',
    () =>
      Array.from(document.querySelectorAll('.status-badge')).some((el) => el.textContent?.trim() === 'CANCELLED') &&
      Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Restart Job'),
    10_000,
    80,
  );
  const cancelUiMs = performance.now() - t0;

  // Restart the job so extraction completes for the search stage.
  const restartButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Restart Job');
  restartButton?.click();

  // Close the drawer via its explicit Close button.
  const closeButton = Array.from(document.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === 'Close jobs drawer' || b.textContent?.trim() === 'Close',
  );
  closeButton?.click();

  // Extraction resumes only while the reader (which owns the text pass) is
  // mounted — return to the Reader destination first.
  railButton('Reader')?.click();
  const extractionResumed = await waitFor(
    'extraction progress after restart',
    () => extractionProgress().count > progressBeforeCancel && extractionProgress().last > 0,
    90_000,
    250,
  );

  return {
    description: 'cancel + restart through the real jobs drawer UI while extraction is running',
    cancelUiMs: Number(cancelUiMs.toFixed(1)),
    cancelledStateShown: cancelledShown,
    extractionResumedAfterRestart: extractionResumed,
    progressMarksBeforeCancel: progressBeforeCancel,
    progressMarksAfterRestart: extractionProgress().count,
  };
}

async function measureSearch(
  input: HTMLInputElement,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const deadline = performance.now() + timeoutMs;
  // Search is only meaningful over the extracted text: wait until the
  // (restarted) extraction pass reports all 400 pages.
  const extractionDone = await waitFor(
    'extraction completion after restart',
    () => extractionProgress().last >= 400,
    Math.min(180_000, deadline - performance.now()),
    250,
  );
  if (!extractionDone) {
    return {
      description: 'search over extracted text — SKIPPED: extraction never completed',
      extractionCompleted: false,
    };
  }

  const memoLatencies: number[] = [];
  const uiLatencies: number[] = [];
  const uiSignals: Array<Record<string, unknown>> = [];
  // Every page of the corpus contains "This is body paragraph {n} of chapter
  // {ch}. The Mereth Reader …", so these queries guarantee matches — and each
  // run uses a DIFFERENT string so React processes every change.
  const queries = ['Mereth Reader', 'body paragraph', 'chapter'];

  for (const query of queries) {
    const memoStartIndex = perfMarks().filter((m) => m.name === 'search.end').length;
    const t0 = performance.now();
    setInputValue(input, query);
    const memoDone = await waitFor(
      'search memo ticks',
      () => perfMarks().filter((m) => m.name === 'search.end').length > memoStartIndex,
      10_000,
      25,
    );
    if (memoDone) {
      const end = perfMarks().filter((m) => m.name === 'search.end')[memoStartIndex];
      memoLatencies.push(Number((end.at - t0).toFixed(1)));
    }
    // Enter drives match traversal → the "Match N of M" snippet becomes visible.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const counterText = () => document.querySelector('.search-control b')?.textContent?.trim() ?? null;
    const uiDone = await waitFor(
      'match count UI',
      () =>
        /^\d+\s*\/\s*\d+$/.test(counterText() ?? '') ||
        document.body.innerText.includes('Match 1 of'),
      10_000,
      60,
    );
    if (uiDone) uiLatencies.push(Number((performance.now() - t0).toFixed(1)));
    uiSignals.push({
      query,
      counterText: counterText() ?? null,
      snippetCardPresent: document.querySelector('.search-snippet-preview-card') !== null,
    });
    await sleep(600);
  }

  return {
    description: 'real search input → performAdvancedSearch memo → match UI (3 queries with guaranteed hits per page)',
    queries,
    memoLatencyMs: memoLatencies,
    memoMedianMs: Number(median(memoLatencies).toFixed(2)),
    uiLatencyMs: uiLatencies,
    uiMedianMs: Number(median(uiLatencies).toFixed(2)),
    uiSignals,
  };
}

async function measureWorkingSet(timeoutMs: number): Promise<Record<string, unknown> | null> {
  const deadline = performance.now() + timeoutMs;
  const scroller = await waitForScrollable(15_000);
  if (!scroller) return null;

  // Baseline before scrolling.
  let baseline: number | null = null;
  const samples: RssSample[] = [];
  try {
    const snap = await invoke<{ app_kb: number; descendants_kb: number; total_kb: number }>('perf_rss_snapshot');
    baseline = snap.total_kb;
    samples.push({ at: performance.now(), ...snap });
  } catch {
    return null;
  }

  const step = Math.round(scroller.clientHeight * 0.9);
  const total = scroller.scrollHeight - scroller.clientHeight;
  const steps = Math.min(Math.ceil(total / step), 240);
  let i = 0;
  while (i < steps && performance.now() < deadline) {
    scroller.scrollTop = Math.min(total, i * step);
    i += 1;
    if (i % 3 === 0) {
      try {
        const snap = await invoke<{ app_kb: number; descendants_kb: number; total_kb: number }>('perf_rss_snapshot');
        samples.push({ at: performance.now(), ...snap });
      } catch {
        // transient — keep scrolling
      }
    }
    await sleep(80);
  }

  const peak = Math.max(...samples.map((s) => s.total_kb));
  const deltaMb = peak - (baseline ?? 0);
  return {
    description: 'max RSS (app + WebKit children) during a long programmatic scroll through the document, sampled every ~240 ms',
    baselineKb: baseline ?? 0,
    peakKb: peak,
    deltaMb: Number((deltaMb / 1024).toFixed(2)),
    sampleCount: samples.length,
    scrollSteps: i,
  };
}

async function waitForScrollable(timeoutMs: number): Promise<HTMLElement | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    // The reader's own scroll surface is the one whose scrolling shows new
    // pages; prefer it over any other generic scrollable container.
    const readerScroll = document.querySelector<HTMLElement>('.reader-scroll');
    if (readerScroll && readerScroll.scrollHeight > readerScroll.clientHeight + 100) {
      return readerScroll;
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('div'))) {
      const style = getComputedStyle(el);
      const scrollable =
        el.scrollHeight > el.clientHeight + 100 &&
        (style.overflowY === 'auto' || style.overflowY === 'scroll');
      if (scrollable && el.clientWidth > 400) return el;
    }
    await sleep(200);
  }
  return null;
}
