import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPdfSecuritySettings,
  scanPdfActions,
  interceptExternalLink,
  validateCspConfiguration,
  readTauriCsp,
  auditCapabilityFile,
  sanitizeDocumentTextAsData,
  TAURI_EXPECTED_CSP,
  ALLOWED_TAURI_PERMISSIONS,
} from './securityBoundary';

const repoRoot = process.cwd();
const tauriConfPath = path.resolve(repoRoot, 'src-tauri', 'tauri.conf.json');
const capabilitiesPath = path.resolve(repoRoot, 'src-tauri', 'capabilities', 'default.json');
const corpusDir = path.resolve(repoRoot, 'corpus');

describe('Task 5.1 PDF & Webview Security Lockdown (PRD §15.3, FR-8.8, FR-12.14)', () => {
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

    const dataLink = interceptExternalLink('data:text/html,<script>alert(1)</script>');
    expect(dataLink.allow).toBe(false);
    expect(dataLink.reason).toContain("Blocked unsafe protocol 'data:'");

    const emptyLink = interceptExternalLink('   ');
    expect(emptyLink.allow).toBe(false);
    expect(emptyLink.reason).toContain('empty');
  });

  it('validates the CSP read from tauri.conf.json (not a constant against itself)', () => {
    const realCsp = readTauriCsp(tauriConfPath);
    expect(realCsp).not.toBeNull();
    expect(validateCspConfiguration(realCsp as string)).toBe(true);
    expect(realCsp).toBe(TAURI_EXPECTED_CSP);

    const unsafeCsp = "default-src 'self' 'unsafe-eval'; script-src *";
    expect(validateCspConfiguration(unsafeCsp)).toBe(false);
  });

  it('audits Tauri capabilities file and verifies minimal permissions without broad fs or shell access', () => {
    const audit = auditCapabilityFile(capabilitiesPath);
    expect(audit.isMinimal).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(audit.allowedPermissions).toEqual([...ALLOWED_TAURI_PERMISSIONS]);
  });

  it('verifies document text is treated as data and control injection is sanitized (FR-12.14)', () => {
    const dirtyText = "Normal text\x00with null byte and\x1Bescape sequences\r\nand clean text.";
    const sanitized = sanitizeDocumentTextAsData(dirtyText);
    expect(sanitized).toBe("Normal textwith null byte andescape sequences\r\nand clean text.");
    expect(sanitized).not.toContain('\x00');
    expect(sanitized).not.toContain('\x1B');
  });
});
