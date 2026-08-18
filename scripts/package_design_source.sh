#!/usr/bin/env bash
# Assemble and fingerprint the Mereth Reader design source-of-truth package (task 0.5).
#
# mock-up/ is intentionally gitignored: this script turns the complete directory
# into a versioned backup archive under docs/design/archive/, writes a per-file
# SHA-256 manifest *inside* the archive, records the fingerprints of the mockup
# sources, archive and screenshots in docs/design/mockup-fingerprint.json, and
# copies the Modernist token source (mock-up/_ds/) into docs/design/_ds/ so the
# repository carries the design system even when mock-up/ is absent (CI).
#
# Requires: bash, zip, sha256sum, python3. Run from the repository root on a
# machine that has the mock-up/ directory (developer machine only).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

STAMP="$(date +%Y-%m-%d)"
ARCHIVE="docs/design/archive/mock-up-${STAMP}.zip"
TOKEN_SRC="mock-up/_ds/modernist-8bbe1904-81ef-4318-9bb4-642c31744443"

if [ ! -d mock-up ]; then
  echo "error: mock-up/ not found. This script needs the design source (developer machine only)." >&2
  exit 1
fi

# 1. Refresh the token-source copy in the design package.
rm -rf docs/design/_ds
mkdir -p docs/design/_ds docs/design/archive
cp -r "${TOKEN_SRC}" docs/design/_ds/

# 2. Per-file manifest *inside* the archive, listing everything but itself.
rm -f mock-up/MANIFEST.sha256
trap 'rm -f mock-up/MANIFEST.sha256' EXIT
(cd mock-up && find . -type f ! -name 'MANIFEST.sha256' -print0 | sort -z | \
  xargs -0 sha256sum) > mock-up/MANIFEST.sha256

# 3. Rebuild the archive deterministically (no extra attributes).
rm -f "${ARCHIVE}"
zip -X -r "${ARCHIVE}" mock-up > /dev/null
ARCHIVE_SHA="$(sha256sum "${ARCHIVE}" | cut -d' ' -f1)"
ARCHIVE_BYTES="$(wc -c < "${ARCHIVE}" | tr -d ' ')"

# 4. Record fingerprints: mockup sources, archive, screenshots, defaults.
python3 - "${ARCHIVE}" "${ARCHIVE_SHA}" "${ARCHIVE_BYTES}" <<'PY'
import hashlib, json, struct, sys, os

archive, archive_sha, archive_bytes = sys.argv[1], sys.argv[2], sys.argv[3]

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def png_size(path):
    with open(path, 'rb') as fh:
        head = fh.read(24)
    return struct.unpack('>II', head[16:24])

screenshots = []
for wdir in sorted(os.listdir('docs/design/screenshots')):
    full = os.path.join('docs/design/screenshots', wdir)
    if not os.path.isdir(full):
        continue
    for name in sorted(os.listdir(full)):
        if name.endswith('.png'):
            path = os.path.join(full, name)
            w, h = png_size(path)
            screenshots.append({
                'file': os.path.join('docs/design/screenshots', wdir, name),
                'width': w, 'height': h,
            })

sources = ['Reader Prototype.dc.html', 'support.js', '.thumbnail']
fingerprint = {
    'capturedAt': '2026-08-17',
    'purpose': 'Design source of truth for Mereth Reader v1; see docs/design/README.md',
    'mockupDirectory': 'mock-up/ (gitignored at repository root)',
    'renderEngine': 'x-dc design-doc runtime (support.js)',
    'files': {
        f: {'sha256': sha256(os.path.join('mock-up', f)), 'bytes': os.path.getsize(os.path.join('mock-up', f))}
        for f in sources
    },
    'tokensSource': 'mock-up/_ds/modernist-8bbe1904-81ef-4318-9bb4-642c31744443/ (copied to docs/design/_ds/)',
    'archive': {
        'path': archive,
        'sha256': archive_sha,
        'bytes': int(archive_bytes),
        'contains': 'mock-up/* including MANIFEST.sha256 (per-file SHA-256 manifest)',
    },
    'screenshots': screenshots,
    'captureNote': ('Full-canvas captures of the design doc; the mocked application window '
                    'inside each image is exactly the labelled size (1440x900 / 1024x640), '
                    'verified by the mockup\'s own "Showing:" indicator.'),
    'defaults': {
        'dest': 'reader', 'win': '1440', 'aiOn': True, 'right': 'annotations',
        'left': 'outline', 'view': 'single', 'zoom': 'fit', 'revealed': False,
    },
    'defaultsNote': ('aiOn defaults to true in the mockup (U25): v1 ships with all AI '
                     'surfaces absent and the reference state off.'),
}
with open('docs/design/mockup-fingerprint.json', 'w') as fh:
    json.dump(fingerprint, fh, indent=2)
    fh.write('\n')
print('wrote docs/design/mockup-fingerprint.json')
PY

echo "archive: ${ARCHIVE} (${ARCHIVE_BYTES} bytes, sha256 ${ARCHIVE_SHA})"
echo "design package assembled."
