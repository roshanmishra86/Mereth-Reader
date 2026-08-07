export type DocumentErrorType =
  | 'malformed'
  | 'password_required'
  | 'password_rejected'
  | 'missing_file'
  | 'permission_denied'
  | 'scanned_pdf'
  | 'version_mismatch'
  | 'renderer_crash';

export interface RecoveryStateDetails {
  errorType: DocumentErrorType;
  title: string;
  message: string;
  recommendedAction: string;
  primaryButtonText: string;
  secondaryButtonText?: string;
  isRecoverable: boolean;
}

export function mapErrorToRecoveryState(
  errorType: DocumentErrorType,
  options?: { filePath?: string; pageCount?: number; detail?: string }
): RecoveryStateDetails {
  const pathText = options?.filePath ? ` (${options.filePath})` : '';

  switch (errorType) {
    case 'malformed':
      return {
        errorType: 'malformed',
        title: 'Malformed or Unsupported PDF',
        message: options?.detail || `The file${pathText} could not be read because it is corrupted, invalid, or uses unsupported PDF features.`,
        recommendedAction: 'Return to your library or import a valid PDF file.',
        primaryButtonText: 'Return to Library',
        secondaryButtonText: 'Remove Document',
        isRecoverable: false,
      };

    case 'password_required':
      return {
        errorType: 'password_required',
        title: 'Password-Protected PDF',
        message: `This document${pathText} is encrypted with a password. Please enter the password to unlock reading.`,
        recommendedAction: 'Enter the password below. Decrypted document data stays in volatile memory only.',
        primaryButtonText: 'Unlock Document',
        secondaryButtonText: 'Cancel & Close',
        isRecoverable: true,
      };

    case 'password_rejected':
      return {
        errorType: 'password_rejected',
        title: 'Incorrect Password',
        message: 'The password entered was invalid or could not decrypt the PDF stream.',
        recommendedAction: 'Please double-check caps lock and try entering the password again.',
        primaryButtonText: 'Retry Password',
        secondaryButtonText: 'Cancel & Close',
        isRecoverable: true,
      };

    case 'missing_file':
      return {
        errorType: 'missing_file',
        title: 'File Moved or Missing',
        message: `The document file at ${options?.filePath || 'the specified path'} could not be found on disk.`,
        recommendedAction: 'Locate the moved file on your storage or remove this record from your library.',
        primaryButtonText: 'Locate File...',
        secondaryButtonText: 'Remove from Library',
        isRecoverable: true,
      };

    case 'permission_denied':
      return {
        errorType: 'permission_denied',
        title: 'Permission Denied',
        message: `Access was denied when attempting to read ${options?.filePath || 'the document file'}.`,
        recommendedAction: 'Check operating system file permissions or copy the file to a readable folder.',
        primaryButtonText: 'Try Again',
        secondaryButtonText: 'Return to Library',
        isRecoverable: true,
      };

    case 'scanned_pdf':
      return {
        errorType: 'scanned_pdf',
        title: 'Image-Only / Scanned PDF',
        message: 'This document contains scanned images without an embedded text layer. Text selection and search are unavailable.',
        recommendedAction: 'You can use Area Capture to annotate passages or figures on image pages.',
        primaryButtonText: 'Use Area Capture',
        secondaryButtonText: 'Dismiss Warning',
        isRecoverable: true,
      };

    case 'version_mismatch':
      return {
        errorType: 'version_mismatch',
        title: 'Document Version Changed',
        message: `The file content at ${options?.filePath || 'this path'} has changed since annotations were created. Existing anchors may require re-anchoring review.`,
        recommendedAction: 'Re-anchor existing annotations against the updated file geometry.',
        primaryButtonText: 'Re-anchor Annotations',
        secondaryButtonText: 'Ignore Warning',
        isRecoverable: true,
      };

    case 'renderer_crash':
      return {
        errorType: 'renderer_crash',
        title: 'PDF Renderer Error',
        message: options?.detail || 'The PDF page canvas renderer encountered an unexpected rendering error.',
        recommendedAction: 'Retry rendering the current page or return to the library.',
        primaryButtonText: 'Retry Rendering',
        secondaryButtonText: 'Return to Library',
        isRecoverable: true,
      };

    default:
      return {
        errorType: 'malformed',
        title: 'Document Error',
        message: 'An unexpected document error occurred.',
        recommendedAction: 'Return to Library.',
        primaryButtonText: 'Return to Library',
        isRecoverable: false,
      };
  }
}

