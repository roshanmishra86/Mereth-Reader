import { describe, it, expect } from 'vitest';
import {
  validateLaunchPathTS,
  parseDeepLinkTS,
  routeSingleInstanceLaunch,
} from './launchRouting';

describe('R0.6 & Task 2.3 Windows File Association & Launch Routing', () => {
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

  it('routes single instance PDF launch arguments according to OQ-18 decision', () => {
    const argsWithPdf = ['mereth-reader.exe', 'C:\\Documents\\Affidavit.pdf'];
    const routeDoc = routeSingleInstanceLaunch(argsWithPdf);

    expect(routeDoc.isSingleInstance).toBe(true);
    expect(routeDoc.targetDocumentPath).toBe('C:/Documents/Affidavit.pdf');
    expect(routeDoc.deepLink).toBeNull();
    expect(routeDoc.shouldFocusWindow).toBe(true);
    expect(routeDoc.action).toBe('open_document');

    const argsNoPdf = ['mereth-reader.exe', '--minimized'];
    const routeEmpty = routeSingleInstanceLaunch(argsNoPdf);

    expect(routeEmpty.isSingleInstance).toBe(true);
    expect(routeEmpty.targetDocumentPath).toBeNull();
    expect(routeEmpty.action).toBe('focus_empty');
  });

  describe('Deep link parsing (mereth:// scheme per PRD §14.2 & OQ-1)', () => {
    it('parses document deep links with page and annotation parameters', () => {
      const url = 'mereth://document/doc-sample-1?page=5&annotation=recall';
      const parsed = parseDeepLinkTS(url);

      expect(parsed.valid).toBe(true);
      expect(parsed.error).toBeNull();
      expect(parsed.route).toEqual({
        url,
        kind: 'document',
        id: 'doc-sample-1',
        page: 5,
        annotationId: 'recall',
      });
    });

    it('parses note and review deep links', () => {
      const noteParsed = parseDeepLinkTS('mereth://note/note-101');
      expect(noteParsed.valid).toBe(true);
      expect(noteParsed.route).toEqual({
        url: 'mereth://note/note-101',
        kind: 'note',
        id: 'note-101',
        page: null,
        annotationId: null,
      });

      const reviewParsed = parseDeepLinkTS('mereth://review/rev-202');
      expect(reviewParsed.valid).toBe(true);
      expect(reviewParsed.route).toEqual({
        url: 'mereth://review/rev-202',
        kind: 'review',
        id: 'rev-202',
        page: null,
        annotationId: null,
      });
    });

    it('rejects invalid schemes and malformed deep link URLs', () => {
      expect(parseDeepLinkTS('https://google.com').valid).toBe(false);
      expect(parseDeepLinkTS('mereth://').valid).toBe(false);
      expect(parseDeepLinkTS('mereth://invalid_kind/123').valid).toBe(false);
      expect(parseDeepLinkTS('mereth://document').valid).toBe(false);
    });

    it('routes single instance launch arguments with deep link URIs', () => {
      const args = ['mereth-reader.exe', 'mereth://document/doc-sample-1?page=8'];
      const route = routeSingleInstanceLaunch(args);

      expect(route.isSingleInstance).toBe(true);
      expect(route.action).toBe('navigate_deep_link');
      expect(route.shouldFocusWindow).toBe(true);
      expect(route.deepLink).toEqual({
        url: 'mereth://document/doc-sample-1?page=8',
        kind: 'document',
        id: 'doc-sample-1',
        page: 8,
        annotationId: null,
      });
    });
  });
});
