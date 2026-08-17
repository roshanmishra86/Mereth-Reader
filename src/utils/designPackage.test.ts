import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeBufferSha256 } from './corpus';

// Task 0.5: the design source of truth lives in docs/design/ (mock-up/ itself is
// gitignored). This suite pins every package invariant that is checkable without
// the design source, so CI and reviewers can verify the package on any machine.
// The dev-machine checks that DO require mock-up/ live in
// scripts/verify_design_package.sh.

const designDir = path.resolve(process.cwd(), 'docs', 'design');

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(designDir, relPath), 'utf-8')) as Record<string, unknown>;
}

function pngSize(filePath: string): [number, number] {
  const buf = fs.readFileSync(filePath);
  // PNG signature (8 bytes) + IHDR length/type (8 bytes) + width/height.
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('0.5 design source of truth', () => {
  it('the design package index and recovery record exist', () => {
    for (const rel of ['README.md', 'RECOVERY.md', 'r5-ai-surfaces.md', 'interaction-inventory.md', 'mockup-fingerprint.json']) {
      expect(fs.existsSync(path.join(designDir, rel)), `${rel} missing`).toBe(true);
    }
    // Screenshot sets at the two required window presets.
    expect(fs.existsSync(path.join(designDir, 'screenshots', '1440x900'))).toBe(true);
    expect(fs.existsSync(path.join(designDir, 'screenshots', '1024x640'))).toBe(true);
  });

  it('the fingerprint records mockup sources, archive and screenshot facts', () => {
    const fp = readJson('mockup-fingerprint.json');
    expect(fp.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const files = fp.files as Record<string, { sha256: string; bytes: number }>;
    for (const name of ['Reader Prototype.dc.html', 'support.js', '.thumbnail']) {
      const entry = files[name];
      expect(entry, `files.${name} missing`).toBeDefined();
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
    }

    const archive = fp.archive as { path: string; sha256: string; bytes: number };
    expect(archive.path).toMatch(/^docs\/design\/archive\/mock-up-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(archive.bytes).toBeGreaterThan(0);

    const shots = fp.screenshots as Array<{ file: string; width: number; height: number }>;
    expect(shots.length).toBe(10);
    const names = shots.map((s) => s.file).sort();
    expect(names).toHaveLength(new Set(names).size); // unique files
  });

  it('the archive exists and its SHA-256 matches the fingerprint', () => {
    const fp = readJson('mockup-fingerprint.json');
    const archive = fp.archive as { path: string; sha256: string; bytes: number };
    const archivePath = path.join(process.cwd(), archive.path);
    expect(fs.existsSync(archivePath)).toBe(true);
    const buf = fs.readFileSync(archivePath);
    expect(buf.byteLength).toBe(archive.bytes);
    expect(computeBufferSha256(buf)).toBe(archive.sha256);
  });

  it('ten screenshots exist with the documented capture dimensions', () => {
    const fp = readJson('mockup-fingerprint.json');
    // Full-canvas captures: the mocked application window inside is exactly the
    // labelled size (1440x900 / 1024x640); the canvas itself was captured at
    // 1500x1150 / 1200x1100 (see the captureNote in the fingerprint).
    const expected = new Map<string, [number, number]>([
      ['1440x900', [1500, 1150]],
      ['1024x640', [1200, 1100]],
    ]);
    const shots = fp.screenshots as Array<{ file: string; width: number; height: number }>;
    expect(shots.length).toBe(10);
    for (const shot of shots) {
      const full = path.join(process.cwd(), shot.file);
      expect(fs.existsSync(full), `${shot.file} missing`).toBe(true);
      const [w, h] = pngSize(full);
      expect([w, h]).toEqual([shot.width, shot.height]);
      // Every file must sit in one of the two preset directories with a
      // destination-named prefix for one of the five destinations.
      const rel = shot.file.slice('docs/design/screenshots/'.length).split('/');
      expect(rel).toHaveLength(2);
      expect(rel[0] === '1440x900' || rel[0] === '1024x640').toBe(true);
      const prefix = rel[1].split('-')[0];
      expect(['library', 'reader', 'notes', 'review', 'settings']).toContain(prefix);
      const dims = expected.get(rel[0]);
      if (!dims) throw new Error(`unexpected screenshot directory ${rel[0]}`);
      expect([w, h]).toEqual(dims);
    }
  });

  it('the Modernist token source is present with the core tokens', () => {
    const fp = readJson('mockup-fingerprint.json');
    const tokensPath = fp.tokensSource as string;
    const tokenFolder = path.join(designDir, '_ds', 'modernist-8bbe1904-81ef-4318-9bb4-642c31744443');
    expect(tokensPath).toContain('modernist-8bbe1904-81ef-4318-9bb4-642c31744443');
    expect(fs.existsSync(tokenFolder)).toBe(true);

    const css = fs.readFileSync(path.join(tokenFolder, 'styles.css'), 'utf-8');
    expect(css).toContain('--color-accent:');
    expect(css).toContain('--font-heading:');
    expect(css).toContain('--font-body:');
    expect(css).toContain('--radius-md: 0px'); // zero corner radius is a system rule
    for (const rel of ['readme.md', '_ds_manifest.json']) {
      expect(fs.existsSync(path.join(tokenFolder, rel)), `${rel} missing`).toBe(true);
    }
  });

  it('the interaction inventory covers all five destinations and the full handler registry', () => {
    const inv = fs.readFileSync(path.join(designDir, 'interaction-inventory.md'), 'utf-8');
    for (const dest of ['Library', 'Reader', 'Notes', 'Review', 'Settings']) {
      expect(inv).toContain(`| ${dest} | \`d`);
    }
    for (const handler of ['dLibrary', 'dReader', 'dNotes', 'dReview', 'dSettings', 'toggleAI', 'vSingle', 'vFacing', 'zFit', 'z100', 'w1440', 'w1920', 'wmin', 'zen', 'toggleLeft', 'toggleRight', 'rAnn', 'rNote', 'rAi', 'openImport', 'openPrompt', 'reveal', 'hide']) {
      expect(inv, `handler ${handler} missing`).toContain(`\`${handler}\``);
    }
    expect(inv).toContain('Handler registry entries: 31');
    expect(inv).not.toContain('Handler registry entries: 0');
    expect(inv).toContain('Initial state');
    expect(inv).toContain('Variation axes');
  });

  it('the R5 note names every AI surface that must not ship in v1', () => {
    const note = fs.readFileSync(path.join(designDir, 'r5-ai-surfaces.md'), 'utf-8');
    for (const marker of ['Local AI', 'AI tab', 'margin', 'AI & privacy', 'U25', 'aiOn']) {
      expect(note, `R5 note missing ${marker}`).toContain(marker);
    }
  });
});
