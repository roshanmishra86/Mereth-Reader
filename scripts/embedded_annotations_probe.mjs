/**
 * Task 3.6 evidence probe: loads a real corpus PDF through pdfjs-dist in a
 * plain Node child process (vitest's transform stalls on pdfjs's worker
 * self-reference, so real loads run here, mirroring pdfjs_spike_probe.mjs)
 * and prints the parsed annotation data as JSON for the unit test to assert
 * against.
 *
 * Usage: node scripts/embedded_annotations_probe.mjs [pdf] [page]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const corpusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'corpus');
const file = process.argv[2] ?? 'embedded_annotations.pdf';
const pageNumber = Number(process.argv[3] ?? 1);
const pdfjsDir = path.dirname(import.meta.resolve('pdfjs-dist/package.json').replace('file://', ''));
const standardFontDataUrl = path.join(pdfjsDir, 'standard_fonts') + '/';

const data = new Uint8Array(readFileSync(path.join(corpusDir, file)));
const task = pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, standardFontDataUrl });
const doc = await task.promise;
const page = await doc.getPage(pageNumber);
const annots = await page.getAnnotations();

// The page's own viewport at user rotation 0: the authoritative conversion
// (media space, y-up -> the exact space Reader overlays denormalize from).
const vp = page.getViewport({ scale: 1, rotation: 0 });
const normRects = (points) => {
  const list = Array.from(points);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let p = 0; p < list.length; p += 2) {
    const [px, py] = vp.convertToViewportPoint(list[p], list[p + 1]);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return {
    x: minX / vp.width,
    y: minY / vp.height,
    width: (maxX - minX) / vp.width,
    height: (maxY - minY) / vp.height,
  };
};

const out = annots.map((a) => ({
  id: a.id,
  subtype: a.subtype,
  rect: a.rect ? Array.from(a.rect) : null,
  rectNormalized: a.rect ? normRects(a.rect) : null,
  quadPointsLen: a.quadPoints ? a.quadPoints.length : 0,
  quadNormalized:
    a.quadPoints && a.quadPoints.length > 0
      ? Array.from({ length: a.quadPoints.length / 8 }, (_, q) =>
          normRects(a.quadPoints.slice(q * 8, q * 8 + 8))
        )
      : null,
  contents: a.contentsObj?.str ?? null,
  author: a.titleObj?.str ?? null,
  color: a.color ? Array.from(a.color) : null,
  flags: a.annotationFlags,
}));
console.log(
  JSON.stringify({
    file,
    page: page.pageNumber,
    rotate: page.rotate,
    view: page.view,
    numPages: doc.numPages,
    annotations: out,
  })
);
await task.destroy();
