#!/usr/bin/env bash
# Full developer-machine verification of the design source-of-truth package
# (task 0.5). Requires the mock-up/ directory; CI instead runs
# src/utils/designPackage.test.ts, which checks every invariant that is
# checkable without the design source. Exits 0 only when all checks pass.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

FINGERPRINT="docs/design/mockup-fingerprint.json"
fail=0
ok() { echo "ok: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

[ -f "$FINGERPRINT" ] || { echo "FAIL: $FINGERPRINT missing"; exit 1; }

ARCHIVE="$(python3 -c "import json;print(json.load(open('$FINGERPRINT'))['archive']['path'])")"
EXPECT_SHA="$(python3 -c "import json;print(json.load(open('$FINGERPRINT'))['archive']['sha256'])")"

# --- archive existence, hash, integrity ---------------------------------------
[ -f "$ARCHIVE" ] && ok "archive present: $ARCHIVE" || bad "archive missing: $ARCHIVE"
ACT_SHA="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
if [ "$ACT_SHA" = "$EXPECT_SHA" ]; then
  ok "archive sha256 matches fingerprint ($ACT_SHA)"
else
  bad "archive sha256 mismatch: got $ACT_SHA, fingerprint says $EXPECT_SHA"
fi
if unzip -t "$ARCHIVE" > /dev/null 2>&1; then ok "unzip -t passed"; else bad "unzip -t failed"; fi

# --- archive contents vs live mock-up/ ------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ARCHIVE" -d "$TMP"
if (cd mock-up && sha256sum -c "$TMP/mock-up/MANIFEST.sha256" > /dev/null 2>&1); then
  ok "every extracted file matches its manifest sha256"
else
  bad "extracted files do not match the per-file manifest"
fi
LIVE="$(cd mock-up && find . -type f ! -name MANIFEST.sha256 | sort)"
ARCH="$(sed 's/^[0-9a-f]*  //' "$TMP/mock-up/MANIFEST.sha256" | sort)"
if [ "$LIVE" = "$ARCH" ]; then ok "manifest file set equals live mock-up/ file set"; else bad "file-set drift between archive and mock-up/"; fi

# --- screenshot dimensions vs fingerprint ---------------------------------------
python3 - "$FINGERPRINT" <<'PY'
import json, struct, sys
fingerprint = json.load(open(sys.argv[1]))
ok = True
for shot in fingerprint['screenshots']:
    with open(shot['file'], 'rb') as fh:
        head = fh.read(24)
    w, h = struct.unpack('>II', head[16:24])
    if (w, h) != (shot['width'], shot['height']):
        ok = False
        print(f"FAIL: {shot['file']} is {w}x{h}, fingerprint says {shot['width']}x{shot['height']}")
if ok:
    print(f"ok: all {len(fingerprint['screenshots'])} screenshots match recorded dimensions")
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] || fail=1

# --- token source ----------------------------------------------------------------
TOKENS="$(python3 -c "import json;print(json.load(open('$FINGERPRINT'))['tokensSource'].split(' (')[0])")"
TOKEN_CSS="docs/design/_ds/$(basename "$TOKENS")/styles.css"
if [ -f "$TOKEN_CSS" ]; then ok "token stylesheet present: $TOKEN_CSS"; else bad "token stylesheet missing: $TOKEN_CSS"; fi
if grep -q -- '--color-accent:' "$TOKEN_CSS" && grep -q -- '--font-heading:' "$TOKEN_CSS"; then
  ok "token sheet defines color and font variables"
else
  bad "token sheet is missing --color-accent: or --font-heading:"
fi

# --- inventory ---------------------------------------------------------------------
INV="docs/design/interaction-inventory.md"
for dest in Library Reader Notes Review Settings; do
  grep -q "| $dest |" "$INV" || { bad "inventory missing destination row for $dest"; }
done
if grep -q 'Handler registry entries: 31' "$INV"; then ok "inventory has the full 31-handler registry"; else bad "inventory handler registry incomplete"; fi
grep -qv 'Handler registry entries: 0' "$INV" || bad "inventory handler registry is empty"

# --- R5 note -------------------------------------------------------------------------
grep -q 'R5-only AI surfaces' docs/design/r5-ai-surfaces.md || bad "r5-ai-surfaces.md missing its purpose line"

if [ "$fail" -eq 0 ]; then
  echo "design package verified."
else
  echo "design package verification FAILED." >&2
  exit 1
fi
