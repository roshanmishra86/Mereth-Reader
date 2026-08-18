#!/usr/bin/env bash
# Runs the in-app R1 performance gate (task 2.9) against the REAL shipping
# pipeline: launches `pnpm tauri dev` with the in-app driver enabled
# (VITE_PERF_MEASURE=1) and the corpus book passed as a launch argument, waits
# for the driver's report, then checks every budget with assert_inapp_perf.py.
#
# Usage: scripts/run_inapp_perf_gate.sh [path-to-large-book-pdf]
# Exit code 0 when every gate passes. Use on the reference hardware; this is
# the evidence 2.9 re-close requires (a Node probe is NOT this gate).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PDF="${1:-$PWD/corpus/large_book_400p.pdf}"
REPORT_DIR="${MERETH_PERF_REPORT_DIR:-/tmp/mereth-perf}"
REPORT="$REPORT_DIR/inapp-perf-report.json"
LOG="/tmp/tauri-perf-gate.log"
TIMEOUT_S="${PERF_GATE_TIMEOUT_S:-420}"

[ -f "$PDF" ] || { echo "error: PDF not found at $PDF" >&2; exit 1; }
mkdir -p "$REPORT_DIR"
rm -f "$REPORT"

echo "gate: launching the real app (pnpm tauri dev) with $PDF"

# Run the whole dev chain (tauri CLI → cargo run → app → WebKit children) in its
# own session so cleanup can kill the entire process group deterministically.
setsid bash -c "MERETH_PERF_REPORT_DIR=\"$REPORT_DIR\" VITE_PERF_MEASURE=1 \
  pnpm tauri dev -- \"$PDF\" > \"$LOG\" 2>&1" &
TAURI_PID=$!

cleanup() {
  kill -- "-$TAURI_PID" 2>/dev/null           # the whole tauri dev session
  pkill -f 'target/debug/mereth-reader' 2>/dev/null   # stragglers from earlier runs
  pkill -f 'webkit2gtk-4.1/WebKitWebProcess' 2>/dev/null
}
trap cleanup EXIT

# Wait for the report with a hard timeout.
elapsed=0
while [ "$elapsed" -lt "$TIMEOUT_S" ]; do
  if [ -f "$REPORT" ]; then
    echo "gate: report appeared after ${elapsed}s"
    break
  fi
  # Fail fast if the dev process died without producing a report.
  if ! kill -0 "$TAURI_PID" 2>/dev/null; then
    echo "error: tauri dev process exited early — see $LOG" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done

if [ ! -f "$REPORT" ]; then
  echo "error: no report after ${TIMEOUT_S}s — see $LOG" >&2
  tail -50 "$LOG" >&2
  exit 1
fi

python3 scripts/assert_inapp_perf.py "$REPORT"
