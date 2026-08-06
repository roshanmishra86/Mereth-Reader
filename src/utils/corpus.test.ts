import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CorpusEntry,
  REQUIRED_CORPUS_CATEGORIES,
  computeBufferSha256,
  validateCorpusManifest
} from './corpus';

describe('R0.1 Legal PDF Regression Corpus', () => {
  const corpusDir = path.resolve(process.cwd(), 'corpus');
  const manifestPath = path.join(corpusDir, 'manifest.json');

  it('manifest.json exists and is valid JSON', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content) as CorpusEntry[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(15);
  });

  it('verifies manifest structure and category completeness', () => {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const entries = JSON.parse(content) as CorpusEntry[];
    const result = validateCorpusManifest(entries);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('contains all 15 required corpus categories', () => {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const entries = JSON.parse(content) as CorpusEntry[];
    const categories = entries.map(e => e.category);

    for (const category of REQUIRED_CORPUS_CATEGORIES) {
      expect(categories).toContain(category);
    }
  });

  it('verifies physical PDF files exist and matches SHA-256 hash for each entry', () => {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const entries = JSON.parse(content) as CorpusEntry[];

    for (const entry of entries) {
      const filePath = path.join(corpusDir, entry.filename);
      expect(fs.existsSync(filePath)).toBe(true);

      const fileBuffer = fs.readFileSync(filePath);
      const computedSha = computeBufferSha256(fileBuffer);
      expect(computedSha).toBe(entry.sha256);
    }
  });
});
