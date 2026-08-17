#!/usr/bin/env python3
"""Budget checks for the in-app R1 performance gate report (task 2.9).

Reads the report JSON written by the in-app driver (src/perf/inAppPerf.ts)
through the dev-only perf_write_report command and checks every PRD §17.2 /
§17.5 target:

  - cold first page         < 2000 ms
  - cached navigation       median < 100 ms
  - search (memo latency)   median < 300 ms
  - working set delta       < 250 MB
  - cancellation            clean cancelled state shown through the UI

Usage: assert_inapp_perf.py <report.json>
Exit code 0 when every gate passes, 1 otherwise.
"""
import json
import sys


def median(values):
    if not values:
        return 0.0
    s = sorted(values)
    mid = len(s) // 2
    if len(s) % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


def main():
    path = sys.argv[1]
    with open(path, encoding="utf-8") as fh:
        report = json.load(fh)

    failures = []
    notes = []

    status = report.get("status", "missing")
    if status != "completed":
        failures.append(f"report status is '{status}', expected 'completed' (error: {report.get('metrics', {}).get('error')})")

    metrics = report.get("metrics", {})

    cold = metrics.get("coldFirstPageMs")
    if cold is None:
        failures.append("coldFirstPageMs missing")
    elif cold["ms"] < 0:
        failures.append(f"cold first page: {cold['ms']} ms (no paint attribution — measurement broken, budget < 2000 ms)")
    else:
        entry = f"cold first page: {cold['ms']} ms (budget < 2000 ms)"
        if cold["ms"] >= 2000:
            failures.append(entry + "  OVER BUDGET")
        else:
            notes.append(entry)

    nav = metrics.get("cachedNavigationMs")
    if nav is None:
        failures.append("cachedNavigationMs missing")
    else:
        valid = [s for s in nav.get("samples", []) if s.get("ms", -1) > 0]
        if not valid:
            sample_desc = ", ".join(f"p{s.get('target')}:{s.get('ms')}ms" for s in nav.get("samples", []))
            failures.append(f"cachedNavigationMs has no valid timed samples ({sample_desc or 'none'})")
        else:
            entry = f"cached navigation: median {nav['medianMs']} ms (budget < 100 ms)"
            if nav["medianMs"] >= 100:
                failures.append(entry + "  OVER BUDGET")
            else:
                notes.append(entry)

    search = metrics.get("search")
    if search is None:
        failures.append("search metrics missing")
    else:
        if search.get("extractionCompleted") is False:
            failures.append("search skipped: extraction never completed")
        memo = search.get("memoMedianMs")
        entry = f"search memo latency: median {memo} ms (budget < 300 ms)"
        if memo is None or memo >= 300:
            failures.append(entry + "  OVER BUDGET")
        else:
            notes.append(entry)
        notes.append(f"search queries: {search.get('queries')}; ui latency runs: {search.get('uiLatencyMs')}")

    cancel = metrics.get("cancellation")
    if cancel is None:
        failures.append("cancellation missing")
    elif "skipped" in cancel:
        failures.append(f"cancellation skipped: {cancel['skipped']}")
    else:
        notes.append(
            f"cancel UI: {cancel.get('cancelUiMs')} ms, cancelled state shown: {cancel.get('cancelledStateShown')}, "
            f"extraction resumed after restart: {cancel.get('extractionResumedAfterRestart')}"
        )
        if not cancel.get("cancelledStateShown"):
            failures.append("cancelled state was never shown in the jobs drawer")
        if not cancel.get("extractionResumedAfterRestart"):
            failures.append("extraction did not resume after restart")

    ws = metrics.get("workingSetMb")
    if ws is None:
        failures.append("workingSetMb missing")
    else:
        entry = f"working set delta: {ws['deltaMb']} MB (budget < 250 MB); baseline {ws['baselineKb'] / 1024:.1f} MB -> peak {ws['peakKb'] / 1024:.1f} MB, {ws['sampleCount']} samples, {ws['scrollSteps']} scroll steps"
        if ws["deltaMb"] >= 250:
            failures.append(entry + "  OVER BUDGET")
        else:
            notes.append(entry)

    print(f"report: {report.get('app')} | {report.get('document')} | {report.get('timestamp')}")
    for line in notes:
        print(f"  ok: {line}")
    for line in failures:
        print(f"  FAIL: {line}")

    if failures:
        print("IN-APP PERFORMANCE GATE: FAILED")
        return 1
    print("IN-APP PERFORMANCE GATE: PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
