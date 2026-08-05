// R0.2 renderer spike measurement harness.
//
// Imports pdfjs-dist and loads every corpus PDF in a plain Node process,
// recording real cold-load timings, failure-mode behaviour, and the heap delta.
// Vitest's module transform stalls on pdfjs-dist's worker self-reference, so the
// spike runs natively in Node (where pdfjs-dist works) and prints a JSON result
// that src/utils/pdfRendererSpike.test.ts asserts on. The numbers feed the
// R0.2 ADR. PRD §8.1 forbids accepting PDF.js blindly; this is the corpus gate.

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
const cMapUrl = path.join(pdfjsDir, 'cmaps') + '/';
const standardFontDataUrl = path.join(pdfjsDir, 'standard_fonts') + '/';
const corpusDir = path.resolve(process.cwd(), 'corpus');

const base = {
  disableScripting: true,
  isEvalSupported: false,
  cMapPacked: true,
  cMapUrl,
  standardFontDataUrl
};
const read = (f) => new Uint8Array(fs.readFileSync(path.join(corpusDir, f)));
const sampleOf = (tc) => tc.items.map((i) => i.str ?? '').join(' ').slice(0, 80);

async function cold(f, extra = {}) {
  const data = read(f);
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({ data, ...base, ...extra }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const ms = performance.now() - t0;
  return {
    filename: f,
    loadTimeMs: +ms.toFixed(1),
    numPages: doc.numPages,
    firstPageTextItemCount: tc.items.length,
    firstPageSample: sampleOf(tc)
  };
}

try {
  const mem0 = process.memoryUsage().heapUsed;
  const coldLoads = [];

  // 400-page book FIRST so the measurement includes pdfjs worker initialisation.
  coldLoads.push(await cold('large_book_400p.pdf'));
  for (const f of [
    'simple_text.pdf',
    'cjk_text.pdf',
    'rtl_text.pdf',
    'scanned_page.pdf',
    'malformed_object.pdf',
    'version_v1_original.pdf',
    'version_v2_changed.pdf'
  ]) {
    coldLoads.push(await cold(f));
  }

  // Hostile /JS fixture: loads with scripting disabled; bytes carry /JS.
  const hostileBytes = read('hostile_javascript.pdf');
  const hostileRaw = Buffer.from(hostileBytes).toString('latin1');
  await pdfjs.getDocument({ data: hostileBytes, ...base }).promise;

  // Encrypted fixture: rejects without a password, opens with the right one.
  let passwordRejectsNoPw = false;
  let passwordOpensWithPw = false;
  try {
    await pdfjs.getDocument({ data: read('password_encrypted.pdf'), ...base }).promise;
  } catch {
    passwordRejectsNoPw = true;
  }
  const pwDoc = await pdfjs.getDocument({
    data: read('password_encrypted.pdf'),
    ...base,
    password: 'mereth'
  }).promise;
  passwordOpensWithPw = pwDoc.numPages === 1;

  const heapDeltaMb = +((process.memoryUsage().heapUsed - mem0) / 1048576).toFixed(2);
  const find = (f) => coldLoads.find((c) => c.filename === f);

  const checks = {
    book400Pages: find('large_book_400p.pdf').numPages === 400,
    book400HasText: find('large_book_400p.pdf').firstPageTextItemCount > 0,
    book400Under6s: find('large_book_400p.pdf').loadTimeMs < 6000,
    cjkHasCjk: /[\u4e00-\u9fff]/.test(find('cjk_text.pdf').firstPageSample),
    rtlHasArabic: /[\u0600-\u06ff\ufb50-\ufeff]/.test(find('rtl_text.pdf').firstPageSample),
    scannedEmpty: find('scanned_page.pdf').firstPageTextItemCount === 0,
    malformedRecovered: find('malformed_object.pdf').firstPageTextItemCount > 0,
    hostileHasJsBytes: hostileRaw.includes('/JS') && hostileRaw.includes('/OpenAction'),
    hostileLoads: true,
    passwordRejectsNoPw,
    passwordOpensWithPw,
    v1v2Differ:
      find('version_v1_original.pdf').firstPageTextItemCount !==
      find('version_v2_changed.pdf').firstPageTextItemCount
  };

  const allPassed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ coldLoads, checks, heapDeltaMb, allPassed }));
} catch (e) {
  console.log(JSON.stringify({ allPassed: false, error: String((e && e.message) || e) }));
}
