import { describe, it, expect } from 'vitest';
import { validateLaunchPathTS, routeSingleInstanceLaunch } from './launchRouting';

describe('R0.6 Windows File Association & Launch Routing', () => {
  it('validates PDF extension and normalizes file paths', () => {
    const valid = validateLaunchPathTS('C:\\Users\\Legal\\Brief.pdf');
    expect(valid.valid).toBe(true);
    expect(valid.canonicalPath).toBe('C:/Users/Legal/Brief.pdf');
    expect(valid.error).toBeNull();
  });

  it('rejects non-PDF files and empty paths', () => {
    const empty = validateLaunchPathTS('   ');
    expect(empty.valid).toBe(false);
    expect(empty.error).toBe('Input path is empty');

    const txt = validateLaunchPathTS('contract.docx');
    expect(txt.valid).toBe(false);
    expect(txt.error).toContain('Only PDF files are supported');
  });

  it('enforces security scope checks against malicious inputs', () => {
    const malformed = validateLaunchPathTS('javascript:alert(1).pdf');
    expect(malformed.valid).toBe(false);
    expect(malformed.error).toContain('Security scope check failed');
  });

  it('routes single instance launch arguments according to OQ-18 decision', () => {
    const argsWithPdf = ['mereth-reader.exe', 'C:\\Documents\\Affidavit.pdf'];
    const routeDoc = routeSingleInstanceLaunch(argsWithPdf);

    expect(routeDoc.isSingleInstance).toBe(true);
    expect(routeDoc.targetDocumentPath).toBe('C:/Documents/Affidavit.pdf');
    expect(routeDoc.shouldFocusWindow).toBe(true);
    expect(routeDoc.action).toBe('open_document');

    const argsNoPdf = ['mereth-reader.exe', '--minimized'];
    const routeEmpty = routeSingleInstanceLaunch(argsNoPdf);

    expect(routeEmpty.isSingleInstance).toBe(true);
    expect(routeEmpty.targetDocumentPath).toBeNull();
    expect(routeEmpty.action).toBe('focus_empty');
  });
});
