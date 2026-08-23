#!/usr/bin/env bash
set -euo pipefail

REPORT_OUT="${1:-/tmp/release-performance-gate-report.json}"
R1_REPORT="${REPORT_OUT}.r1.json"
R3R4_REPORT="${REPORT_OUT}.r3r4.json"

node scripts/r1_performance_gate_probe.mjs > "$R1_REPORT"
node scripts/r3r4_recovery_gate_probe.mjs "$R3R4_REPORT" > /dev/null
node scripts/release_performance_gate_probe.mjs "$REPORT_OUT" "$R1_REPORT" "$R3R4_REPORT"
