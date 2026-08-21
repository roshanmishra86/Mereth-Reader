#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/backup_restore_drill.mjs" "$@"

