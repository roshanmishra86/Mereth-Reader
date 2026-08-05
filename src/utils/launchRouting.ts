export interface LaunchValidationResult {
  valid: boolean;
  path: string | null;
  canonicalPath: string | null;
  error: string | null;
}

export interface SingleInstanceRouteResult {
  isSingleInstance: boolean;
  targetDocumentPath: string | null;
  shouldFocusWindow: boolean;
  action: 'open_document' | 'focus_empty' | 'reject';
}

/**
 * Validates file path for PDF extension, non-empty, and security constraints in TS.
 */
export function validateLaunchPathTS(inputPath: string): LaunchValidationResult {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return {
      valid: false,
      path: null,
      canonicalPath: null,
      error: 'Input path is empty'
    };
  }

  // Security check: reject path traversal tricks or illegal protocols
  if (trimmed.includes('\0') || trimmed.startsWith('javascript:')) {
    return {
      valid: false,
      path: trimmed,
      canonicalPath: null,
      error: 'Security scope check failed: dangerous protocol or characters detected'
    };
  }

  // Extract extension
  const normalizedPath = trimmed.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() ?? '';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext !== 'pdf') {
    return {
      valid: false,
      path: trimmed,
      canonicalPath: null,
      error: `Invalid file extension '.${ext}'. Only PDF files are supported.`
    };
  }

  return {
    valid: true,
    path: trimmed,
    canonicalPath: normalizedPath,
    error: null
  };
}

/**
 * Handles single instance routing logic (OQ-18 decision: single window instance).
 */
export function routeSingleInstanceLaunch(launchArgs: string[]): SingleInstanceRouteResult {
  // Skip executable name (arg 0)
  const args = launchArgs.slice(1);
  const pdfArg = args.find(arg => arg.toLowerCase().endsWith('.pdf'));

  if (!pdfArg) {
    return {
      isSingleInstance: true,
      targetDocumentPath: null,
      shouldFocusWindow: true,
      action: 'focus_empty'
    };
  }

  const validation = validateLaunchPathTS(pdfArg);
  if (!validation.valid) {
    return {
      isSingleInstance: true,
      targetDocumentPath: null,
      shouldFocusWindow: false,
      action: 'reject'
    };
  }

  return {
    isSingleInstance: true,
    targetDocumentPath: validation.canonicalPath,
    shouldFocusWindow: true,
    action: 'open_document'
  };
}
