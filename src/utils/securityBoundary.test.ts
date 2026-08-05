import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPdfSecuritySettings,
  scanPdfActions,
  interceptExternalLink,
  validateCspConfiguration,
  readTauriCsp,
  TAURI_EXPECTED_CSP
} from './securityBoundary';

const repoRoot = process.cwd();
const tauriConfPath = path.resolve(repoRoot, 'src-tauri', 'tauri.conf.json');
const corpusDir = path.resolve(repoRoot, 'corpus');

describe('R0.7 Hostile-Document Security Boundary Proofs', () => {
  it('enforces disableScripting and isEvalSupported=false in PDF rendering options', () => {
    const settings = getPdfSecuritySettings();
    expect(settings.disableScripting).toBe(true);
    expect(settings.isEvalSupported).toBe(false);
  });

  it('scans PDF structure and rejects embedded JS, executable launch, and auto actions', () => {
    const cleanPdf = '%PDF-1.7 ... 1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj';
    const cleanScan = scanPdfActions(cleanPdf);
    expect(cleanScan.isSafe).toBe(true);
    expect(cleanScan.blockedActions).toEqual([]);

    const maliciousPdf =
      '%PDF-1.7 ... /JS (app.alert("hacked")) /OpenAction << /S /Launch /F (cmd.exe) >>';
    const maliciousScan = scanPdfActions(maliciousPdf);
    expect(maliciousScan.isSafe).toBe(false);
    expect(maliciousScan.blockedActions).toContain('embedded_javascript');
    expect(maliciousScan.blockedActions).toContain('executable_launch');
    expect(maliciousScan.blockedActions).toContain('automatic_action');
    expect(maliciousScan.rejectedReason).toContain('Hostile action(s) detected');
  });

  it('exercises the real hostile /JS corpus fixture through the action scanner', () => {
    // PRD §15.3 requires the boundary to be exercised against a hostile sample,
    // not merely declared. The corpus hostile_javascript.pdf carries a real
    // /OpenAction /JS; the scanner must flag it.
    const hostileBytes = fs.readFileSync(path.join(corpusDir, 'hostile_javascript.pdf'));
    const scan = scanPdfActions(hostileBytes.toString('latin1'));
    expect(scan.isSafe).toBe(false);
    expect(scan.blockedActions).toContain('embedded_javascript');
    expect(scan.blockedActions).toContain('automatic_action');
  });

  it('intercepts external link URLs, allowing http/https and blocking unsafe protocols', () => {
    const httpLink = interceptExternalLink('https://example.gov/opinions/23-123.pdf');
    expect(httpLink.allow).toBe(true);
    expect(httpLink.sanitizedUrl).toBe('https://example.gov/opinions/23-123.pdf');

    const fileLink = interceptExternalLink('file:///C:/Windows/System32/cmd.exe');
    expect(fileLink.allow).toBe(false);
    expect(fileLink.reason).toContain("Blocked unsafe protocol 'file:'");

    const jsLink = interceptExternalLink('javascript:alert(document.cookie)');
    expect(jsLink.allow).toBe(false);
    expect(jsLink.reason).toContain("Blocked unsafe protocol 'javascript:'");
  });

  it('validates the CSP read from tauri.conf.json (not a constant against itself)', () => {
    // Regression: the CSP must be read from the real config so a drift in
    // tauri.conf.json is caught here, rather than validating a hard-coded copy.
    const realCsp = readTauriCsp(tauriConfPath);
    expect(realCsp).not.toBeNull();
    expect(validateCspConfiguration(realCsp as string)).toBe(true);

    // The shipped config and the sentinel constant must agree.
    expect(realCsp).toBe(TAURI_EXPECTED_CSP);

    const unsafeCsp = "default-src 'self' 'unsafe-eval'; script-src *";
    expect(validateCspConfiguration(unsafeCsp)).toBe(false);
  });
});
