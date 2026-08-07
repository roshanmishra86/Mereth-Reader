import fs from 'node:fs';

export interface PdfSecurityOptions {
  disableScripting: boolean;
  isEvalSupported: boolean;
}

export interface SecurityScanResult {
  isSafe: boolean;
  blockedActions: string[];
  rejectedReason: string | null;
}

export interface ExternalLinkDecision {
  allow: boolean;
  sanitizedUrl: string | null;
  reason: string;
}

/**
 * The CSP the application expects to ship. Kept as a constant ONLY as a
 * regression sentinel — the binding test reads the CSP straight out of
 * `tauri.conf.json` (see `readTauriCsp`) so a config drift is caught, rather
 * than validating this constant against itself.
 */
export const TAURI_EXPECTED_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data:; font-src 'self' data:;";

/**
 * Reads the CSP actually declared in `src-tauri/tauri.conf.json` so the security
 * boundary test exercises the real configuration instead of a hard-coded copy.
 */
export function readTauriCsp(configPath: string): string | null {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const cfg = JSON.parse(raw) as { app?: { security?: { csp?: string } } };
  return cfg.app?.security?.csp ?? null;
}

/**
 * Returns security settings for PDF.js document loader.
 */
export function getPdfSecuritySettings(): PdfSecurityOptions {
  return {
    disableScripting: true,
    isEvalSupported: false
  };
}

/**
 * Scans raw PDF dictionary objects or action strings for prohibited actions:
 * embedded JavaScript (/JS, /JavaScript), /Launch executables, auto-actions (/AA, /OpenAction).
 *
 * NOTE: this is a lightweight defense-in-depth scan over raw PDF bytes. PDF
 * action keys are case-sensitive (`/JS`, not `/js`), so the regexes below are
 * case-sensitive to avoid false positives on benign keys like `/js` or `/aa`.
 * Object streams compressed with `/FlateDecode` (`/ObjStm`) are NOT decoded
 * here; a hostile PDF can hide `/JS` or `/OpenAction` inside a compressed
 * stream and pass this scan. Treat a clean result as a signal, not a proof —
 * the authoritative controls are PDF.js `disableScripting` and the CSP, which
 * run regardless of what this scan reports.
 */
export function scanPdfActions(pdfRawContent: string): SecurityScanResult {
  const blockedActions: string[] = [];

  if (/\/JS\b|\/JavaScript\b/.test(pdfRawContent)) {
    blockedActions.push('embedded_javascript');
  }
  if (/\/Launch\b/.test(pdfRawContent)) {
    blockedActions.push('executable_launch');
  }
  if (/\/AA\b|\/OpenAction\b/.test(pdfRawContent)) {
    blockedActions.push('automatic_action');
  }

  const isSafe = blockedActions.length === 0;
  return {
    isSafe,
    blockedActions,
    rejectedReason: isSafe
      ? null
      : `Hostile action(s) detected and blocked: ${blockedActions.join(', ')}`
  };
}

/**
 * Intercepts external link navigation requests. Only permits http/https protocols;
 * blocks file://, javascript:, cmd:, shell execution, etc.
 */
export function interceptExternalLink(rawUrl: string): ExternalLinkDecision {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      allow: false,
      sanitizedUrl: null,
      reason: 'URL is empty'
    };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === 'http:' || protocol === 'https:') {
      return {
        allow: true,
        sanitizedUrl: parsed.toString(),
        reason: 'Safe web protocol permitted'
      };
    }

    return {
      allow: false,
      sanitizedUrl: null,
      reason: `Blocked unsafe protocol '${protocol}'`
    };
  } catch {
    return {
      allow: false,
      sanitizedUrl: null,
      reason: 'Malformed URL structure'
    };
  }
}

/**
 * Validates a Content Security Policy (CSP) string against security requirements:
 * `default-src 'self'`, no `'unsafe-eval'`, and no wildcard/unsafe-inline `script-src`.
 */
export function validateCspConfiguration(cspString: string): boolean {
  if (!cspString) return false;
  const lower = cspString.toLowerCase();

  const hasDefaultSelf = lower.includes("default-src 'self'");
  const noUnsafeEval = !lower.includes("'unsafe-eval'");
  const scriptSelf =
    !lower.includes('script-src *') && !lower.includes("script-src 'unsafe-inline'");

  return hasDefaultSelf && noUnsafeEval && scriptSelf;
}