export function validatePdfPassword(
  password: string
): { isValid: boolean; error?: string } {
  if (!password || password.trim() === '') {
    return {
      isValid: false,
      error: 'Password cannot be empty.',
    };
  }
  if (password.length < 1) {
    return {
      isValid: false,
      error: 'Please enter a valid password.',
    };
  }
  return {
    isValid: true,
  };
}

export function detectScannedPdf(
  textItemsCount: number,
  pageCount: number = 1,
  hasImageContent: boolean = true
): { isScanned: boolean; message: string; availableActions: string[] } {
  const itemsPerPage = textItemsCount / Math.max(1, pageCount);
  const isScanned = itemsPerPage < 5 && hasImageContent;

  if (isScanned) {
    return {
      isScanned: true,
      message:
        'Image-only / scanned PDF detected: This page contains image content without a selectable text layer. Text selection and search are unavailable.',
      availableActions: ['area_capture', 'dismiss_warning'],
    };
  }

  return {
    isScanned: false,
    message: 'Standard text PDF with selectable text layer.',
    availableActions: ['text_highlight', 'area_capture', 'text_search'],
  };
}

export type EmptyStateViewType =
  | 'library'
  | 'search'
  | 'outline'
  | 'annotations'
  | 'collections'
  | 'jobs';

export interface EmptyStateDetails {
  viewType: EmptyStateViewType;
  icon: string;
  title: string;
  description: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
}

export function getEmptyStateDetails(
  viewType: EmptyStateViewType,
  context?: { searchQuery?: string; collectionName?: string }
): EmptyStateDetails {
  switch (viewType) {
    case 'library':
      return {
        viewType: 'library',
        icon: '📚',
        title: 'Library is empty',
        description: 'Open a PDF to begin reading. It will be added to your Library automatically.',
        primaryActionLabel: 'Open PDF',
        secondaryActionLabel: 'Import a copy',
      };

    case 'search':
      const q = context?.searchQuery ? `"${context.searchQuery}"` : 'your query';
      return {
        viewType: 'search',
        icon: '🔍',
        title: 'No matching search results',
        description: `No documents or passages matched ${q}. Try checking your spelling, using broader terms, or clearing active filters.`,
        primaryActionLabel: 'Clear Search',
      };

    case 'outline':
      return {
        viewType: 'outline',
        icon: '☰',
        title: 'No document outline',
        description: 'This PDF does not contain a table of contents or bookmarks structure. You can use page numbers or search to navigate.',
      };

    case 'annotations':
      return {
        viewType: 'annotations',
        icon: '✎',
        title: 'No annotations yet',
        description: 'Select text on any page to highlight or create evidence blocks. Area capture is also available for figures.',
      };

    case 'collections':
      return {
        viewType: 'collections',
        icon: '📁',
        title: 'No collections created',
        description: 'Collections allow you to organize documents into projects or subjects.',
        primaryActionLabel: '+ New Collection',
      };

    case 'jobs':
      return {
        viewType: 'jobs',
        icon: '⚙️',
        title: 'No active or background tasks',
        description: 'Background text extraction, page thumbnail generation, and indexing tasks will appear here.',
      };

    default:
      return {
        viewType: 'library',
        icon: '📄',
        title: 'No items',
        description: 'No data available.',
      };
  }
}
