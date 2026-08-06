export interface LaunchValidationResult {
  valid: boolean;
  path: string | null;
  canonicalPath: string | null;
  error: string | null;
}

export interface DeepLinkRoute {
  url: string;
  kind: 'document' | 'note' | 'review';
  id: string;
  page: number | null;
  annotationId: string | null;
}

export interface DeepLinkParseResult {
  valid: boolean;
  route: DeepLinkRoute | null;
  error: string | null;
}

export interface SingleInstanceRouteResult {
  isSingleInstance: boolean;
  targetDocumentPath: string | null;
  deepLink: DeepLinkRoute | null;
  shouldFocusWindow: boolean;
  action: 'open_document' | 'navigate_deep_link' | 'focus_empty' | 'reject';
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
      error: 'Input path is empty',
    };
  }

  // Security check: reject path traversal tricks or illegal protocols
  if (trimmed.includes('\0') || trimmed.startsWith('javascript:')) {
    return {
      valid: false,
      path: trimmed,
      canonicalPath: null,
      error: 'Security scope check failed: dangerous protocol or characters detected',
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
      error: `Invalid file extension '.${ext}'. Only PDF files are supported.`,
    };
  }

  return {
    valid: true,
    path: trimmed,
    canonicalPath: normalizedPath,
    error: null,
  };
}

/**
 * Parses and validates deep links of the form `mereth://...` per PRD §14.2 & OQ-1.
 * Supported formats:
 * - mereth://document/{id}?page={page}&annotation={annotationId}
 * - mereth://note/{id}
 * - mereth://review/{id}
 */
export function parseDeepLinkTS(urlStr: string): DeepLinkParseResult {
  const trimmed = urlStr.trim();
  if (!trimmed.toLowerCase().startsWith('mereth://')) {
    return {
      valid: false,
      route: null,
      error: 'Invalid scheme: must start with mereth://',
    };
  }

  const rest = trimmed.slice(9);
  if (!rest) {
    return {
      valid: false,
      route: null,
      error: 'Empty deep link target',
    };
  }

  const [pathPart, queryPart] = rest.split('?');
  const pathSegments = pathPart.split('/').filter(Boolean);

  if (pathSegments.length === 0) {
    return {
      valid: false,
      route: null,
      error: 'Missing target resource in deep link',
    };
  }

  const kind = pathSegments[0].toLowerCase();
  if (kind !== 'document' && kind !== 'note' && kind !== 'review') {
    return {
      valid: false,
      route: null,
      error: `Unsupported deep link target kind: '${kind}'`,
    };
  }

  if (pathSegments.length < 2) {
    return {
      valid: false,
      route: null,
      error: `Missing ID for deep link target '${kind}'`,
    };
  }

  const id = pathSegments[1];
  let page: number | null = null;
  let annotationId: string | null = null;

  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const pageParam = params.get('page');
    if (pageParam) {
      const parsedPage = parseInt(pageParam, 10);
      if (!isNaN(parsedPage) && parsedPage > 0) {
        page = parsedPage;
      }
    }
    const annotParam = params.get('annotation') ?? params.get('annotation_id');
    if (annotParam) {
      annotationId = annotParam;
    }
  }

  return {
    valid: true,
    route: {
      url: trimmed,
      kind: kind as 'document' | 'note' | 'review',
      id,
      page,
      annotationId,
    },
    error: null,
  };
}

/**
 * Handles single instance routing logic (OQ-18 decision: single window instance).
 * Supports both PDF file paths and `mereth://` deep link URIs.
 */
export function routeSingleInstanceLaunch(launchArgs: string[]): SingleInstanceRouteResult {
  const args = launchArgs.slice(1);

  // Check for deep link arg first
  const deepLinkArg = args.find(arg => arg.trim().toLowerCase().startsWith('mereth://'));
  if (deepLinkArg) {
    const parsed = parseDeepLinkTS(deepLinkArg);
    if (parsed.valid && parsed.route) {
      return {
        isSingleInstance: true,
        targetDocumentPath: null,
        deepLink: parsed.route,
        shouldFocusWindow: true,
        action: 'navigate_deep_link',
      };
    }
    return {
      isSingleInstance: true,
      targetDocumentPath: null,
      deepLink: null,
      shouldFocusWindow: false,
      action: 'reject',
    };
  }

  // Check for PDF file arg
  const pdfArg = args.find(arg => arg.trim().toLowerCase().endsWith('.pdf'));
  if (pdfArg) {
    const validation = validateLaunchPathTS(pdfArg);
    if (validation.valid) {
      return {
        isSingleInstance: true,
        targetDocumentPath: validation.canonicalPath,
        deepLink: null,
        shouldFocusWindow: true,
        action: 'open_document',
      };
    }
    return {
      isSingleInstance: true,
      targetDocumentPath: null,
      deepLink: null,
      shouldFocusWindow: false,
      action: 'reject',
    };
  }

  return {
    isSingleInstance: true,
    targetDocumentPath: null,
    deepLink: null,
    shouldFocusWindow: true,
    action: 'focus_empty',
  };
}
