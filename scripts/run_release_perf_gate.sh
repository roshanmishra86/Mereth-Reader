#!/usr/bin/env bash
set -euo pipefail

REPORT_OUT="${1:-/tmp/release-performance-gate-report.json}"
node scripts/release_performance_gate_probe.mjs "$REPORT_OUT"
