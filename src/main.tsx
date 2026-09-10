import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { perfMark } from "./perf/perfMark";
import "./styles.css";
import {
  createNavigationHistory,
  pushNavigationHistory,
  navigateHistoryBack,
  navigateHistoryForward,
  extractOrderedText,
  PageTextContent,
} from "./utils/pdfUtils";
import { createDocumentRecord, DocumentRecord, OwnershipMode } from "./utils/pdfImport";
import {
  loadPdfDocument,
  evictPdfDocument,
  extractPdfPageTexts,
  getPdfPageTextItems,
  getPdfPageBaseSize,
  LoadedPdfInfo,
} from "./utils/pdfViewer";
import { ImportModal } from "./components/ImportModal";
import { Icon, IconName } from "./components/icons";
import { MissingFileBanner } from "./components/MissingFileBanner";
import { DeepLinkRoute, parseDeepLinkTS } from "./utils/launchRouting";
import {
  measurePdfPageGeometry,
  selectReanchorActions,
  VersionCheckResult,
  DocumentVersionRecord,
  StoredAnnotation,
} from "./utils/versionAnchoring";
import {
  LayoutMode,
  RotationAngle,
  PageSize,
  calculateZoom,
  calculateFitScale,
  rotateView,
  DEFAULT_PAGE_SIZE,
} from "./utils/viewModeUtils";
import { ReaderCanvas } from "./components/ReaderCanvas";
import { SearchOptions, performAdvancedSearch, getNextMatchIndex, DEFAULT_SEARCH_OPTIONS, searchDocumentTextFts, DetailedSearchMatch } from "./utils/searchUtils";
import { loadVersionedPageTexts, persistVersionedPageTexts } from "./utils/pageTextIo";
import { resolveOutlineTree, type ParsedOutlineNode } from "./utils/navigationUtils";
import { resolveShortcutAction } from "./utils/shortcutUtils";
import { getPdfPageEmbeddedAnnotations } from "./utils/pdfViewer";
import { durableIndexer, IndexingStatus } from "./utils/durableIndexing";
import {
  ParsedEmbeddedAnnotation,
  EmbeddedImportPreview,
  buildEmbeddedImportRecord,
  classifyEmbeddedAnnotations,
  countImportPreviews,
  mappedAnnotationTypeForSubtype,
  matchPaletteKeyForRgb,
} from "./utils/embeddedAnnotations";
import { EmbeddedImportModal } from "./components/EmbeddedImportModal";
import { AnnotationFilters, EMPTY_ANNOTATION_FILTERS, applyAnnotationFilters } from "./utils/annotationFilter";
import { ReaderToolbar } from "./components/ReaderToolbar";
import { LeftSidebar } from "./components/LeftSidebar";
import { SettingsShortcuts } from "./components/SettingsShortcuts";
import { LibraryView } from "./components/LibraryView";
import { NotesView } from "./components/NotesView";
import { NotesWorkspace } from "./components/NotesWorkspace";
import { JobQueueDrawer } from "./components/JobQueueDrawer";
import { DuplicateConfirmModal } from "./components/DuplicateConfirmModal";
import { CollectionItem } from "./utils/libraryUtils";
import { BackgroundJob, JobQueueManager, createBackgroundJob, prioritizePageWindow } from "./utils/jobQueue";
import { DuplicateConfirmationState, checkDuplicateFingerprint, resolveDuplicateAction, DuplicateResolutionAction } from "./utils/duplicateCheck";
import {
  ReadingSessionState,
  createDefaultReadingSession,
  validateAndSanitizeReadingSession,
  zoomScaleToPercentage,
  zoomPercentageToScale,
  DEFAULT_LAYOUT_BOUNDS,
} from "./utils/sessionRestore";
import {
  AppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_MIN_CANVAS_WIDTH,
  getPageDimmingStyle,
  parseSettingsRows,
  resolvePaneCollapseOrder,
  resolveReducedMotion,
  resolveTextScale,
  resolveTheme,
  serializeSettingValue,
} from "./utils/appearanceUtils";
import { SettingsAppearance } from "./components/SettingsAppearance";
import { PasswordDialog } from "./components/PasswordDialog";
import { ExternalLinkModal } from "./components/ExternalLinkModal";
import { ScannedPdfBanner } from "./components/ScannedPdfBanner";
import { VersionMismatchBanner } from "./components/VersionMismatchBanner";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import { MalformedDocumentView } from "./components/MalformedDocumentView";
import { EmptyState } from "./components/EmptyState";
import { validatePdfPassword } from "./utils/recoveryUtils";
import { formatExtendedPageLabel } from "./utils/navigationUtils";
// Task 3.4 annotation creation and durable anchors (PRD R2)
import {
  AnnotationRecord,
  AnnotationAssetRecord,
  ANNOTATION_TYPES,
  PaletteEntry,
  DEFAULT_ANNOTATION_PALETTE,
  DEFAULT_ANNOTATION_COLOR,
  buildAreaAnnotation,
  buildAreaAssetRecord,
  buildBookmarkAnnotation,
  buildCommentAnnotation,
  buildTextAnnotation,
  paletteColorFor,
  paletteLabelFor,
} from "./utils/annotationTypes";
import { AnnotationAssetVisual } from "./components/PageAnnotationLayer";
import { SelectionPopup, SelectionPopupAnchor } from "./components/SelectionPopup";
import { AreaCaptureLayer, AreaCaptureResult } from "./components/AreaCaptureLayer";
import {
  createAnnotation,
  createAreaCapture,
  loadAnnotationAssets,
  readAnnotationAssetBlob,
  restoreAnnotation,
  trashAnnotation,
  purgeAnnotation,
  updateAnnotationFields,
} from "./utils/annotationIo";
// Task 3.5 — palette configuration, in-session undo, quote/comment separation
import { AnnotationEditor } from "./components/AnnotationEditor";
import { SettingsAnnotations } from "./components/SettingsAnnotations";
import { AnnotationUndoManager } from "./utils/annotationUndo";
import {
  ANNOTATION_PALETTE_SETTING_KEY,
  parsePalette,
  serializePalette,
} from "./utils/annotationPalette";
import {
  PageBox,
  ViewportRect,
  buildQuoteContext,
  computeTextLayerChecksum,
  dragBoxToNormalized,
  mergeSelectionRects,
} from "./utils/annotationAnchor";
import type { EvidenceBlockRecord } from "./utils/evidenceTypes";
import { createEvidenceBlockFromAnnotation } from "./utils/evidenceTypes";
import { addEvidenceBlock } from "./utils/evidenceIo";
import type { ReviewPromptRecord } from "./utils/promptTypes";
import { PromptEditorModal } from "./components/PromptEditorModal";
import { createReviewPrompt, getReviewPrompt, listReviewPrompts, updateReviewPrompt } from "./utils/promptsIo";
import type { ReviewOutcome } from "./utils/fsrsScheduler";
import { formatIntervalPreview, scheduleReview } from "./utils/fsrsScheduler";
import {
  clearActiveReviewSession,
  createReviewSession,
  getActiveReviewSession,
  pruneReviewSessionQueue,
  reconcileReviewSession,
  requeueCardForRelearning,
  revealCurrentCard,
  rewindReviewSession,
  setActiveReviewSession,
  submitCurrentReview,
  updateUserResponse,
  formatReviewPromptLink,
  type ReviewSessionCard,
  type ReviewSessionState,
} from "./utils/reviewSession";
import { ReviewUndoStack, undoReviewEvent, defaultReviewDb } from "./utils/reviewUndo";
import { renderClozeCard, getUniqueClozeIndices } from "./utils/cloze";
import type { DueReviewPromptRecord, ReviewQueueStats } from "./utils/reviewIo";
import { getDailyReviewUsage, getDueReviewPrompts, getReviewHistory, getReviewQueueStats, getRecentReviewEvents, getReviewSchedule, recordReviewEvent, undoReviewEventIpc } from "./utils/reviewIo";
import { limitReviewSession } from "./utils/reviewSession";
import type { RecentReviewEventRecord } from "./utils/reviewIo";
import { PromptRepairModal } from "./components/PromptRepairModal";
import { SettingsReview } from "./components/SettingsReview";
import { hasRepeatedFailures, type PromptRepairResult } from "./utils/promptRepair";
import { applyQueueControl, DEFAULT_REVIEW_QUEUE_PREFERENCES, type ReviewQueuePreferences } from "./utils/queueControls";
const REVIEW_QUEUE_PREFERENCES_SETTING_KEY = "review_queue_preferences";
import { createNote, createQuickNote, listNotes, listNoteSourceAnchors, trashNote, updateNote } from "./utils/notesIo";
import { createDefaultNoteRecord, quickNoteTitle, isAutoDerivedTitle, type NoteRecord, type NoteSourceAnchorRecord, type QuickNoteSourceSnapshot } from "./utils/notesTypes";
import { AutosaveCoordinator, flushAllPendingSaves, getRecoverableDraft, registerPendingSaveHandler } from "./utils/noteRevisions";
import { QuickNoteComposer } from "./components/QuickNoteComposer";
import { SessionSynthesisModal } from "./components/SessionSynthesisModal";
import { renderMarkdownToHtml } from "./utils/markdownRenderer";
import { resolveDeepLinkUiAction } from "./utils/deepLinkRouter";
import { ExportModal, type ExportFormat } from "./components/ExportModal";
import { RestoreBackupModal } from "./components/RestoreBackupModal";
import { DiagnosticExportModal } from "./components/DiagnosticExportModal";
import { buildDiagnosticReport } from "./utils/diagnosticExport";
import { DestinationConflictModal } from "./components/DestinationConflictModal";
import { chooseNativeExportDestination } from "./utils/nativeExportDestination";
import { SettingsUpdates, UpdateConsentDialog, UpdateToast, useUpdateCenter, type UpdateCenterModel } from './components/UpdateCenter';
import { pendingWork } from './utils/pendingWork';
import {
  checkDestination,
  resolveDestinationSafety,
  suggestCopyPath,
  type DestinationSnapshot,
} from "./utils/destinationSafety";

type Destination = "library" | "reader" | "notes" | "knowledge" | "review" | "settings";

interface LaunchRoutePayload {
  is_single_instance?: boolean;
  isSingleInstance?: boolean;
  target_document_path?: string | null;
  targetDocumentPath?: string | null;
  deep_link?: {
    url: string;
    kind: "document" | "note" | "review";
    id: string;
    page: number | null;
    annotation_id?: string | null;
    annotationId?: string | null;
  } | null;
  deepLink?: DeepLinkRoute | null;
  focus_existing_window?: boolean;
}

const nav = [
  ["library", "Library", "library"],
  ["reader", "Reader", "reader"],
  ["notes", "Notes", "notes"],
  ["knowledge", "Knowledge", "knowledge"],
  ["review", "Review", "review"],
] as const;

/** Loads a document's annotations in one pass: active rows + trashed rows. */
async function loadAnnotationSets(documentId: string): Promise<{
  active: AnnotationRecord[];
  trashed: AnnotationRecord[];
}> {
  const [active, withTrash] = await Promise.all([
    invoke<AnnotationRecord[]>("db_get_annotations_for_document", { documentId, includeTrashed: false }),
    invoke<AnnotationRecord[]>("db_get_annotations_for_document", { documentId, includeTrashed: true }),
  ]);
  return {
    active: active ?? [],
    trashed: (withTrash ?? []).filter((a) => a.deleted_at !== null),
  };
}

function Glyph({ name }: { name: IconName }) {
  return <Icon name={name} />;
}

function App() {
  // The app opens to the Library. With no documents it shows honest empty
  // states — there is no bundled demo document and no fabricated content.
  const [destination, setDestination] = useState<Destination>("library");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"annotations" | "note">("annotations");
  const [selected, setSelected] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [initialImportPath, setInitialImportPath] = useState<string | null>(null);
  const [pdfEntryMode, setPdfEntryMode] = useState<'open' | 'import'>('open');
  const [readingOnly, setReadingOnly] = useState(false);

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [removedDocuments, setRemovedDocuments] = useState<DocumentRecord[]>([]);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
  const documentsRef = useRef<DocumentRecord[]>([]);
  const dbReadyRef = useRef(false);
  const [dbReady, setDbReady] = useState(false);
  const pendingLaunchRoutesRef = useRef<LaunchRoutePayload[]>([]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  const [activeSession, setActiveSession] = useState<ReadingSessionState | null>(null);
  const [collections, setCollections] = useState<CollectionItem[]>([]);

  // Background Jobs state
  const jobQueueManager = useMemo(() => new JobQueueManager(), []);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [jobDrawerOpen, setJobDrawerOpen] = useState(false);
  // The extraction job tied to the currently open document, so cancel /
  // restart / progress stay truthful for the document being read.
  const [activeExtractionJobId, setActiveExtractionJobId] = useState<string | null>(null);
  // Duplicate Confirmation state
  const [duplicateConfirmState, setDuplicateConfirmState] = useState<DuplicateConfirmationState | null>(null);

  // Recovery & Password Dialog state
  const [passwordPromptDoc, setPasswordPromptDoc] = useState<DocumentRecord | null>(null);
  const [isPasswordRejected, setIsPasswordRejected] = useState(false);
  const [scannedPdfBannerVisible, setScannedPdfBannerVisible] = useState(false);
  const [versionMismatchBannerVisible, setVersionMismatchBannerVisible] = useState(false);
  const [sessionSynthesisOpen, setSessionSynthesisOpen] = useState(false);
  const [externalLinkUrl, setExternalLinkUrl] = useState<string | null>(null);

  // Task 5.1 (FR-8.8): Intercept all external link clicks and disclose destination before browser handoff
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest('a');
      if (!target) return;

      // Let NoteEditor.handlePreviewClick handle wiki-links
      if (target.closest('a.wiki-link[data-link-id]') || target.classList.contains('wiki-link')) {
        return;
      }

      const href = target.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#')) return;
      if (href.startsWith('mereth://')) {
        e.preventDefault();
        e.stopPropagation();
        const parsed = parseDeepLinkTS(href);
        if (parsed.route) handleLaunchRoutePayload({ deep_link: parsed.route });
        else setOperationError(parsed.error ?? 'Invalid internal link.');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setExternalLinkUrl(href);
    };
    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, []);

  // Task 4.4 (FR-11.1): Prompt Editor Modal for Remember actions
  const [promptEditorModal, setPromptEditorModal] = useState<{
    open: boolean;
    initialPrompt?: Partial<ReviewPromptRecord> | null;
    sourceContext?: {
      title: string;
      quote?: string | null;
      annotationId?: string | null;
      noteId?: string | null;
    };
  }>({ open: false });
  const [rememberedPromptAnnotationIds, setRememberedPromptAnnotationIds] = useState<Set<string>>(new Set());

  const handleRememberAnnotation = (ann: AnnotationRecord) => {
    setPromptEditorModal({
      open: true,
      sourceContext: {
        title: activeDocument?.title || 'Document',
        quote: ann.quote,
        annotationId: ann.id,
      },
    });
  };

  const handlePromptSaved = (prompt: ReviewPromptRecord) => {
    if (prompt.annotation_id) {
      setRememberedPromptAnnotationIds((prev) => {
        const next = new Set(prev);
        next.add(prompt.annotation_id as string);
        return next;
      });
    }
  };

  const handleReturnToLibrary = () => {
    if (activeDocument && annotationsList.length > 0) {
      setSessionSynthesisOpen(true);
    }
    setDestination("library");
  };

  const handleSaveSynthesisNote = async (title: string, bodyMarkdown: string) => {
    if (!activeDocument) return;
    const note = createDefaultNoteRecord({
      note_type: 'scratch',
      title,
      body_markdown: bodyMarkdown,
      document_id: activeDocument.id,
    });
    await createNote(note);
    setNotesList((prev) => [{ id: note.id, title: note.title, type: note.note_type }, ...prev]);
  };

  // Task 3.3 version handling (FR-7.3): real open-time fingerprint state.
  // `versionStatus` is what the open check reported; `versionOffer` carries
  // the previous version id while the re-anchoring offer is pending;
  // `reanchorDecision` records the user's choice; `reanchorSummary` is the
  // result of the re-anchoring pass.
  const [versionStatus, setVersionStatus] = useState<VersionCheckResult["status"] | null>(null);
  const [activeFileHash, setActiveFileHash] = useState<string | null>(null);
  const [versionOffer, setVersionOffer] = useState<{
    documentId: string;
    previousVersionId: string | null;
  } | null>(null);
  const [reanchorDecision, setReanchorDecision] = useState<"reanchor" | "continue" | null>(null);
  const [reanchorSummary, setReanchorSummary] = useState<{
    reanchored: number;
    detached: number;
  } | null>(null);

  // Task 3.4: annotations are real records loaded from SQLite per open
  // document; notes and review prompts arrive with their R3/R4 milestones —
  // nothing is fabricated (U15).
  const [annotationsList, setAnnotationsList] = useState<AnnotationRecord[]>([]);
  // Task 3.5: recoverable trash records (FR-9.8) — loaded alongside the active
  // list so Restore/Purge stay truthful without hiding what is recoverable.
  const [trashedAnnotations, setTrashedAnnotations] = useState<AnnotationRecord[]>([]);
  const [notesList, setNotesList] = useState<Array<{ id: string; title: string; type: string }>>([]);
  const [reviewPromptsList] = useState<Array<{ id: string; prompt: string }>>([]);
  const [activeReviewSessionState, setActiveReviewSessionState] = useState<ReviewSessionState | null>(() => getActiveReviewSession());
  const handleReviewSessionChange = useCallback((s: ReviewSessionState | null) => {
    setActiveReviewSessionState(s);
  }, []);
  // The current version row's id — creation-time checksums bind to it and
  // re-anchoring switches it; null until registration/refresh completes.
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [readerReadyOpen, setReaderReadyOpen] = useState<{ documentId: string; generation: number } | null>(null);
  // Task 3.5: the user's semantic palette (FR-9.3), loaded from settings.
  const [palette, setPalette] = useState<PaletteEntry[]>(DEFAULT_ANNOTATION_PALETTE);
  // In-session undo (FR-9.8): the manager holds the inverse information; the
  // counter drives the UI's can-undo affordance.
  const undoManagerRef = useRef<AnnotationUndoManager | null>(null);
  if (!undoManagerRef.current) undoManagerRef.current = new AnnotationUndoManager();
  const [undoCount, setUndoCount] = useState(0);

  const activeAnnotation = useMemo(
    () => selected ? annotationsList.find((annotation) => annotation.id === selected) ?? null : null,
    [selected, annotationsList],
  );

  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);

  const handleLaunchRoutePayload = (payload: LaunchRoutePayload) => {
    if (!dbReadyRef.current) {
      pendingLaunchRoutesRef.current.push(payload);
      return;
    }
    // Task 2.9 gate mark (dev-only) so boot failures are attributable.
    perfMark(`route.payload:${JSON.stringify(payload).slice(0, 160)}`);
    const docPath = payload.target_document_path ?? payload.targetDocumentPath;
    if (docPath) {
      const existing = documentsRef.current.find((d) => d.filepath === docPath || d.original_filepath === docPath);
      if (existing) {
        openDocument(existing);
      } else {
        void openPdfFromPath(docPath, 'open_in_place', 'explorer');
      }
      return;
    }

    const dl = payload.deep_link ?? payload.deepLink;
    if (dl) {
      const action = resolveDeepLinkUiAction(dl);
      if (action.destination === "reader") {
        setDestination("reader");
        const found = documentsRef.current.find((d) => d.id === action.documentId);
        if (found) {
          openDocument(found);
        }
        if (action.page) {
          setTargetPage(action.page);
        }
        const annotId = action.annotationId;
        if (annotId) {
          setSelected(annotId);
        }
      } else if (action.destination === "notes") {
        setSelectedNoteId(action.noteId ?? null);
        setDestination("knowledge");
      } else if (action.destination === "review") {
        setSelectedReviewPromptId(action.reviewPromptId ?? null);
        setDestination("review");
      }
    }
  };

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedReviewPromptId, setSelectedReviewPromptId] = useState<string | null>(null);

  const handleNavigateToSource = (block: EvidenceBlockRecord) => {
    const doc = documents.find((d) => d.id === block.document_id);
    if (doc) {
      openDocument(doc);
      setTargetPage(Number(block.page_index) + 1);
      if (block.annotation_id) {
        setSelected(block.annotation_id);
      }
      setDestination("reader");
    }
  };

  const handleAddAnnotationToNote = async (annotation: AnnotationRecord) => {
    if (!activeDocument) return;
    setOperationError(null);
    const evidenceBlock = createEvidenceBlockFromAnnotation({
      noteId: '',
      annotation,
      document: activeDocument,
      pageIndex: annotation.page_index,
      pageLabel: annotation.page_label,
      sourceKind: annotation.annotation_type === "area" ? "area_image" : "quote",
      quote: annotation.quote,
      color: annotation.color,
      tags: annotation.tags,
      userComment: annotation.comment,
    });

    try {
      type CaptureToSourceNoteResult = {
        note: NoteRecord;
        evidence_block: EvidenceBlockRecord;
      };
      const result = await invoke<CaptureToSourceNoteResult>('db_capture_annotation_to_source_note', {
        block: evidenceBlock,
      });
      if (result?.note?.id) {
        setSelectedNoteId(result.note.id);
        return;
      }
      throw new Error('Capture returned no source note.');
    } catch (invokeErr) {
      if (isTauri()) {
        console.error("Atomic capture failed; no partial capture was attempted:", invokeErr);
        setOperationError(`Could not capture annotation: ${invokeErr instanceof Error ? invokeErr.message : String(invokeErr)}`);
        return;
      }
      console.warn("Using non-Tauri capture fallback:", invokeErr);
      try {
        const notes = await listNotes({ includeTrash: false });
        let targetNote = notes.find((n) => n.note_type === 'source' && n.document_id === activeDocument.id && n.deleted_at === null);
        if (!targetNote) {
          const newNote = createDefaultNoteRecord({
            note_type: "source",
            title: `${activeDocument.title} — Reading Notes`,
            document_id: activeDocument.id,
            body_markdown: `# ${activeDocument.title}\n\n*By ${activeDocument.author || "Unknown"}*\n\n## Excerpts & Notes\n`,
          });
          targetNote = await createNote(newNote);
        }

        const fallbackBlock: EvidenceBlockRecord = {
          ...evidenceBlock,
          note_id: targetNote.id,
        };

        await addEvidenceBlock(fallbackBlock);
        setSelectedNoteId(targetNote.id);
      } catch (fallbackErr) {
        console.error("Failed to add annotation to note via fallback:", fallbackErr);
        setOperationError(`Could not capture annotation: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
      }
    }
  };

  // Review preferences state (FR-11.10, FR-11.11)
  const [reviewPreferences, setReviewPreferences] = useState<ReviewQueuePreferences>(DEFAULT_REVIEW_QUEUE_PREFERENCES);

  const handleUpdateReviewPreferences = async (preferences: ReviewQueuePreferences) => {
    setReviewPreferences(preferences);
    try {
      await invoke("db_save_settings", {
        key: REVIEW_QUEUE_PREFERENCES_SETTING_KEY,
        value: JSON.stringify(preferences),
      });
    } catch {
      // Dev environment fallback
    }
  };

  // Task 2.7 Appearance & Reading Comfort State
  const [appearance, setAppearance] = useState<AppearancePreferences>(DEFAULT_APPEARANCE_PREFERENCES);

  const handleUpdateAppearance = async <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => {
    setAppearance((prev) => ({ ...prev, [key]: value }));
    const { key: dbKey, value: dbValue } = serializeSettingValue(key, value);
    try {
      await invoke("db_save_settings", { key: dbKey, value: dbValue });
    } catch {
      // Dev environment fallback
    }
  };

  // Sync theme, reduced motion, and text scale to HTML root element
  useEffect(() => {
    if (typeof window === "undefined") return;

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const applyToDom = () => {
      const theme = resolveTheme(appearance.theme, darkQuery.matches);
      document.documentElement.setAttribute("data-theme", theme);

      const isReduced = resolveReducedMotion(appearance.reducedMotion, reducedMotionQuery.matches);
      document.documentElement.setAttribute("data-reduced-motion", isReduced ? "true" : "false");

      const textScale = resolveTextScale(appearance.appTextScale);
      document.documentElement.style.setProperty("--app-text-scale", String(textScale.scaleFactor));
    };

    applyToDom();

    const handleDarkChange = () => {
      if (appearance.theme === "system") applyToDom();
    };

    const handleMotionChange = () => {
      if (appearance.reducedMotion === "system") applyToDom();
    };

    darkQuery.addEventListener("change", handleDarkChange);
    reducedMotionQuery.addEventListener("change", handleMotionChange);

    return () => {
      darkQuery.removeEventListener("change", handleDarkChange);
      reducedMotionQuery.removeEventListener("change", handleMotionChange);
    };
  }, [appearance]);

  // Intercept window close to ensure pending note drafts are flushed durably
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      win
        .onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await flushAllPendingSaves();
            await win.destroy();
          } catch (err) {
            console.error('Failed to flush pending note saves during window close:', err);
          }
        })
        .then((u) => {
          unlisten = u;
        })
        .catch(() => {});
    } catch {
      // Browser preview fallback
    }
    return () => {
      unlisten?.();
    };
  }, []);

  // Deterministic 1024x640 pane collapse order resolution on window resize
  useEffect(() => {
    const handleWindowResize = () => {
      const containerWidth = window.innerWidth;
      const resolved = resolvePaneCollapseOrder({
        containerWidth,
        leftRequested: leftOpen,
        rightRequested: rightOpen,
        minCanvasWidth: DEFAULT_MIN_CANVAS_WIDTH,
      });
      if (resolved.leftPaneOpen !== leftOpen) setLeftOpen(resolved.leftPaneOpen);
      if (resolved.rightPaneOpen !== rightOpen) setRightOpen(resolved.rightPaneOpen);
    };

    handleWindowResize();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [leftOpen, rightOpen]);

  // Initialize DB and load documents, collections, background jobs, settings, and active session
  useEffect(() => {
    async function initDbAndLoadData() {
      try {
        try {
          await invoke("db_init");
          perfMark("boot.db-init:ok");
        } catch (err) {
          perfMark(`boot.db-init:error:${String(err).slice(0, 200)}`);
          throw err;
        }

        try {
          const settingRows = await invoke<Array<{ key: string; value: string }>>("db_get_settings");
          if (settingRows && settingRows.length > 0) {
            const loaded = parseSettingsRows(settingRows);
            setAppearance(loaded);
            // Task 3.5 (FR-9.3): the semantic palette rides the settings
            // table as one JSON value; corrupt values fall back to defaults.
            const paletteRow = settingRows.find((row) => row.key === ANNOTATION_PALETTE_SETTING_KEY);
            if (paletteRow) setPalette(parsePalette(paletteRow.value));
            const reviewPrefRow = settingRows.find((row) => row.key === REVIEW_QUEUE_PREFERENCES_SETTING_KEY);
            if (reviewPrefRow) {
              try {
                const parsed = JSON.parse(reviewPrefRow.value) as Partial<ReviewQueuePreferences>;
                if (parsed && typeof parsed === 'object') {
                  setReviewPreferences((prev) => ({
                    dailyCardLimit: typeof parsed.dailyCardLimit === 'number' ? parsed.dailyCardLimit : prev.dailyCardLimit,
                    dailyTimeLimitMinutes: typeof parsed.dailyTimeLimitMinutes === 'number' ? parsed.dailyTimeLimitMinutes : prev.dailyTimeLimitMinutes,
                    queuePaused: typeof parsed.queuePaused === 'boolean' ? parsed.queuePaused : prev.queuePaused,
                  }));
                }
              } catch {
                // Keep default
              }
            }
          }
        } catch {
          // Fallback if settings table unpopulated
        }

        const [docs, removed] = await Promise.all([
          invoke<DocumentRecord[]>("db_get_documents"),
          invoke<DocumentRecord[]>("db_get_removed_documents"),
        ]);
        // Load the library list only — no document is auto-opened. The app
        // opens to the Library; a document's session is restored by
        // openDocument when the user explicitly opens it.
        if (docs && docs.length > 0) {
          documentsRef.current = docs;
          setDocuments(docs);
        }
        setRemovedDocuments(removed ?? []);

        const cols = await invoke<CollectionItem[]>("db_get_collections");
        if (cols && cols.length > 0) {
          setCollections(cols);
        }

        const dbJobs = await invoke<BackgroundJob[]>("db_get_jobs");
        if (dbJobs && dbJobs.length > 0) {
          for (const job of dbJobs) {
            if (job.status === 'running' || job.status === 'pending') {
              const interruptedJob = {
                ...job,
                status: 'pending' as const,
                error: 'Interrupted by app restart — resumes when document is opened',
              };
              jobQueueManager.loadJob(interruptedJob);
              invoke("db_update_job", {
                id: job.id,
                status: "pending",
                error: "Interrupted by app restart",
              }).catch(() => {});
            } else {
              jobQueueManager.loadJob(job);
            }
          }
          setJobs(jobQueueManager.getJobs());
        }
        dbReadyRef.current = true;
        setDbReady(true);
        const pendingRoutes = pendingLaunchRoutesRef.current.splice(0);
        for (const route of pendingRoutes) handleLaunchRoutePayload(route);
      } catch {
        // Dev preview environment fallback
      }
    }
    initDbAndLoadData();
  }, []);

  // Tauri single-instance launch routing listener and initial launch route check
  // The initial route is consumed exactly once: this effect re-runs whenever
  // `documents` changes (e.g. the import completing), and re-handling the same
  // initial route would re-open the just-opened document, parsing the PDF a
  // second time and losing the first open's reading position.
  const initialRouteConsumedRef = useRef(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setupLaunchListener() {
      try {
        unlisten = await listen<LaunchRoutePayload>("launch-route", (event) => {
          if (event.payload) {
            handleLaunchRoutePayload(event.payload);
          }
        });
        const initialRoute = await invoke<LaunchRoutePayload>("cmd_get_initial_launch_route");
        if (initialRoute && !initialRouteConsumedRef.current) {
          initialRouteConsumedRef.current = true;
          handleLaunchRoutePayload(initialRoute);
        }
      } catch {
        // Dev environment fallback
      }
    }
    setupLaunchListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [documents]);

  // Task 2.9 in-app performance gate: the driver module is code-split and only
  // ever loaded when VITE_PERF_MEASURE=1 (dev-only measurement runs).
  useEffect(() => {
    if (import.meta.env.VITE_PERF_MEASURE === '1') {
      void import('./perf/inAppPerf').then((m) => m.runInAppPerfGate());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReadingOnly(false);
        setPromptEditorModal({ open: false });
        setImportOpen(false);
        setJobDrawerOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void requestOpenPdf();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        closeActiveDocument();
      }
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) setDestination("reader");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!activeDocument) {
      setRememberedPromptAnnotationIds(new Set());
      return;
    }
    const annotationIds = new Set(annotationsList.map((annotation) => annotation.id));
    let cancelled = false;
    void listReviewPrompts().then((prompts) => {
      if (cancelled) return;
      setRememberedPromptAnnotationIds(
        new Set(
          prompts
            .map((prompt) => prompt.annotation_id)
            .filter((annotationId): annotationId is string => Boolean(annotationId && annotationIds.has(annotationId)))
        )
      );
    }).catch(() => {
      if (!cancelled) setRememberedPromptAnnotationIds(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [activeDocument, annotationsList]);

  // Monotonic id for in-flight openDocument calls so a stale async open can
  // detect that a newer one superseded it and bail out before mutating state.
  const openDocumentRequestId = useRef(0);
  // Mirror of the active document for async handlers that need to scope their
  // refreshes (e.g. version registration completing for the open document).
  const activeDocumentRef = useRef<DocumentRecord | null>(null);
  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  async function openDocument(doc: DocumentRecord) {
    // Task 2.9 gate mark (dev-only) so the in-app driver can attribute timing.
    perfMark(`open.document:${doc.id}`);
    // Guard against interleaved opens (rapid library clicks or a launch-route
    // arriving mid-open): only the latest open request is allowed to mutate
    // active-document/session state, so a slower stale read cannot overwrite a
    // newer document's session and the debounced save effect cannot persist one
    // document's page/zoom into another's session row.
    const openRequestId = ++openDocumentRequestId.current;
    setReaderReadyOpen(null);
    // Clear document-scoped state synchronously. No annotation action can see
    // a version or selection inherited from the previous PDF while hydration
    // for this document is in flight.
    setCurrentVersionId(null);
    setAnnotationsList([]);
    setTrashedAnnotations([]);
    setSelected("");
    setVersionOffer(null);
    setVersionStatus(null);
    setActiveFileHash(null);
    setReanchorDecision(null);
    setReanchorSummary(null);
    setOperationError(null);
    // Whether this open switches documents — only then is the previous
    // document's selection cleared (a deep link re-opening the SAME document
    // keeps its annotation selection).
    const switchingDocument = activeDocumentRef.current?.id !== doc.id;

    let fileExists = true;
    try {
      fileExists = await invoke<boolean>("verify_document_file_exists", { documentId: doc.id });
    } catch {
      // Dev preview fallback: check path pattern
      if (doc.filepath.includes("missing")) {
        fileExists = false;
      }
    }

    // A newer openDocument call superseded this one while we were awaiting the
    // file-exists check — abandon without touching any state.
    if (openRequestId !== openDocumentRequestId.current) return;

    const nowIso = new Date().toISOString();
    const updatedDoc: DocumentRecord = { ...doc, is_missing: !fileExists, last_opened_at: nowIso };

    try {
      await invoke("db_update_last_opened", { id: doc.id });
    } catch {
      // Dev fallback
    }

    if (openRequestId !== openDocumentRequestId.current) return;

    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updatedDoc : d)));
    setActiveDocument(updatedDoc);

    // Restore saved reading session from Rust SQLite database (Task 2.6)
    try {
      const rawSession = await invoke<ReadingSessionState | null>("db_get_reading_session", { documentId: doc.id });
      // Stale session read: a newer document is now active — drop this result.
      if (openRequestId !== openDocumentRequestId.current) return;
      if (rawSession) {
        const sanitized = validateAndSanitizeReadingSession(rawSession, DEFAULT_LAYOUT_BOUNDS, doc.page_count);
        setActiveSession(sanitized);
        setLeftOpen(sanitized.left_pane_open);
        setRightOpen(sanitized.right_pane_open);
      } else {
        const defaultS = createDefaultReadingSession(doc.id);
        setActiveSession(defaultS);
        setLeftOpen(defaultS.left_pane_open);
        setRightOpen(defaultS.right_pane_open);
      }
    } catch {
      if (openRequestId !== openDocumentRequestId.current) return;
      const defaultS = createDefaultReadingSession(doc.id);
      setActiveSession(defaultS);
    }

    if (openRequestId !== openDocumentRequestId.current) return;

    if (doc.is_password_protected || doc.filepath.includes("password") || doc.filepath.includes("protected")) {
      setPasswordPromptDoc(updatedDoc);
    } else {
      setPasswordPromptDoc(null);
    }

    if (doc.is_scanned || doc.filepath.includes("scanned")) {
      setScannedPdfBannerVisible(true);
    } else {
      setScannedPdfBannerVisible(false);
    }

    // Task 3.3 (FR-7.3): compare the bytes at the known path against the
    // version row annotations reference. A difference is treated as a new
    // version and OFFERS re-anchoring — the app never reuses old coordinates
    // silently. "Unregistered" (records created before 3.3) get their first
    // version row once the document loads.
    try {
      const check = await invoke<VersionCheckResult>("db_check_document_version_state", {
        documentId: doc.id,
        openGeneration: openRequestId,
      });
      if (openRequestId !== openDocumentRequestId.current) return;
      setVersionStatus(check.status);
      setActiveFileHash(check.file_sha256_hash ?? check.document_sha256_hash);
      if (check.status === "changed") {
        setVersionOffer({ documentId: doc.id, previousVersionId: check.current_version_id ?? null });
        setReanchorDecision(null);
        setVersionMismatchBannerVisible(true);
      } else {
        setVersionOffer(null);
        setVersionMismatchBannerVisible(false);
      }
    } catch {
      // Dev preview without the backend: nothing to report.
      if (openRequestId !== openDocumentRequestId.current) return;
      setVersionStatus(null);
      setActiveFileHash(doc.sha256_hash);
      setVersionOffer(null);
      setVersionMismatchBannerVisible(false);
    }

    // Mounting Reader starts loadPdfDocument immediately. Wait until the
    // version check has populated the Rust single-read cache so that large
    // PDFs cannot race ahead and trigger a second full disk read.
    if (openRequestId !== openDocumentRequestId.current) return;
    setReaderReadyOpen({ documentId: doc.id, generation: openRequestId });
    setDestination("reader");

    // Task 3.4 (FR-9.4): creation-time checksums bind to the current version
    // row, so resolve the latest version and load the document's active
    // annotations before the reader can create any. Both are guarded by the
    // open-request id so a stale open cannot attach another document's
    // version/annotations to the active reader.
    try {
      const versions = await invoke<DocumentVersionRecord[]>("db_get_document_versions", {
        documentId: doc.id,
      });
      if (openRequestId !== openDocumentRequestId.current) return;
      const latest = versions[versions.length - 1] ?? null;
      const latestId = latest?.id ?? null;
      setCurrentVersionId(latestId);
      if (latestId) {
        const sets = await loadAnnotationSets(doc.id);
        if (openRequestId !== openDocumentRequestId.current) return;
        setAnnotationsList(sets.active);
        setTrashedAnnotations(sets.trashed);
      } else {
        setAnnotationsList([]);
        setTrashedAnnotations([]);
      }
    } catch {
      if (openRequestId !== openDocumentRequestId.current) return;
      setCurrentVersionId(null);
      setAnnotationsList([]);
      setTrashedAnnotations([]);
    }

    // A fresh open never shows the previous document's selection.
    if (openRequestId !== openDocumentRequestId.current) return;
    if (switchingDocument) setSelected("");

    // The text-extraction job for the active document is managed by the
    // `activeDocument?.id` effect below, so every open path (library click,
    // launch route, import-complete, deep link) keeps the jobs drawer honest
    // (FR-7.6) without duplicating the queue logic here.
  }

  function closeActiveDocument() {
    openDocumentRequestId.current += 1;
    if (activeDocumentRef.current) evictPdfDocument(activeDocumentRef.current.id);
    setActiveDocument(null);
    setActiveSession(null);
    setCurrentVersionId(null);
    setAnnotationsList([]);
    setTrashedAnnotations([]);
    setSelected("");
    setDestination("library");
  }

  async function openPdfFromPath(path: string, mode: OwnershipMode, source: 'picker' | 'explorer' | 'drop' | 'menu') {
    setOperationError(null);
    try {
      const metadata = await invoke<{ filepath: string; filename: string; sha256_hash: string; file_size_bytes: number; page_count: number; exists: boolean }>(
        'import_compute_file_metadata', { filepath: path }
      );
      if (!metadata.exists) throw new Error(`The PDF no longer exists at ${path}`);
      const existing = documentsRef.current.find((doc) => doc.sha256_hash === metadata.sha256_hash);
      if (existing) { await openDocument(existing); return; }
      let filepath = metadata.filepath;
      let originalFilepath: string | undefined;
      if (mode === 'managed_library') {
        filepath = await invoke<string>('import_copy_to_managed_library', { sourcePath: metadata.filepath });
        originalFilepath = metadata.filepath;
      }
      const record = createDocumentRecord({
        title: metadata.filename.replace(/\.pdf$/i, ''), filepath,
        original_filepath: originalFilepath, sha256_hash: metadata.sha256_hash,
        page_count: Math.max(1, metadata.page_count), ownership_mode: mode,
      });
      await invoke('db_add_document', { doc: record });
      setDocuments((current) => [record, ...current.filter((doc) => doc.id !== record.id)]);
      await openDocument(record);
      perfMark(`open.source:${source}`);
    } catch (error) {
      setOperationError(`Could not open PDF: ${error instanceof Error ? error.message : String(error)}`);
      setDestination('library');
    }
  }

  async function requestOpenPdf() {
    try {
      const selected = await openFileDialog({ multiple: false, directory: false, filters: [{ name: 'PDF Document', extensions: ['pdf'] }] });
      if (typeof selected === 'string') await openPdfFromPath(selected, 'open_in_place', 'picker');
    } catch (error) {
      setOperationError(`The file picker could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<{ command: 'open_pdf' | 'import_pdf_copy' | 'close_document' }>('app-menu-command', ({ payload }) => {
      if (payload.command === 'open_pdf') void requestOpenPdf();
      else if (payload.command === 'import_pdf_copy') { setInitialImportPath(null); setPdfEntryMode('import'); setImportOpen(true); }
      else closeActiveDocument();
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // The listener delegates through refs/state setters and must be registered
    // once. Re-registering on every render can leak asynchronously-created
    // listeners when cleanup wins the race with listen().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real extraction progress reported by the reader's background pass. The
  // manager marks the job completed at 100%; completion is persisted.
  const handleJobProgress = (jobId: string, processedPages: number) => {
    const updated = jobQueueManager.updateProgress(jobId, processedPages);
    setJobs(jobQueueManager.getJobs());
    if (updated && updated.status === 'completed') {
      // invoke() returns a Promise — a sync try/catch can't catch a rejection.
      invoke("db_update_job", { id: jobId, status: "completed", error: null }).catch(() => {
        // Dev environment fallback
      });
    }
  };

  const handlePasswordSubmit = (password: string) => {
    const validation = validatePdfPassword(password);
    if (!validation.isValid || password === "wrong") {
      setIsPasswordRejected(true);
      return;
    }

    setIsPasswordRejected(false);
    if (passwordPromptDoc) {
      const unlockedDoc: DocumentRecord = {
        ...passwordPromptDoc,
        is_password_protected: false,
      };
      setActiveDocument(unlockedDoc);
      setPasswordPromptDoc(null);
    }
  };

  const handlePasswordCancel = () => {
    setPasswordPromptDoc(null);
    setIsPasswordRejected(false);
    setDestination("library");
  };

  const handleToggleFavourite = async (docId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    try {
      await invoke("db_toggle_favourite", { id: docId, isFavourite: newStatus });
    } catch {}

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, is_favourite: newStatus } : d))
    );
  };

  const handleToggleArchive = async (docId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    try {
      await invoke("db_toggle_archive", { id: docId, isArchived: newStatus });
    } catch {}

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, is_archived: newStatus } : d))
    );
  };

  const handleUpdateDocument = (updatedDoc: DocumentRecord) => {
    setDocuments((prev) => prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d)));
    if (activeDocument?.id === updatedDoc.id) {
      setActiveDocument(updatedDoc);
    }
  };

  const handleUpdateCollections = (newCollections: CollectionItem[]) => {
    setCollections(newCollections);
  };

  // Text extraction job management (FR-7.6), keyed off the ACTIVE DOCUMENT so
  // every open path (library click, launch route, import-complete, deep link)
  // reports an honest, cancellable job in the background jobs drawer. Any
  // still-active extraction job for ANOTHER document would sit at 0% forever,
  // so it is superseded here.
  useEffect(() => {
    if (!activeDocument) return;
    const docId = activeDocument.id;
    for (const job of jobQueueManager.getJobs()) {
      if (
        job.document_id !== docId &&
        (job.status === 'running' || job.status === 'pending')
      ) {
        // Stop the actual extraction for the superseded document
        durableIndexer.cancel(job.document_id);
        jobQueueManager.cancelJob(job.id, 'Superseded: another document became active');
      }
    }

    // Reuse a live extraction job for this document when one exists (e.g. a
    // restart from the jobs drawer); otherwise queue a fresh one.
    const existingJob = jobQueueManager
      .getJobs()
      .find(
        (j) =>
          j.document_id === docId &&
          j.job_type === 'text_extraction' &&
          (j.status === 'running' || j.status === 'pending')
      );
    if (existingJob) {
      setActiveExtractionJobId(existingJob.id);
    } else {
      const extractionJob = createBackgroundJob({
        document_id: docId,
        job_type: "text_extraction",
        total_pages: activeDocument.page_count,
        active_page: 1,
      });
      jobQueueManager.enqueueJob(extractionJob);
      setActiveExtractionJobId(extractionJob.id);
    }
    setJobs(jobQueueManager.getJobs());
  }, [activeDocument?.id]);

  const handleCancelJob = (jobId: string) => {
    const job = jobQueueManager.getJob(jobId);
    jobQueueManager.cancelJob(jobId, "Cancelled by user from background jobs drawer");
    setJobs(jobQueueManager.getJobs());
    // Stop the actual extraction worker, not just the job record
    if (job?.document_id) {
      durableIndexer.cancel(job.document_id);
    }
    // invoke() returns a Promise — a sync try/catch can't catch a rejection.
    invoke("db_update_job", { id: jobId, status: "cancelled", error: "Cancelled by user" }).catch(() => {});
  };

  const handleRestartJob = (jobId: string) => {
    const job = jobQueueManager.getJob(jobId);
    jobQueueManager.restartJob(jobId);
    setJobs(jobQueueManager.getJobs());
    // Cancel the current extraction run so the durable indexer startup effect
    // detects idle/cancelled state and re-triggers fresh extraction.
    if (job?.document_id) {
      durableIndexer.cancel(job.document_id);
    }
    // invoke() returns a Promise — a sync try/catch can't catch a rejection.
    invoke("db_update_job", { id: jobId, status: "pending", error: null }).catch(() => {});
  };

  const handleJobFailed = (jobId: string, error: string) => {
    jobQueueManager.failJob(jobId, error);
    setJobs(jobQueueManager.getJobs());
    invoke("db_update_job", { id: jobId, status: "failed", error }).catch(() => {});
  };

  // Task 3.3: the re-anchoring offer actions. "Re-anchor" runs the quote-based
  // re-anchoring pass inside the reader (where the extracted text lives) once
  // the new version is registered; "continue" registers the new version and
  // leaves annotations on the old one — detached by construction, never
  // silently re-anchored.
  const handleReanchorAnnotations = () => {
    setReanchorDecision("reanchor");
    setVersionMismatchBannerVisible(false);
  };

  const handleDismissVersionMismatchBanner = () => {
    setReanchorDecision("continue");
    setVersionMismatchBannerVisible(false);
  };

  const handleVersionRegistered = (documentId: string) => {
    // The document fingerprint changed server-side; refresh the library copy
    // so dedup and displays stay truthful.
    invoke<DocumentRecord[]>("db_get_documents")
      .then((docs) => {
        if (docs && docs.length > 0) setDocuments(docs);
      })
      .catch(() => {});
    setVersionStatus("unchanged");
    setVersionOffer((offer) => (offer?.documentId === documentId ? null : offer));
    setReanchorDecision(null);

    // Task 3.4: the current version id may have just been created (first open
    // of a pre-3.3 record) or moved (re-anchor pass) — refresh it and the
    // annotation rows (re-anchor rewrites their version bindings).
    if (documentId === activeDocumentRef.current?.id) {
      invoke<DocumentVersionRecord[]>("db_get_document_versions", { documentId })
        .then((versions) => {
          const latest = versions[versions.length - 1] ?? null;
          setCurrentVersionId(latest?.id ?? null);
        })
        .catch(() => {});
      loadAnnotationSets(documentId)
        .then((sets) => {
          setAnnotationsList(sets.active);
          setTrashedAnnotations(sets.trashed);
        })
        .catch(() => {});
    }
  };

  // ---- Task 3.5: annotation CRUD through the typed IPC, with in-session
  // undo (FR-9.8). Every mutation refreshes BOTH lists so the annotations
  // pane and the trash section stay truthful. ----

  const refreshAnnotations = useCallback(async (documentId: string) => {
    const sets = await loadAnnotationSets(documentId);
    if (activeDocumentRef.current?.id !== documentId) return; // stale doc closed
    setAnnotationsList(sets.active);
    setTrashedAnnotations(sets.trashed);
  }, []);

  const bumpUndoUI = () => {
    setUndoCount(undoManagerRef.current?.size ?? 0);
  };

  const handleAnnotationCreated = async (record: AnnotationRecord) => {
    await createAnnotation(record);
    await refreshAnnotations(record.document_id);
    undoManagerRef.current?.pushCreate(record.id);
    bumpUndoUI();
  };

  const handleAreaAnnotationCreated = async (
    annotation: AnnotationRecord,
    asset: AnnotationAssetRecord,
    bytes: ArrayBuffer
  ) => {
    // FR-9.7: a single atomic IPC call writes the crop file and inserts both
    // the annotation and asset rows — no half-created captures, no
    // caller-supplied-path cleanup (PRD §15.3).
    await createAreaCapture(annotation, asset, bytes);
    await refreshAnnotations(annotation.document_id);
    undoManagerRef.current?.pushCreate(annotation.id);
    bumpUndoUI();
  };

  const handleAnnotationUpdated = async (id: string, color: string, comment: string, tags: string[]) => {
    const existing = annotationsList.find((a) => a.id === id);
    if (!existing) return;
    const previous = { color: existing.color, comment: existing.comment, tags: existing.tags };
    await updateAnnotationFields(id, color, comment, tags);
    await refreshAnnotations(existing.document_id);
    // FR-9.5: the quote and anchors are untouched by this path by design.
    undoManagerRef.current?.pushEdit(id, previous);
    bumpUndoUI();
  };

  const handleTrashAnnotation = async (id: string) => {
    const existing = annotationsList.find((a) => a.id === id);
    if (!existing) return;
    await trashAnnotation(id);
    await refreshAnnotations(existing.document_id);
    // Undo of trash is restore; setSelected may point at the trashed row.
    undoManagerRef.current?.pushTrash(id);
    bumpUndoUI();
    if (selected === id) setSelected("");
  };

  const handleRestoreAnnotation = async (id: string) => {
    const existing = trashedAnnotations.find((a) => a.id === id);
    if (!existing) return;
    await restoreAnnotation(id);
    await refreshAnnotations(existing.document_id);
  };

  const handlePurgeAnnotation = async (id: string) => {
    const existing = trashedAnnotations.find((a) => a.id === id);
    if (!existing) return;
    await purgeAnnotation(id);
    await refreshAnnotations(existing.document_id);
    if (selected === id) setSelected("");
  };

  const handleUndoAnnotation = async () => {
    const manager = undoManagerRef.current;
    if (!manager || !manager.canUndo) return;
    const action = manager.pop();
    if (!action) return;
    try {
      if (action.kind === "create") {
        await trashAnnotation(action.annotationId);
      } else if (action.kind === "edit") {
        await updateAnnotationFields(
          action.annotationId,
          action.previous.color,
          action.previous.comment,
          action.previous.tags
        );
      } else {
        await restoreAnnotation(action.annotationId);
      }
      if (activeDocumentRef.current) {
        await refreshAnnotations(activeDocumentRef.current.id);
      }
    } catch {
      // Failed inverse: put the action back so the user can retry.
      manager.replay(action);
    }
    bumpUndoUI();
    if (selected !== "" && action.kind === "create") setSelected("");
  };

  const handleSavePalette = (next: PaletteEntry[]) => {
    setPalette(next);
    try {
      const serialized = serializePalette(next);
      invoke("db_save_settings", {
        key: ANNOTATION_PALETTE_SETTING_KEY,
        value: serialized,
      }).catch(() => {
        // Dev preview fallback — palette still applies for the session.
      });
    } catch {
      // Invalid palette was already blocked by the editor; keep defaults.
    }
  };

  const handleReanchorOutcome = (outcome: { reanchored: number; detached: number }) => {
    setReanchorSummary(outcome);
  };

  function handleImportComplete(newDoc: DocumentRecord) {
    // Opening a document already in the Library must not be treated as a new
    // import; it should simply take the reader to that existing record.
    const existingDocument = documents.find((document) => document.id === newDoc.id);
    if (existingDocument) {
      openDocument(existingDocument);
      setImportOpen(false);
      return;
    }

    // Check for duplicate fingerprint before finalizing import (FR-7.7)
    const dupCheck = checkDuplicateFingerprint(newDoc.sha256_hash, newDoc.filepath, documents);
    if (dupCheck.hasDuplicate && dupCheck.existingDocument) {
      setDuplicateConfirmState(dupCheck);
      setImportOpen(false);
      return;
    }

    setDocuments((prev) => {
      const filtered = prev.filter((d) => d.id !== newDoc.id);
      return [newDoc, ...filtered];
    });
    void openDocument(newDoc);
    setImportOpen(false);
  }

  function handleResolveDuplicateAction(action: DuplicateResolutionAction) {
    if (!duplicateConfirmState) return;

    const resultDoc = resolveDuplicateAction({
      action,
      state: duplicateConfirmState,
    });

    if (action === 'open_existing' && resultDoc) {
      openDocument(resultDoc);
    } else if (action === 'import_new' && resultDoc) {
      setDocuments((prev) => [resultDoc, ...prev]);
      openDocument(resultDoc);
    }

    setDuplicateConfirmState(null);
  }

  function handleFileRelocated(updatedDoc: DocumentRecord) {
    setDocuments((prev) => prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d)));
    setActiveDocument(updatedDoc);
  }

  async function handleDeleteRecord(docId: string) {
    try {
      await invoke('db_remove_document', { id: docId });
    } catch (error) {
      setOperationError(`Could not remove this document: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const removed = documentsRef.current.find((doc) => doc.id === docId);
    if (removed) setRemovedDocuments((items) => [{ ...removed, removed_at: new Date().toISOString() }, ...items]);
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (activeDocument?.id === docId) {
      evictPdfDocument(activeDocument.id);
      closeActiveDocument();
    }
  }

  async function handleRestoreDocument(docId: string) {
    setOperationError(null);
    try {
      await invoke('db_restore_document', { id: docId });
      const restored = removedDocuments.find((doc) => doc.id === docId);
      if (restored) setDocuments((items) => [{ ...restored, removed_at: null }, ...items]);
      setRemovedDocuments((items) => items.filter((doc) => doc.id !== docId));
    } catch (error) {
      setOperationError(`Could not restore this document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handlePurgeDocument(doc: DocumentRecord, keepNotes: boolean) {
    setOperationError(null);
    try {
      await invoke('db_purge_document', { id: doc.id, keepNotes });
      setDocuments((items) => items.filter((item) => item.id !== doc.id));
      setRemovedDocuments((items) => items.filter((item) => item.id !== doc.id));
      evictPdfDocument(doc.id);
      if (activeDocument?.id === doc.id) closeActiveDocument();
    } catch (error) {
      setOperationError(`Could not permanently delete this document: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  const activeJobsCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;
  const updates = useUpdateCenter(dbReady);

  useEffect(() => pendingWork.register('background-jobs', async () => {
    const rebuildable = jobs.filter((job) => job.status === 'running' || job.status === 'pending');
    await Promise.all(rebuildable.map((job) => invoke('db_update_job', {
      id: job.id,
      status: 'interrupted',
      error: 'Interrupted for application update; safe to rebuild.',
    })));
  }), [jobs]);

  return (
    <main className={readingOnly ? "app reading-only" : "app"}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="app-mark" aria-hidden="true" />
        <strong>MERETH READER</strong>
        <span className="titlebar-document">
          {destination === "reader" && activeDocument ? `${activeDocument.title}.pdf` : "Local-first PDF reader"}
        </span>
        <span className="offline-status">Local-first · zero telemetry</span>
      </header>

      {!readingOnly && (
        <aside className="rail" aria-label="Primary navigation">
          {nav.map(([id, label, glyph]) => (
            <button
              className={destination === id ? "rail-item active" : "rail-item"}
              key={id}
              onClick={() => setDestination(id)}
              title={label}
              aria-label={label}
              aria-current={destination === id ? "page" : undefined}
            >
              <Glyph name={glyph} />
              <span>{label}</span>
              {id === "review" && reviewPromptsList.length > 0 && <em>{reviewPromptsList.length}</em>}
            </button>
          ))}
          <button
            className={destination === "settings" ? "rail-item active rail-bottom" : "rail-item rail-bottom"}
            onClick={() => setDestination("settings")}
            title="Settings"
            aria-label="Settings"
            aria-current={destination === "settings" ? "page" : undefined}
          >
            <Glyph name="settings" />
            <span>Settings</span>
          </button>
        </aside>
      )}

      <section className="workspace">
        {operationError && <div className="banner warning app-operation-error" role="alert">{operationError}<button className="icon-button" onClick={() => setOperationError(null)} aria-label="Dismiss error"><Icon name="x" /></button></div>}
        {destination !== "review" && activeReviewSessionState && (activeReviewSessionState.step === "prompt" || activeReviewSessionState.step === "revealed") && (
          <div className="banner info active-review-banner" role="status">
            <span>Review session in progress (Card {activeReviewSessionState.currentIndex + 1} of {activeReviewSessionState.queue.length})</span>
            <button className="button micro primary" onClick={() => setDestination("review")}>
              Return to Review
            </button>
          </div>
        )}
        {destination === "reader" && (
          <>
            {!activeDocument ? (
              <EmptyState
                viewType="library"
                customTitle="No document open"
                customDescription="Open a PDF from your library or from disk to start reading. Nothing is bundled or fabricated — your documents are the content."
                onPrimaryAction={() => void requestOpenPdf()}
              />
            ) : activeDocument.is_missing ? (
              <MissingFileBanner
                document={activeDocument}
                onFileRelocated={handleFileRelocated}
                onDeleteRecord={handleDeleteRecord}
              />
            ) : activeDocument.is_malformed ? (
              <MalformedDocumentView
                document={activeDocument}
                onReturnToLibrary={handleReturnToLibrary}
                onDeleteRecord={handleDeleteRecord}
              />
            ) : readerReadyOpen?.documentId === activeDocument.id ? (
              <Reader
                activeAnnotation={activeAnnotation}
                activeDocument={activeDocument}
                activeSession={activeSession}
                appearance={appearance}
                documentName={`${activeDocument.title}.pdf`}
                leftOpen={leftOpen}
                readingOnly={readingOnly}
                rightOpen={rightOpen}
                rightTab={rightTab}
                selected={selected}
                targetPage={targetPage}
                onTargetPageConsumed={() => setTargetPage(undefined)}
                annotationsList={annotationsList}
                currentVersionId={currentVersionId}
                versionHash={activeFileHash}
                openGeneration={readerReadyOpen.generation}
                trashedAnnotations={trashedAnnotations}
                palette={palette}
                onAnnotationCreated={handleAnnotationCreated}
                onAreaAnnotationCreated={handleAreaAnnotationCreated}
                onAnnotationUpdated={handleAnnotationUpdated}
                onTrashAnnotation={handleTrashAnnotation}
                onRestoreAnnotation={handleRestoreAnnotation}
                onPurgeAnnotation={handlePurgeAnnotation}
                onUndoAnnotation={handleUndoAnnotation}
                undoCount={undoCount}
                onJumpToAnnotation={(pageIndex) => setTargetPage(pageIndex + 1)}
                scannedPdfBannerVisible={scannedPdfBannerVisible}
                versionMismatchBannerVisible={versionMismatchBannerVisible}
                versionStatus={versionStatus}
                versionOffer={versionOffer}
                reanchorDecision={reanchorDecision}
                reanchorSummary={reanchorSummary}
                activeDocumentJob={jobs.find((j) => j.id === activeExtractionJobId)}
                onCancelJob={handleCancelJob}
                onJobProgress={handleJobProgress}
                onJobFailed={handleJobFailed}
                onDismissScannedBanner={() => setScannedPdfBannerVisible(false)}
                onDismissVersionMismatchBanner={handleDismissVersionMismatchBanner}
                onReanchorAnnotations={handleReanchorAnnotations}
                onVersionRegistered={handleVersionRegistered}
                onReanchorOutcome={handleReanchorOutcome}
                onDismissReanchorSummary={() => setReanchorSummary(null)}
                onReturnToLibrary={handleReturnToLibrary}
                setImportOpen={() => { setInitialImportPath(null); setPdfEntryMode('open'); setImportOpen(true); }}
                setLeftOpen={setLeftOpen}
                setReadingOnly={setReadingOnly}
                setRightOpen={setRightOpen}
                setRightTab={setRightTab}
                setSelected={setSelected}
                totalPages={activeDocument.page_count}
                rememberedAnnotationIds={rememberedPromptAnnotationIds}
                onAddEvidenceToNote={handleAddAnnotationToNote}
                onRememberAnnotation={handleRememberAnnotation}
                onExternalLink={setExternalLinkUrl}
                onOpenNoteInKnowledge={(noteId) => {
                  setSelectedNoteId(noteId);
                  setDestination("knowledge");
                }}
              />
            ) : null}
          </>
        )}
        {destination === "library" && (
          <LibraryView
            documents={documents}
            removedDocuments={removedDocuments}
            collections={collections}
            activeJobsCount={activeJobsCount}
            onOpenDocument={openDocument}
            onOpenPdf={() => void requestOpenPdf()}
            onOpenImportModal={() => { setInitialImportPath(null); setPdfEntryMode('import'); setImportOpen(true); }}
            onOpenJobQueue={() => setJobDrawerOpen(true)}
            onToggleFavourite={handleToggleFavourite}
            onToggleArchive={handleToggleArchive}
            onUpdateDocument={handleUpdateDocument}
            onUpdateCollections={handleUpdateCollections}
            onRestoreDocument={(id) => void handleRestoreDocument(id)}
            onPurgeDocument={handlePurgeDocument}
          />
        )}
        {destination === "notes" && (
          <NotesWorkspace
            document={activeDocument}
            annotations={annotationsList}
            rememberedAnnotationIds={rememberedPromptAnnotationIds}
            onOpenReader={() => setDestination("reader")}
            onLinkAnnotation={(annotation) => void handleAddAnnotationToNote(annotation)}
            onRememberAnnotation={handleRememberAnnotation}
            onOpenAnnotation={(annotation) => {
              setSelected(annotation.id);
              setTargetPage(annotation.page_index + 1);
              setDestination("reader");
            }}
          />
        )}
        {destination === "knowledge" && (
          <NotesView
            initialSelectedNoteId={selectedNoteId}
            onNavigateToSource={handleNavigateToSource}
            onNavigateToAnnotation={(annotation) => {
              const doc = documents.find((item) => item.id === annotation.document_id);
              if (!doc) return;
              openDocument(doc);
              setSelected(annotation.id);
              setTargetPage(annotation.page_index + 1);
              setDestination("reader");
            }}
          />
        )}
        {destination === "review" && (
          <ReviewView
            initialPromptId={selectedReviewPromptId}
            reviewPreferences={reviewPreferences}
            onOpenSettings={() => setDestination("settings")}
            onNavigateToAnnotation={(annotation) => {
              const doc = documents.find((item) => item.id === annotation.document_id);
              if (!doc) return;
              openDocument(doc);
              setSelected(annotation.id);
              setTargetPage(annotation.page_index + 1);
              setDestination("reader");
            }}
            onNavigateToNote={(noteId) => {
              setSelectedNoteId(noteId);
              setDestination("knowledge");
            }}
            onSessionChange={handleReviewSessionChange}
          />
        )}
        {destination === "settings" && (
          <SettingsView
            appearance={appearance}
            onUpdateAppearance={handleUpdateAppearance}
            palette={palette}
            onSavePalette={handleSavePalette}
            updates={updates}
            reviewPreferences={reviewPreferences}
            onUpdateReviewPreferences={handleUpdateReviewPreferences}
          />
        )}
      </section>

      {!readingOnly && <footer>{annotationsList.length} annotations · {notesList.length} notes <span /> All data stays on this device</footer>}

      <ImportModal
        isOpen={importOpen}
        onClose={() => { setImportOpen(false); setInitialImportPath(null); }}
        onImportComplete={handleImportComplete}
        existingDocuments={documents}
        initialFilePath={initialImportPath}
        mode={pdfEntryMode}
      />

      <JobQueueDrawer
        isOpen={jobDrawerOpen}
        jobs={jobs}
        onClose={() => setJobDrawerOpen(false)}
        onCancelJob={handleCancelJob}
        onRestartJob={handleRestartJob}
      />

      <DuplicateConfirmModal
        isOpen={Boolean(duplicateConfirmState)}
        duplicateState={duplicateConfirmState}
        onResolve={handleResolveDuplicateAction}
      />

      <PasswordDialog
        isOpen={Boolean(passwordPromptDoc)}
        documentTitle={passwordPromptDoc?.title || ''}
        isRejected={isPasswordRejected}
        onPasswordSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />

      {/* Task 4.4 (FR-11.1 - FR-11.5): Prompt Editor Modal for Remember actions */}
      <PromptEditorModal
        isOpen={promptEditorModal.open}
        onClose={() => setPromptEditorModal({ open: false })}
        initialPrompt={promptEditorModal.initialPrompt}
        sourceContext={promptEditorModal.sourceContext}
        onSaved={handlePromptSaved}
      />
      <SessionSynthesisModal
        isOpen={sessionSynthesisOpen}
        annotations={annotationsList}
        onClose={() => setSessionSynthesisOpen(false)}
        onSaveNote={handleSaveSynthesisNote}
      />
      <ExternalLinkModal
        isOpen={Boolean(externalLinkUrl)}
        url={externalLinkUrl}
        onClose={() => setExternalLinkUrl(null)}
      />
      {dbReady && <UpdateConsentDialog model={updates} />}
      <UpdateToast model={updates} />
    </main>
  );
}

export type ReaderProps = {
  activeAnnotation: AnnotationRecord | null;
  activeDocument: DocumentRecord;
  activeSession: ReadingSessionState | null;
  appearance: AppearancePreferences;
  documentName: string;
  leftOpen: boolean;
  readingOnly: boolean;
  rightOpen: boolean;
  rightTab: "annotations" | "note";
  selected: string;
  targetPage?: number;
  onTargetPageConsumed?: () => void;
  totalPages: number;
  rightPaneWidth?: number;
  annotationsList: AnnotationRecord[];
  /** Task 3.4: the version row new annotations bind to (null until registered). */
  currentVersionId: string | null;
  /** Fingerprint of the bytes currently loaded, including changed-in-place files. */
  versionHash: string | null;
  openGeneration: number;
  /** Task 3.5: recoverable trash rows for the open document (FR-9.8). */
  trashedAnnotations: AnnotationRecord[];
  /** Task 3.5: the user's semantic palette (FR-9.3). */
  palette: PaletteEntry[];
  /** Task 3.5 CRUD callbacks — each persists, refreshes, and records undo. */
  onAnnotationCreated: (record: AnnotationRecord) => Promise<void>;
  onAreaAnnotationCreated: (annotation: AnnotationRecord, asset: AnnotationAssetRecord, bytes: ArrayBuffer) => Promise<void>;
  onAnnotationUpdated: (id: string, color: string, comment: string, tags: string[]) => Promise<void>;
  onTrashAnnotation: (id: string) => Promise<void>;
  onRestoreAnnotation: (id: string) => Promise<void>;
  onPurgeAnnotation: (id: string) => Promise<void>;
  onUndoAnnotation: () => Promise<void>;
  undoCount: number;
  onJumpToAnnotation?: (pageIndex: number) => void;
  scannedPdfBannerVisible?: boolean;
  versionMismatchBannerVisible?: boolean;
  versionStatus?: VersionCheckResult["status"] | null;
  versionOffer?: { documentId: string; previousVersionId: string | null } | null;
  reanchorDecision?: "reanchor" | "continue" | null;
  reanchorSummary?: { reanchored: number; detached: number } | null;
  activeDocumentJob?: BackgroundJob;
  onCancelJob?: (jobId: string) => void;
  onJobProgress?: (jobId: string, processedPages: number) => void;
  onJobFailed?: (jobId: string, error: string) => void;
  onDismissScannedBanner?: () => void;
  onDismissVersionMismatchBanner?: () => void;
  onReanchorAnnotations?: () => void;
  onVersionRegistered?: (documentId: string) => void;
  onReanchorOutcome?: (outcome: { reanchored: number; detached: number }) => void;
  onDismissReanchorSummary?: () => void;
  onReturnToLibrary?: () => void;
  setImportOpen: (value: boolean) => void;
  setLeftOpen: (value: boolean) => void;
  setReadingOnly: (value: boolean) => void;
  setRightOpen: (value: boolean) => void;
  setRightTab: (value: "annotations" | "note") => void;
  setSelected: (value: string) => void;
  /** Task 3.6 (FR-9.9): embedded PDF annotations present for the open doc. */
  embeddedImportCounts?: { newCount: number; duplicateCount: number; unsupportedCount: number } | null;
  embeddedImportDisabled?: boolean;
  onOpenEmbeddedImport?: () => void;
  /** Task 3.7 (FR-9.6): annotation linkage sets (populated by R3/R4 linking). */
  linkedAnnotationIds?: ReadonlySet<string>;
  rememberedAnnotationIds?: ReadonlySet<string>;
  /** Task 4.2 (FR-10.1): Add active annotation as evidence block to note */
  onAddEvidenceToNote?: (annotation: AnnotationRecord) => void;
  /** Task 4.4 (FR-11.1): Open review prompt editor for annotation */
  onRememberAnnotation?: (annotation: AnnotationRecord) => void;
  onExternalLink?: (url: string) => void;
  onOpenNoteInKnowledge?: (noteId: string) => void;
};

function Reader(props: ReaderProps) {
  useEffect(() => {
    const clearDetailOnCanvasClick = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.reader-canvas') && !target.closest('.annotation-overlay, .pdf-link-hit, button, input, textarea, select')) {
        props.setSelected('');
      }
    };
    window.addEventListener('pointerdown', clearDetailOnCanvasClick);
    return () => window.removeEventListener('pointerdown', clearDetailOnCanvasClick);
  }, [props.setSelected]);
  // View Modes & Navigation State initialized from activeSession or sensible defaults
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    props.activeSession?.view_mode || 'continuous'
  );
  const [zoomScale, setZoomScale] = useState<number>(
    props.activeSession ? zoomPercentageToScale(props.activeSession.zoom_scale) : 1.0
  );
  const [zoomMode, setZoomMode] = useState<'fit-width' | 'fit-page' | 'custom'>(
    props.activeSession?.zoom_mode || 'fit-width'
  );
  const [rotation, setRotation] = useState<RotationAngle>(
    props.activeSession?.rotation || 0
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [currentPage, setCurrentPage] = useState<number>(
    props.activeSession?.current_page || 1
  );
  const [quickNoteSource, setQuickNoteSource] = useState<QuickNoteSourceSnapshot | null>(null);
  const [quickNoteSaved, setQuickNoteSaved] = useState<{ pageLabel: string } | null>(null);
  const quickNoteToastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (quickNoteToastTimeoutRef.current !== null) {
        window.clearTimeout(quickNoteToastTimeoutRef.current);
      }
    };
  }, []);

  const openQuickNote = useCallback(() => {
    if (!props.currentVersionId) return;
    const liveSelection = window.getSelection();
    const selectedText = liveSelection?.toString().trim() || null;
    const range = selectedText && liveSelection?.rangeCount ? liveSelection.getRangeAt(0) : null;
    const startContainer = range?.startContainer;
    const endContainer = range?.endContainer;
    const startElement = startContainer instanceof Element ? startContainer : startContainer?.parentElement;
    const endElement = endContainer instanceof Element ? endContainer : endContainer?.parentElement;
    const selectedPageElement = startElement?.closest<HTMLElement>('.pdf-page') ?? null;
    const selectionIsOnOnePdfPage = Boolean(
      selectedPageElement
      && endElement?.closest('.pdf-page') === selectedPageElement
      && selectedPageElement.closest('.reader-canvas-container')
    );
    const selectedPageNumber = selectionIsOnOnePdfPage
      ? Number(selectedPageElement?.dataset.pageNumber)
      : NaN;
    const sourcePage = Number.isInteger(selectedPageNumber) && selectedPageNumber > 0
      ? selectedPageNumber
      : currentPage;
    const selection = selectionIsOnOnePdfPage ? selectedText : null;
    const pageElement = selectionIsOnOnePdfPage ? selectedPageElement : null;
    let rectsJson: string | null = null;
    if (selection && range && pageElement) {
      const pageRect = pageElement.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).map((rect) => {
        const left = Math.max(rect.left, pageRect.left);
        const top = Math.max(rect.top, pageRect.top);
        const right = Math.min(rect.right, pageRect.right);
        const bottom = Math.min(rect.bottom, pageRect.bottom);
        return {
          x: (left - pageRect.left) / pageRect.width,
          y: (top - pageRect.top) / pageRect.height,
          width: (right - left) / pageRect.width,
          height: (bottom - top) / pageRect.height,
        };
      }).filter((rect) => rect.width > 0 && rect.height > 0);
      if (rects.length) rectsJson = JSON.stringify(rects);
    }
    setQuickNoteSource({
      documentId: props.activeDocument.id,
      documentVersionId: props.currentVersionId,
      pageIndex: sourcePage - 1,
      pageLabel: formatExtendedPageLabel(sourcePage, props.totalPages).displayLabel,
      selectedQuote: selection,
      rectsJson,
    });
  }, [props.activeDocument.id, props.currentVersionId, props.totalPages, currentPage]);

  const saveQuickNote = useCallback(async (body: string, source: QuickNoteSourceSnapshot) => {
    const note = createDefaultNoteRecord({ note_type: 'scratch', title: quickNoteTitle(body), body_markdown: body, document_id: source.documentId });
    const now = note.created_at;
    await createQuickNote(note, {
      id: crypto.randomUUID(), note_id: note.id, document_id: source.documentId,
      document_version_id: source.documentVersionId, page_index: source.pageIndex,
      page_label: source.pageLabel, selected_quote: source.selectedQuote,
      rects_json: source.rectsJson, created_at: now, provenance: 'user_authored',
    });
    window.dispatchEvent(new CustomEvent('mereth:quick-note-created', { detail: { documentId: source.documentId } }));

    if (quickNoteToastTimeoutRef.current !== null) {
      window.clearTimeout(quickNoteToastTimeoutRef.current);
    }
    setQuickNoteSaved({ pageLabel: source.pageLabel });
    quickNoteToastTimeoutRef.current = window.setTimeout(() => {
      setQuickNoteSaved(null);
      quickNoteToastTimeoutRef.current = null;
    }, 2200);
  }, []);
  const [scrollTopPx, setScrollTopPx] = useState<number>(
    props.activeSession?.scroll_top_px || 0.0
  );
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(
    props.activeSession?.left_pane_width_px || 230
  );
  const [rightPaneWidth, setRightPaneWidth] = useState<number>(
    props.activeSession?.right_pane_width_px || 284
  );

  const flushReadingSession = useCallback(async () => {
    const session = validateAndSanitizeReadingSession({
      document_id: props.activeDocument.id,
      current_page: currentPage,
      zoom_mode: zoomMode,
      zoom_scale: zoomScaleToPercentage(zoomScale),
      scroll_top_px: scrollTopPx,
      left_pane_open: props.leftOpen,
      left_pane_width_px: leftPaneWidth,
      right_pane_open: props.rightOpen,
      right_pane_width_px: rightPaneWidth,
      view_mode: layoutMode,
      rotation,
      updated_at: new Date().toISOString(),
    }, DEFAULT_LAYOUT_BOUNDS, props.totalPages);
    await invoke('db_save_reading_session', { session });
  }, [props.activeDocument.id, props.leftOpen, props.rightOpen, props.totalPages, currentPage, zoomMode, zoomScale, scrollTopPx, leftPaneWidth, rightPaneWidth, layoutMode, rotation]);

  useEffect(() => pendingWork.register(`reading-session:${props.activeDocument.id}`, flushReadingSession), [props.activeDocument.id, flushReadingSession]);

  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const [historyState, setHistoryState] = useState(() => createNavigationHistory(currentPage));
  const [copyWarning, setCopyWarning] = useState<string | null>(null);

  // Search state — empty on open. Nothing searches or jumps pages until the
  // user types a query and traverses matches explicitly.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Document runtime: render-first load, then cancellable background text
  // extraction feeding search (FR-7.6).
  const [loadedPdf, setLoadedPdf] = useState<LoadedPdfInfo | null>(null);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);
  const [pageTexts, setPageTexts] = useState<PageTextContent[]>([]);
  const [indexedPageCount, setIndexedPageCount] = useState(0);
  const [durableBatchVersion, setDurableBatchVersion] = useState(0);
  const [extractionStatus, setExtractionStatus] = useState<IndexingStatus>('idle');
  const [pageCacheHydrated, setPageCacheHydrated] = useState(false);
  const [pageCacheWriteFailed, setPageCacheWriteFailed] = useState(false);
  const [cacheRebuildInFlight, setCacheRebuildInFlight] = useState(false);
  const [cacheRebuildGeneration, setCacheRebuildGeneration] = useState(0);
  const [textExtractionFailures, setTextExtractionFailures] = useState<number[]>([]);
  // U20: corrupt-cache recovery — drop cached rows for this version and let
  // the normal background-extraction effect repopulate them from scratch.
  const rebuildPageCache = async () => {
    if (!props.versionHash || cacheRebuildInFlight) return;
    setCacheRebuildInFlight(true);
    try {
      await invoke('db_clear_page_cache', { documentId: props.activeDocument.id, versionHash: props.versionHash });
      cachedPageNumbersRef.current = new Set();
      durableIndexer.reset(props.activeDocument.id);
      setPageTexts([]);
      // The cache was just cleared successfully, so an empty hydrated set is
      // authoritative. Trigger the indexing effect directly rather than wait
      // for the document/hash hydration effect, whose dependencies did not
      // change during an in-place rebuild.
      setPageCacheHydrated(true);
      setPageCacheWriteFailed(false);
      setTextExtractionFailures([]);
      setExtractionStatus('idle');
      setIndexedPageCount(0);
      setCacheRebuildGeneration((generation) => generation + 1);
    } catch {
      // Keep the banner visible; the user can retry.
    } finally {
      setCacheRebuildInFlight(false);
    }
  };

  const cachedPageNumbersRef = useRef<Set<number>>(new Set());
  const [firstPagePainted, setFirstPagePainted] = useState(false);
  const extractionAbortRef = useRef<AbortController | null>(null);

  // Viewport size + the measured natural size of the current page drive
  // fit-width / fit-page. Until the first measurement arrives, a Letter
  // estimate keeps the math stable.
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [currentPageSize, setCurrentPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const currentPageRef = useRef(currentPage);
  const [scrollToPageRequest, setScrollToPageRequest] = useState<{ page: number; nonce: number } | null>(null);
  const scrollSaveTimeoutRef = useRef<number>(0);
  // Monotonic counter for scrollToPageRequest nonces — Date.now() can repeat
  // within the same millisecond for back-to-back navigations, which would
  // silently drop the second one (ReaderCanvas's scroll effect keys off nonce).
  const navNonceRef = useRef(0);

  // ---- Task 3.4: annotation creation state (FR-9.1/FR-9.2/FR-9.4) ----
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  type CapturedSelection = SelectionPopupAnchor & {
    pageBox: PageBox;
    viewportRects: ViewportRect[];
    quote: string;
  };
  const [selectionPopup, setSelectionPopup] = useState<CapturedSelection | null>(null);
  const [popupColor, setPopupColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [popupComment, setPopupComment] = useState("");
  const [popupLocked, setPopupLocked] = useState(false);
  const [lockedAnnotationType, setLockedAnnotationType] = useState<"highlight" | "underline" | null>(null);
  const [popupBusy, setPopupBusy] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);
  const selectionActionRef = useRef<((type: "highlight" | "underline" | "comment", colorOverride?: string) => Promise<void>) | null>(null);
  const [captureActive, setCaptureActive] = useState(false);
  const [areaPending, setAreaPending] = useState<AreaCaptureResult | null>(null);
  const [areaCaption, setAreaCaption] = useState("");
  const [areaSaving, setAreaSaving] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);
  // Object URLs for area-capture crops, keyed by annotation id. Cleaned up on
  // unmount so long reading sessions do not leak blob URLs.
  const [annotationAssets, setAnnotationAssets] = useState<Record<string, AnnotationAssetVisual>>({});
  const objectUrlsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );
  // ---- Task 3.6: embedded (PDF-born) annotations (FR-9.9) ----
  // The background scan fills one page at a time; overlays and the import
  // preview read from this map, so a 400-page document never blocks reading.
  const [embeddedByPage, setEmbeddedByPage] = useState<Map<number, ParsedEmbeddedAnnotation[]>>(new Map());
  const embeddedScanRef = useRef<{ documentId: string; cancelled: boolean } | null>(null);
  /** sourceIds already imported this session — hidden from overlays/preview. */
  const [embeddedImported, setEmbeddedImported] = useState<Set<string>>(new Set());
  const [embeddedImportOpen, setEmbeddedImportOpen] = useState(false);
  const [embeddedImportBusy, setEmbeddedImportBusy] = useState(false);
  // Mirrors so document-level listeners never capture stale state.
  const captureActiveRef = useRef(captureActive);
  useEffect(() => {
    captureActiveRef.current = captureActive;
  }, [captureActive]);

  const totalPages = loadedPdf?.numPages || props.totalPages || 1;

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Sync state when active document or session changes
  useEffect(() => {
    if (props.activeSession) {
      setCurrentPage(props.activeSession.current_page);
      setLayoutMode(props.activeSession.view_mode);
      setZoomMode(props.activeSession.zoom_mode);
      setZoomScale(zoomPercentageToScale(props.activeSession.zoom_scale));
      setRotation(props.activeSession.rotation);
      setScrollTopPx(props.activeSession.scroll_top_px);
      setLeftPaneWidth(props.activeSession.left_pane_width_px);
      setRightPaneWidth(props.activeSession.right_pane_width_px);
    }
  }, [props.activeDocument.id, props.activeSession]);

  // Drag resizer mouse move handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.max(160, Math.min(450, e.clientX - 66)); // 66px rail width
        setLeftPaneWidth(newWidth);
      } else if (isResizingRight) {
        const newWidth = Math.max(160, Math.min(450, window.innerWidth - e.clientX));
        setRightPaneWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };
    if (isResizingLeft || isResizingRight) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight]);

  // Render-first document load: resolves as soon as the first page can be
  // painted. Text extraction is a separate background pass below.
  useEffect(() => {
    let isMounted = true;
    setLoadedPdf(null);
    setPdfLoadFailed(false);
    setPageTexts([]);
    cachedPageNumbersRef.current = new Set();
    setPageCacheHydrated(false);
    setPageCacheWriteFailed(false);
    setTextExtractionFailures([]);
    setExtractionStatus('idle');
    setFirstPagePainted(false);
    setCurrentPageSize(DEFAULT_PAGE_SIZE);
    extractionAbortRef.current?.abort();

    // Task 2.9 in-app gate mark: dev-only no-op unless VITE_PERF_MEASURE=1.
    perfMark(`load.start:${props.activeDocument.filepath.split("/").pop() ?? "unknown"}`);
    loadPdfDocument(props.activeDocument.id, props.openGeneration).then((info) => {
      if (!isMounted) return;
      if (info) {
        setLoadedPdf(info);
        perfMark("load.end");
      } else {
        setPdfLoadFailed(true);
      }
    });

    return () => {
      isMounted = false;
      extractionAbortRef.current?.abort();
    };
  }, [props.activeDocument.id, props.activeDocument.filepath, props.openGeneration]);

  // Hydrate cached page numbers without copying 1,000+ page text strings into React state.
  useEffect(() => {
    if (!loadedPdf || !props.versionHash) return;
    const versionHash = props.versionHash;
    let cancelled = false;
    invoke<number[]>("db_get_cached_page_numbers_for_version", {
      documentId: props.activeDocument.id,
      versionHash,
    })
      .then((cachedNums) => {
        if (cancelled) return;
        const cachedSet = new Set(cachedNums);
        cachedPageNumbersRef.current = cachedSet;
        setIndexedPageCount(cachedNums.length);
        setPageCacheHydrated(true);
        if (cachedNums.length >= loadedPdf.numPages && loadedPdf.numPages > 0) {
          setExtractionStatus("done");
          if (props.activeDocumentJob?.id) {
            props.onJobProgress?.(props.activeDocumentJob.id, loadedPdf.numPages);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPageCacheHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedPdf, props.activeDocument.id, props.versionHash]);

  // Durable application-level background text extraction (FR-7.6)
  useEffect(() => {
    if (!loadedPdf || !props.versionHash || !firstPagePainted || !pageCacheHydrated) return;
    const docId = props.activeDocument.id;
    const versionHash = props.versionHash;
    const jobId = props.activeDocumentJob?.id ?? `indexing-${docId}`;

    const unsubscribe = durableIndexer.subscribe(docId, (state) => {
      setExtractionStatus(state.status);
      setIndexedPageCount(state.processedPages);
      setDurableBatchVersion(state.batchVersion);
      if (props.onJobProgress) {
        props.onJobProgress(jobId, state.processedPages);
      }
      if (state.status === "failed") {
        props.onJobFailed?.(jobId, state.error ?? "Text indexing failed");
      }
    });

    const currentState = durableIndexer.getState(docId);
    const versionStale = durableIndexer.isStaleVersion(docId, versionHash);
    const retryRequested = props.activeDocumentJob?.status === "pending" && currentState?.status === "failed";
    if (versionStale || !currentState || currentState.status === "idle" || currentState.status === "cancelled" || retryRequested) {
      void durableIndexer.startIndexing({
        doc: loadedPdf.doc,
        documentId: docId,
        versionHash,
        jobId,
        totalPages: loadedPdf.numPages,
        activePage: currentPageRef.current,
        cachedPageNumbers: cachedPageNumbersRef.current,
        batchSize: 16,
        onJobProgress: props.onJobProgress,
      });
    }

    return () => {
      unsubscribe();
    };
  }, [loadedPdf, firstPagePainted, pageCacheHydrated, props.activeDocument.id, props.versionHash, props.activeDocumentJob?.status, cacheRebuildGeneration]);

  // Task 3.6 (FR-9.9): cooperative background scan for embedded (PDF-born) annotations.
  // Active reading window is scanned first; non-visible pages yield cooperatively.
  useEffect(() => {
    if (!loadedPdf || !firstPagePainted || !props.activeDocument) return;
    if (embeddedScanRef.current) embeddedScanRef.current.cancelled = true;
    setEmbeddedByPage(new Map());
    setEmbeddedImported(new Set());
    const doc = loadedPdf.doc;
    if (!doc || loadedPdf.numPages === 0) return;
    const scan = { documentId: props.activeDocument.id, cancelled: false };
    embeddedScanRef.current = scan;
    const total = loadedPdf.numPages;
    const order = prioritizePageWindow(total, currentPageRef.current, 3);
    const initialCount = Math.min(order.length, 8);
    const BATCH = 4;

    void (async () => {
      // 1. High-priority active reading window
      for (let i = 0; i < initialCount; i += BATCH) {
        if (scan.cancelled) return;
        const batch = order.slice(i, Math.min(i + BATCH, initialCount));
        const results = await Promise.all(
          batch.map(async (pageNumber): Promise<[number, ParsedEmbeddedAnnotation[]] | null> => {
            if (scan.cancelled) return null;
            return [pageNumber, await getPdfPageEmbeddedAnnotations(doc, pageNumber)];
          })
        );
        if (scan.cancelled) return;
        setEmbeddedByPage((prev) => {
          const next = new Map(prev);
          for (const entry of results) {
            if (entry) next.set(entry[0], entry[1]);
          }
          return next;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // 2. Remaining pages scanned with cooperative idle delay.
      // Yield to active text extraction to avoid competing for the pdf.js worker.
      for (let i = initialCount; i < order.length; i += BATCH) {
        if (scan.cancelled) return;
        // Cooperatively wait while text extraction is actively running
        while (durableIndexer.getState(scan.documentId)?.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (scan.cancelled) return;
        }
        const batch = order.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (pageNumber): Promise<[number, ParsedEmbeddedAnnotation[]] | null> => {
            if (scan.cancelled) return null;
            return [pageNumber, await getPdfPageEmbeddedAnnotations(doc, pageNumber)];
          })
        );
        if (scan.cancelled) return;
        setEmbeddedByPage((prev) => {
          const next = new Map(prev);
          for (const entry of results) {
            if (entry) next.set(entry[0], entry[1]);
          }
          return next;
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    })();

    return () => {
      scan.cancelled = true;
    };
  }, [loadedPdf?.doc, loadedPdf?.numPages, firstPagePainted, props.activeDocument?.id, embeddedImportOpen]);

  // Job drawer cancel/restart drives the durable indexer singleton.
  const activeJobStatus = props.activeDocumentJob?.status;
  useEffect(() => {
    if (activeJobStatus === 'cancelled' || activeJobStatus === 'failed') {
      durableIndexer.cancel(props.activeDocument.id);
    } else if (activeJobStatus === 'pending') {
      setExtractionStatus((s) => (s === 'cancelled' || s === 'done' ? 'idle' : s));
    }
  }, [activeJobStatus, props.activeDocument.id]);

  // Task 3.3 (FR-7.3): version registration follow-through, run once per open.
  // - "unregistered" documents (records created before 3.3, or first import
  //   before version rows existed) register v1 with measured geometry.
  // - a "changed" document whose user chose to re-anchor waits for text
  //   extraction (done or cancelled) so the quote match runs against the
  //   fullest available text, then registers v2, moves quote-matched
  //   annotations to it with recomputed checksums, and reports the outcome;
  //   unmatched annotations stay on the old version — detached, never
  //   silently reused.
  // - "continue without re-anchoring" registers v2 and leaves every
  //   annotation on the old version.
  const versionRegistrationInFlightRef = useRef<string | null>(null);
  useEffect(() => {
    const docId = props.activeDocument.id;
    const registrationKey = `${docId}:${props.openGeneration}`;
    if (!loadedPdf || !firstPagePainted || !pageCacheHydrated) return;
    if (versionRegistrationInFlightRef.current === registrationKey) return;

    const status = props.versionStatus;
    if (status === "missing") return;

    const offerForThisDoc =
      props.versionOffer !== null &&
      props.versionOffer !== undefined &&
      props.versionOffer.documentId === docId;
    const decision = props.reanchorDecision;

    const durableStatus = durableIndexer.getState(docId)?.status;
    const extractionSettled =
      extractionStatus !== "running" &&
      extractionStatus !== "paused" &&
      durableStatus !== "running" &&
      durableStatus !== "paused";
    const shouldRegister = extractionSettled && (
      status === "unregistered" ||
      (offerForThisDoc && status === "changed" && decision === "continue") ||
      (offerForThisDoc && status === "changed" && decision === "reanchor")
    );
    if (!shouldRegister) return;

    let cancelled = false;
    versionRegistrationInFlightRef.current = registrationKey;
    (async () => {
      try {
        const version = await invoke<DocumentVersionRecord>("db_register_document_version", {
          documentId: docId,
          openGeneration: props.openGeneration,
        });
        if (cancelled || versionRegistrationInFlightRef.current !== registrationKey) return;

        if (decision === "reanchor") {
          const annotations = await invoke<StoredAnnotation[]>(
            "db_get_annotations_for_document",
            { documentId: docId, includeTrashed: false }
          );
          if (cancelled) return;
          const versionTexts = await loadVersionedPageTexts(docId, version.sha256_hash);
          const pageTextByNumber = new Map(versionTexts.map((p) => [p.pageNumber, p.text]));
          const plan = selectReanchorActions({
            annotations,
            newVersionId: version.id,
            pageTextByNumber,
          });
          for (const action of plan.reanchor) {
            await invoke("db_reanchor_annotation_to_version", {
              annotationId: action.annotationId,
              newVersionId: action.newVersionId,
              newChecksum: action.newChecksum,
            });
          }
          if (plan.reanchor.length + plan.detached.length > 0) {
            props.onReanchorOutcome?.({
              reanchored: plan.reanchor.length,
              detached: plan.detached.length,
            });
          }
        }

        const geometry = await measurePdfPageGeometry(
          loadedPdf.doc.numPages,
          (page) => getPdfPageBaseSize(loadedPdf.doc, page)
        );
        if (cancelled || versionRegistrationInFlightRef.current !== registrationKey) return;
        await invoke("db_update_version_geometry", { versionId: version.id, geometry });
        if (cancelled) return;
        props.onVersionRegistered?.(docId);
      } catch (err) {
        console.error("Failed to register document version:", err);
        if (versionRegistrationInFlightRef.current === registrationKey) {
          versionRegistrationInFlightRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadedPdf,
    firstPagePainted,
    pageCacheHydrated,
    props.activeDocument.id,
    props.openGeneration,
    props.versionStatus,
    props.versionOffer,
    props.reanchorDecision,
    extractionStatus,
    pageTexts,
  ]);

  // Fit-width / fit-page resolve from the measured viewport and the current
  // page's natural size. Custom zoom is the only stateful scale; fit modes
  // recompute automatically on resize, rotation, and layout changes.
  const fitScale =
    zoomMode === 'custom'
      ? null
      : calculateFitScale({
          containerWidth: viewportSize.width,
          containerHeight: viewportSize.height,
          pageSize: currentPageSize,
          mode: zoomMode,
          layoutMode,
          rotation,
        });
  const effectiveScale = zoomMode === 'custom' ? zoomScale : fitScale ?? zoomScale;

  // Auto-persist reading session state to Rust SQLite backend (debounced)
  useEffect(() => {
    if (!props.activeDocument || !props.activeDocument.id) return;

    const sessionToSave: ReadingSessionState = {
      document_id: props.activeDocument.id,
      current_page: currentPage,
      zoom_mode: zoomMode,
      zoom_scale: zoomScaleToPercentage(effectiveScale),
      scroll_top_px: scrollTopPx,
      left_pane_open: props.leftOpen,
      left_pane_width_px: leftPaneWidth,
      right_pane_open: props.rightOpen,
      right_pane_width_px: rightPaneWidth,
      view_mode: layoutMode,
      rotation: rotation,
      updated_at: new Date().toISOString(),
    };

    const timer = setTimeout(() => {
      const sanitized = validateAndSanitizeReadingSession(sessionToSave, DEFAULT_LAYOUT_BOUNDS, totalPages);
      invoke("db_save_reading_session", { session: sanitized }).catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [
    currentPage,
    layoutMode,
    effectiveScale,
    zoomMode,
    rotation,
    scrollTopPx,
    props.leftOpen,
    leftPaneWidth,
    props.rightOpen,
    rightPaneWidth,
    props.activeDocument.id,
    totalPages,
  ]);

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [ftsSearchMatches, setFtsSearchMatches] = useState<DetailedSearchMatch[] | null>(null);

  useEffect(() => {
    // Clear stale results immediately so previous matches don't show during debounce
    setFtsSearchMatches(null);
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const query = debouncedSearchQuery.trim();
    if (!query) {
      setFtsSearchMatches(null);
      return;
    }
    let cancelled = false;
    perfMark("search.start");
    searchDocumentTextFts(props.activeDocument.id, props.versionHash ?? "", query, searchOptions)
      .then((matches) => {
        if (cancelled) return;
        perfMark("search.end");
        setFtsSearchMatches(matches);
      })
      .catch(() => {
        if (!cancelled) setFtsSearchMatches(null);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery, searchOptions, props.activeDocument.id, props.versionHash, durableBatchVersion]);

  const searchMatches = useMemo(() => {
    if (ftsSearchMatches !== null) return ftsSearchMatches;
    if (!searchQuery.trim()) return [];
    perfMark("search.start");
    const matches = performAdvancedSearch(pageTexts, searchQuery, searchOptions);
    perfMark("search.end");
    return matches;
  }, [ftsSearchMatches, searchQuery, searchOptions, pageTexts]);

  // A new query starts match traversal over, but never jumps the page on its
  // own — page movement happens only on explicit next/previous.
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, searchOptions]);

  const [outlineNodes, setOutlineNodes] = useState<ParsedOutlineNode[]>([]);
  useEffect(() => {
    let live = true;
    setOutlineNodes([]);
    if (!loadedPdf?.outline?.length) return;
    void resolveOutlineTree(loadedPdf.doc, loadedPdf.outline)
      .then((nodes) => { if (live) setOutlineNodes(nodes); })
      .catch(() => { if (live) setOutlineNodes([]); });
    return () => { live = false; };
  }, [loadedPdf]);

  useEffect(() => {
    if (props.targetPage && props.targetPage > 0) {
      handlePageChange(props.targetPage);
      // Clear the deep-link page target after consuming it so it does not bleed
      // into the next document opened from the library, and so a subsequent
      // deep link to the same page re-fires the effect instead of being a
      // no-op (state unchanged → effect skipped).
      props.onTargetPageConsumed?.();
    }
  }, [props.targetPage]);

  const handlePageChange = (newPage: number, recordHistory = true) => {
    const validPage = Math.max(1, Math.min(newPage, totalPages));
    setCurrentPage(validPage);
    durableIndexer.reprioritize(props.activeDocument.id, validPage);
    if (recordHistory) {
      setHistoryState((prev) => pushNavigationHistory(prev, validPage));
    }
    setScrollToPageRequest({ page: validPage, nonce: ++navNonceRef.current });
  };

  // Scroll-driven page sync from the canvas: no history, no scroll command.
  const handlePageVisible = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleBack = () => {
    const result = navigateHistoryBack(historyState);
    if (result.page !== null) {
      setHistoryState(result.state);
      handlePageChange(result.page, false);
    }
  };

  const handleForward = () => {
    const result = navigateHistoryForward(historyState);
    if (result.page !== null) {
      setHistoryState(result.state);
      handlePageChange(result.page, false);
    }
  };

  const handleZoomChange = (
    action: 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page' | 'set',
    value?: number
  ) => {
    // Fit modes are resolved continuously from the measured viewport and page
    // size; selecting one is a mode change, not a scale guess.
    if (action === 'fit-width' || action === 'fit-page') {
      setZoomMode(action);
      return;
    }
    const result = calculateZoom(effectiveScale, action, value);
    setZoomScale(result.scale);
    setZoomMode('custom');
  };

  const handleRotateChange = (direction: 'cw' | 'ccw') => {
    setRotation((prev) => rotateView(prev, direction));
  };

  // Match traversal is the only search-driven page movement.
  const jumpToMatch = (index: number) => {
    const match = searchMatches[index];
    if (!match) return;
    setCurrentMatchIndex(index);
    handlePageChange(match.pageNumber);
  };

  const handleNextMatch = () => {
    if (searchMatches.length > 0) {
      jumpToMatch(getNextMatchIndex(currentMatchIndex, searchMatches.length, 'next'));
    }
  };

  const handlePrevMatch = () => {
    if (searchMatches.length > 0) {
      jumpToMatch(getNextMatchIndex(currentMatchIndex, searchMatches.length, 'prev'));
    }
  };

  const handleViewportChange = useCallback((size: { width: number; height: number }) => {
    setViewportSize(size);
  }, []);

  const handlePageSizeMeasured = useCallback((page: number, base: PageSize) => {
    if (page === currentPageRef.current) {
      setCurrentPageSize((prev) =>
        Math.abs(prev.width - base.width) > 0.5 || Math.abs(prev.height - base.height) > 0.5
          ? base
          : prev
      );
    }
  }, []);

  const handleFirstPagePaint = useCallback(() => setFirstPagePainted(true), []);
  const handleOpenEmbeddedImport = useCallback(() => setEmbeddedImportOpen(true), []);

  // Scroll position persists via a trailing-edge timeout, so scrolling never
  // re-renders the reader per frame and the session write happens once.
  const handleScrollPositionChange = useCallback((top: number) => {
    durableIndexer.notifyScrollActive();
    if (scrollSaveTimeoutRef.current) {
      window.clearTimeout(scrollSaveTimeoutRef.current);
    }
    scrollSaveTimeoutRef.current = window.setTimeout(() => setScrollTopPx(top), 200);
  }, []);

  // Keyboard shortcut listener for Reader canvas actions (FR-8.7)
  useEffect(() => {
    const handleShortcutKeyDown = (e: KeyboardEvent) => {
      // Escape always dismisses the compact annotation surfaces (FR-9.2).
      if (e.key === "Escape") {
        setSelectionPopup(null);
        setAreaPending(null);
        setAreaError(null);
        setAreaCaption("");
        setCaptureActive(false);
      }
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const actionId = resolveShortcutAction(e);
      if (!actionId) return;

      e.preventDefault();
      switch (actionId) {
        case 'view.single':
          setLayoutMode('single');
          break;
        case 'view.continuous':
          setLayoutMode('continuous');
          break;
        case 'view.facing':
          if (totalPages >= 2) setLayoutMode('facing');
          break;
        case 'view.rotate.cw':
          handleRotateChange('cw');
          break;
        case 'view.zoom.in':
          handleZoomChange('in');
          break;
        case 'view.zoom.out':
          handleZoomChange('out');
          break;
        case 'view.zoom.reset':
          handleZoomChange('reset');
          break;
        case 'view.zoom.fitWidth':
          handleZoomChange('fit-width');
          break;
        case 'view.zoom.fitPage':
          handleZoomChange('fit-page');
          break;
        case 'nav.history.back':
          handleBack();
          break;
        case 'nav.history.forward':
          handleForward();
          break;
        case 'nav.page.prev':
          handlePageChange(currentPage - 1);
          break;
        case 'nav.page.next':
          handlePageChange(currentPage + 1);
          break;
        case 'nav.page.first':
          handlePageChange(1);
          break;
        case 'nav.page.last':
          handlePageChange(totalPages);
          break;
        case 'search.next':
          handleNextMatch();
          break;
        case 'search.prev':
          handlePrevMatch();
          break;
        case 'mode.readingOnly':
          props.setReadingOnly(!props.readingOnly);
          break;
        case 'pane.left.toggle':
          props.setLeftOpen(!props.leftOpen);
          break;
        case 'pane.right.toggle':
          props.setRightOpen(!props.rightOpen);
          break;
        case 'note.quick':
          openQuickNote();
          break;
        case 'annot.highlight.yellow':
          void selectionActionRef.current?.('highlight', 'claim');
          break;
        case 'annot.highlight.green':
          void selectionActionRef.current?.('highlight', 'evidence');
          break;
        case 'annot.areaCapture':
          setCaptureActive((prev) => !prev);
          break;
        case 'annot.bookmark':
          void handleToggleBookmark();
          break;
        case 'annot.undo':
          void props.onUndoAnnotation();
          break;
        case 'annot.remember':
          if (props.activeAnnotation) props.onRememberAnnotation?.(props.activeAnnotation);
          break;
      }
    };

    window.addEventListener('keydown', handleShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown);
  }, [currentPage, totalPages, historyState, searchMatches, props, openQuickNote]);

  // FR-8.4 copy-confidence check against the real text layer of the page the
  // user is copying from — never placeholder data.
  const handleCopySelection = useCallback(() => {
    if (!loadedPdf) return;
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) return;
    const page = currentPageRef.current;
    getPdfPageTextItems(loadedPdf.doc, page).then((items) => {
      if (items.length === 0) return;
      const extraction = extractOrderedText(items);
      setCopyWarning(extraction.isLowConfidence && extraction.warning ? extraction.warning : null);
    });
  }, [loadedPdf]);

  // ---- Task 3.4: selection popover (FR-9.2) ----
  // Capture an immutable snapshot only when selection interaction completes.
  // Popup, context-menu, and keyboard actions all consume this snapshot; none
  // re-read the live DOM Selection after a control can collapse it.
  const captureSelectionSnapshot = useCallback((): CapturedSelection | null => {
    const container = canvasContainerRef.current;
    if (!container || !props.currentVersionId || captureActiveRef.current) return null;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const anchorNode = sel.anchorNode;
    const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    const pageEl = anchorEl?.closest(".pdf-page") as HTMLElement | null;
    if (!pageEl || !pageEl.closest(".reader-canvas-container")) return null;
    const focusNode = sel.focusNode;
    const focusEl = focusNode instanceof Element ? focusNode : focusNode?.parentElement;
    if (focusEl?.closest(".pdf-page") !== pageEl) {
      setPopupError("Create one annotation per page; this selection crosses a page boundary.");
      return null;
    }
    const pageNumber = Number(pageEl.dataset.pageNumber ?? 0);
    if (!pageNumber) return null;
    const pageRect = pageEl.getBoundingClientRect();
    const pageBox: PageBox = {
      left: pageRect.left,
      top: pageRect.top,
      right: pageRect.right,
      bottom: pageRect.bottom,
      width: pageRect.width,
      height: pageRect.height,
    };
    const viewportRects: ViewportRect[] = [];
    let maxR = Number.NEGATIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const cr of sel.getRangeAt(i).getClientRects()) {
        if (cr.bottom <= pageBox.top || cr.top >= pageBox.bottom || cr.right <= pageBox.left || cr.left >= pageBox.right) continue;
        const clipped = {
          left: Math.max(cr.left, pageBox.left),
          top: Math.max(cr.top, pageBox.top),
          right: Math.min(cr.right, pageBox.right),
          bottom: Math.min(cr.bottom, pageBox.bottom),
        };
        viewportRects.push(clipped);
        maxR = Math.max(maxR, clipped.right);
        maxB = Math.max(maxB, clipped.bottom);
      }
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (viewportRects.length === 0 || !quote) return null;
    return {
      left: maxR + 10,
      top: maxB + 8,
      pageNumber,
      pageBox,
      viewportRects,
      quote,
    };
  }, [props.currentVersionId]);

  useEffect(() => {
    const capture = () => {
      const snapshot = captureSelectionSnapshot();
      if (snapshot) setSelectionPopup(snapshot);
    };
    const handleContextMenu = (event: MouseEvent) => {
      const snapshot = captureSelectionSnapshot();
      if (!snapshot) return;
      event.preventDefault();
      setSelectionPopup({ ...snapshot, left: event.clientX, top: event.clientY });
    };
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.selection-popup')) return;
      setSelectionPopup(null);
      setPopupError(null);
    };
    const dismissOnScroll = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.selection-popup')) return;
      setSelectionPopup(null);
    };
    document.addEventListener("pointerup", capture);
    document.addEventListener("keyup", capture);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissOnScroll);
    canvasContainerRef.current?.addEventListener("contextmenu", handleContextMenu);
    const container = canvasContainerRef.current;
    return () => {
      document.removeEventListener("pointerup", capture);
      document.removeEventListener("keyup", capture);
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnScroll);
      container?.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [captureSelectionSnapshot]);

  // Task 3.4: create from the immutable snapshot captured on release.
  const handleCreateFromSelection = async (type: "highlight" | "underline" | "comment", colorOverride?: string) => {
    const popup = selectionPopup;
    if (!popup || !loadedPdf || !props.currentVersionId) {
      setSelectionPopup(null);
      return;
    }
    setPopupBusy(true);
    setPopupError(null);
    try {
      const normalized = mergeSelectionRects(popup.viewportRects, popup.pageBox, rotation);
      if (normalized.length === 0) {
        throw new Error("The selection is empty on this page.");
      }
      const quote = popup.quote;
      const annotationColor = colorOverride ?? popupColor;

      // FR-9.4 anchor fields from the real text layer: prefix/suffix context
      // and the text-layer checksum (same ordered text re-anchoring matches).
      const items = await getPdfPageTextItems(loadedPdf.doc, popup.pageNumber);
      const ordered = extractOrderedText(items);
      const { prefix, suffix } = buildQuoteContext(ordered.text, quote);
      const textLayerChecksum = await computeTextLayerChecksum(ordered.text);
      const pageLabel = formatExtendedPageLabel(popup.pageNumber, totalPages).displayLabel;
      const docId = props.activeDocument.id;

      if (type === "comment") {
        if (!popupComment.trim()) {
          throw new Error("Write the comment text first.");
        }
        const record = buildCommentAnnotation({
          documentId: docId,
          documentVersionId: props.currentVersionId,
          pageIndex: popup.pageNumber - 1,
          pageLabel,
          rects: normalized,
          comment: popupComment.trim(),
          color: annotationColor,
        });
        await props.onAnnotationCreated(record);
      } else {
        const record = buildTextAnnotation({
          documentId: docId,
          documentVersionId: props.currentVersionId,
          pageIndex: popup.pageNumber - 1,
          pageLabel,
          type,
          rects: normalized,
          quote,
          prefix,
          suffix,
          textLayerChecksum,
          color: annotationColor,
          comment: popupComment.trim(),
        });
        await props.onAnnotationCreated(record);
      }

      if (popupLocked) {
        // FR-9.2 locked mode: keep the chosen tool settings armed, but discard
        // the consumed snapshot so it cannot be applied twice accidentally.
        setPopupComment("");
        if (type === "highlight" || type === "underline") setLockedAnnotationType(type);
      }
      // The browser's blue live-selection paint sits above annotation
      // overlays. Clear it only after the durable write succeeds so the
      // semantic highlight colour is visible immediately; on failure the
      // selection remains available for a safe retry.
      window.getSelection()?.removeAllRanges();
      setSelectionPopup(null);
    } catch (err) {
      setPopupError(err instanceof Error ? err.message : String(err));
    } finally {
      setPopupBusy(false);
    }
  };
  selectionActionRef.current = handleCreateFromSelection;
  useEffect(() => {
    if (selectionPopup && popupLocked && lockedAnnotationType && !popupBusy) {
      void selectionActionRef.current?.(lockedAnnotationType);
    }
  }, [selectionPopup, popupLocked, lockedAnnotationType, popupBusy]);

  // Task 3.4: resolve area-crop assets into object URLs for the overlay.
  useEffect(() => {
    const areaAnnotations = props.annotationsList.filter((a) => a.annotation_type === "area");
    const missing = areaAnnotations.filter((a) => !annotationAssets[a.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, AnnotationAssetVisual> = {};
      for (const annotation of missing) {
        if (cancelled) break;
        try {
          const assets = await loadAnnotationAssets(annotation.id);
          const first = assets[0];
          if (!first) continue;
          const blob = await readAnnotationAssetBlob(first.id);
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          next[annotation.id] = { url, caption: first.caption };
        } catch {
          // Asset unavailable (e.g. file removed on disk) — the overlay shows
          // its loading placeholder honestly instead of a broken image.
        }
      }
      if (!cancelled) setAnnotationAssets((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotationsList]);

  // Task 3.4: one-drag area capture completion → caption prompt → crop save
  // (FR-9.2/9.7). The crop is drawn from the rendered page bitmap (rotation
  // included), capped at 1280 px, written atomically by Rust, then the
  // annotation and asset rows are inserted — a failed insert removes the file
  // so no orphaned bitmap ever lingers.
  const handleAreaCaptureComplete = (result: AreaCaptureResult) => {
    setAreaPending(result);
    setAreaCaption("");
    setAreaError(null);
  };

  const handleAreaCaptureCancel = () => {
    setCaptureActive(false);
    setAreaPending(null);
    setAreaError(null);
    setAreaCaption("");
  };

  const handleSaveAreaCapture = async () => {
    const pending = areaPending;
    if (!pending || !loadedPdf || !props.currentVersionId) return;
    setAreaSaving(true);
    setAreaError(null);
    const assetId = crypto.randomUUID();
    const relativePath = `annotations/${assetId}.png`;
    try {
      const pageEl = canvasContainerRef.current?.querySelector(
        `.pdf-page[data-page-number="${pending.pageNumber}"]`
      ) as HTMLElement | null;
      const canvas = pageEl?.querySelector("canvas") as HTMLCanvasElement | null;
      if (!pageEl || !canvas) {
        throw new Error("The page is no longer visible — scroll back and try again.");
      }
      const box = pending.box;
      const ratioX = canvas.width / pending.pageBox.width;
      const ratioY = canvas.height / pending.pageBox.height;
      const srcX = Math.max(0, (box.left - pending.pageBox.left) * ratioX);
      const srcY = Math.max(0, (box.top - pending.pageBox.top) * ratioY);
      const srcW = Math.min(canvas.width - srcX, Math.max(0, (box.right - box.left) * ratioX));
      const srcH = Math.min(canvas.height - srcY, Math.max(0, (box.bottom - box.top) * ratioY));
      if (srcW < 2 || srcH < 2) {
        throw new Error("The capture area is too small.");
      }
      const maxSide = 1280;
      const shrink = Math.min(1, maxSide / Math.max(srcW, srcH));
      const outW = Math.max(1, Math.round(srcW * shrink));
      const outH = Math.max(1, Math.round(srcH * shrink));
      const off = document.createElement("canvas");
      off.width = outW;
      off.height = outH;
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable.");
      ctx.clearRect(0, 0, outW, outH);
      ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The capture could not be encoded.");
      const bytes = await blob.arrayBuffer();

      const docId = props.activeDocument.id;
      const annotation = buildAreaAnnotation({
        documentId: docId,
        documentVersionId: props.currentVersionId,
        pageIndex: pending.pageNumber - 1,
        pageLabel: formatExtendedPageLabel(pending.pageNumber, totalPages).displayLabel,
        rect: dragBoxToNormalized(box, pending.pageBox, rotation),
        caption: areaCaption.trim(),
        color: popupColor,
      });
      const asset = buildAreaAssetRecord({
        id: assetId,
        annotationId: annotation.id,
        documentId: docId,
        relativePath,
        widthPx: outW,
        heightPx: outH,
        caption: areaCaption.trim(),
      });
      // FR-9.7: a single atomic IPC call writes the file and inserts both rows
      // — no half-created captures, no caller-supplied-path cleanup.
      await props.onAreaAnnotationCreated(annotation, asset, bytes);

      setAreaPending(null);
      setCaptureActive(false);
      setAreaCaption("");
    } catch (err) {
      setAreaError(err instanceof Error ? err.message : String(err));
    } finally {
      setAreaSaving(false);
    }
  };

  // Task 3.4: bookmark creation for the current page (FR-9.1). Bookmark
  // removal is a trash operation and lands with the task 3.5 trash UI.
  const currentPageBookmarked = useMemo(
    () =>
      props.annotationsList.some(
        (a) => a.annotation_type === "bookmark" && a.page_index === currentPage - 1
      ),
    [props.annotationsList, currentPage]
  );

  // Overlay lookup: active annotations grouped by 1-based renderer page.
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, AnnotationRecord[]>();
    for (const annotation of props.annotationsList) {
      const page = annotation.page_index + 1;
      const list = map.get(page) ?? [];
      list.push(annotation);
      map.set(page, list);
    }
    return map;
  }, [props.annotationsList]);

  // Task 3.6 (FR-9.9): embedded overlays show only supported subtypes that
  // have not been imported this session; the import preview lists every item
  // (imported ones flagged) sorted by page for a stable dialog.
  const embeddedOverlayByPage = useMemo(() => {
    const map = new Map<number, ParsedEmbeddedAnnotation[]>();
    for (const [page, list] of embeddedByPage) {
      const visible = list.filter(
        (item) => mappedAnnotationTypeForSubtype(item.subtype) !== null && !embeddedImported.has(item.sourceId)
      );
      if (visible.length > 0) map.set(page, visible);
    }
    return map;
  }, [embeddedByPage, embeddedImported]);

  const embeddedPreviews = useMemo(() => {
    const items: ParsedEmbeddedAnnotation[] = [];
    embeddedByPage.forEach((list) => items.push(...list));
    items.sort((a, b) => a.pageIndex - b.pageIndex || a.subtype.localeCompare(b.subtype));
    return classifyEmbeddedAnnotations(items, props.annotationsList);
  }, [embeddedByPage, props.annotationsList]);

  const embeddedCounts = useMemo(() => countImportPreviews(embeddedPreviews), [embeddedPreviews]);

  /** Explicit FR-9.9 import: persist each confirmed record (undoable) and
   * mark its sourceId imported so overlays/preview stop offering it. */
  const handleEmbeddedImport = async (previews: EmbeddedImportPreview[]) => {
    if (!props.currentVersionId || !props.activeDocument) return;
    setEmbeddedImportBusy(true);
    try {
      const picked = previews.filter((p) => p.mappedType !== null);
      for (const preview of picked) {
        const record = buildEmbeddedImportRecord({
          documentId: props.activeDocument.id,
          documentVersionId: props.currentVersionId,
          pageLabel: formatExtendedPageLabel(preview.item.pageIndex + 1, totalPages).displayLabel,
          preview,
          palette: props.palette,
        });
        await props.onAnnotationCreated(record); // persists, refreshes, records undo
      }
      if (picked.length > 0) {
        setEmbeddedImported((prev) => {
          const next = new Set(prev);
          for (const preview of picked) next.add(preview.item.sourceId);
          return next;
        });
        setEmbeddedImportOpen(false);
      }
    } catch {
      // Persist errors surface through the annotation list not changing;
      // the dialog stays open so the user can retry.
    } finally {
      setEmbeddedImportBusy(false);
    }
  };

  const handleToggleBookmark = useCallback(async () => {
    if (!loadedPdf || !props.currentVersionId) return;
    if (
      props.annotationsList.some(
        (a) => a.annotation_type === "bookmark" && a.page_index === currentPage - 1
      )
    ) {
      return;
    }
    try {
      const record = buildBookmarkAnnotation({
        documentId: props.activeDocument.id,
        documentVersionId: props.currentVersionId,
        pageIndex: currentPage - 1,
        pageLabel: formatExtendedPageLabel(currentPage, totalPages).displayLabel,
      });
      await props.onAnnotationCreated(record);
    } catch {
      // Creation errors surface through the list not changing; retry is safe.
    }
  }, [currentPage, loadedPdf, props.activeDocument.id, props.annotationsList, props.currentVersionId, props.onAnnotationCreated, totalPages]);

  return (
    <>
      {!props.readingOnly && (
        <ReaderToolbar
          currentPage={currentPage}
          totalPages={totalPages}
          historyState={historyState}
          onPageChange={handlePageChange}
          onHistoryBack={handleBack}
          onHistoryForward={handleForward}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          zoomScale={effectiveScale}
          zoomMode={zoomMode}
          onZoomChange={handleZoomChange}
          rotation={rotation}
          onRotateChange={handleRotateChange}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchOptions={searchOptions}
          onSearchOptionsChange={setSearchOptions}
          searchMatches={searchMatches}
          indexedPages={indexedPageCount}
          extractionStatus={extractionStatus}
          currentMatchIndex={currentMatchIndex}
          onNextMatch={handleNextMatch}
          onPrevMatch={handlePrevMatch}
          leftOpen={props.leftOpen}
          onToggleLeftOpen={() => props.setLeftOpen(!props.leftOpen)}
          rightOpen={props.rightOpen}
          onToggleRightOpen={() => props.setRightOpen(!props.rightOpen)}
          readingOnly={props.readingOnly}
          onToggleReadingOnly={() => props.setReadingOnly(!props.readingOnly)}
          onOpenPdf={() => props.setImportOpen(true)}
          areaCaptureActive={captureActive}
          onToggleAreaCapture={() => setCaptureActive((prev) => !prev)}
          currentPageBookmarked={currentPageBookmarked}
          onToggleBookmark={() => void handleToggleBookmark()}
        />
      )}

      <div className="reader-layout">
        {props.leftOpen && !props.readingOnly && (
          <>
            <LeftSidebar
              outlineNodes={outlineNodes}
              totalPages={totalPages}
              currentPage={currentPage}
              onSelectPage={handlePageChange}
              width={leftPaneWidth}
            />
            <div
              className={`pane-resizer left-resizer ${isResizingLeft ? 'dragging' : ''}`}
              onMouseDown={() => setIsResizingLeft(true)}
              title="Drag to resize outline sidebar"
            />
          </>
        )}

        <div className="reader-canvas-container" ref={canvasContainerRef}>
          {props.appearance.pageDimming !== "0%" && (
            <div
              className="page-dimming-overlay"
              style={getPageDimmingStyle(props.appearance.pageDimming)}
              aria-hidden="true"
            />
          )}

          {props.activeDocumentJob && indexedPageCount < totalPages && (props.activeDocumentJob.status === 'running' || props.activeDocumentJob.status === 'pending') && (
            <div
              className="indexing-progress-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 14px',
                background: '#eef5fc',
                borderLeft: '4px solid #ec3013',
                fontSize: '11.5px',
                color: '#201e1d',
              }}
            >
              <div>
                <Icon name="settings" size={12} /> <strong>Indexing text:</strong> {props.activeDocumentJob.processed_pages} / {props.activeDocumentJob.total_pages} pages ({props.activeDocumentJob.progress_percent}%) · Document reading and navigation remain fully usable in parallel.
              </div>
              {props.onCancelJob && (
                <button
                  className="button danger micro"
                  onClick={() => props.onCancelJob!(props.activeDocumentJob!.id)}
                >
                  Cancel Indexing
                </button>
              )}
            </div>
          )}
          {pageCacheWriteFailed && (
            <div className="indexing-progress-banner" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>Search is available for this session, but some indexed pages could not be cached for reopen. Indexing will retry next time.</span>
              <button
                className="button micro"
                disabled={cacheRebuildInFlight}
                onClick={() => void rebuildPageCache()}
              >
                {cacheRebuildInFlight ? 'Rebuilding…' : 'Rebuild index'}
              </button>
            </div>
          )}
          {textExtractionFailures.length > 0 && extractionStatus === 'done' && (
            <div className="indexing-progress-banner" role="status">
              Indexing finished, but text could not be extracted from {textExtractionFailures.length} page{textExtractionFailures.length === 1 ? '' : 's'}. Those pages remain viewable.
            </div>
          )}

          {props.scannedPdfBannerVisible && (
            <ScannedPdfBanner
              onDismiss={() => props.onDismissScannedBanner?.()}
              onActivateAreaCapture={() => setCaptureActive(true)}
            />
          )}

          {props.versionMismatchBannerVisible && (
            <VersionMismatchBanner
              onReanchor={() => props.onReanchorAnnotations?.()}
              onDismiss={() => props.onDismissVersionMismatchBanner?.()}
            />
          )}

          {props.reanchorSummary && (
            <div className="reanchor-summary-banner" role="status">
              <span>
                {props.reanchorSummary.reanchored > 0
                  ? `Re-anchored ${props.reanchorSummary.reanchored} annotation${props.reanchorSummary.reanchored === 1 ? "" : "s"} to the new version; `
                  : ""}
                {props.reanchorSummary.detached > 0
                  ? `${props.reanchorSummary.detached} stayed on the old version (quote no longer matched).`
                  : "All matched annotations are on the current version."}
              </span>
              <button onClick={() => props.onDismissReanchorSummary?.()}>Dismiss</button>
            </div>
          )}

          {props.readingOnly && (
            <button className="reading-indicator" onClick={() => props.setReadingOnly(false)}>
              PAGE {currentPage} · READING ONLY · PRESS ESC
            </button>
          )}

          {copyWarning && (
            <div className="copy-warning-banner" role="status">
              ⚠️ {copyWarning}
            </div>
          )}
          {quickNoteSaved && <div className="quick-note-toast" role="status">Quick note saved · p. {quickNoteSaved.pageLabel}</div>}

          <RendererErrorBoundary onReturnToLibrary={props.onReturnToLibrary}>
            {pdfLoadFailed ? (
              <div className="pdf-load-failure" role="alert">
                <h2>This PDF could not be opened</h2>
                <p>
                  The file may be malformed, encrypted, or no longer readable at its saved
                  path. Your library record is unchanged.
                </p>
                <button className="wide-action" onClick={props.onReturnToLibrary}>
                  Return to Library
                </button>
              </div>
            ) : !loadedPdf ? (
              <div className="pdf-loading" role="status">
                <p>Opening {props.activeDocument.title}…</p>
              </div>
            ) : (
              <ReaderCanvas
                key={props.activeDocument.id}
                doc={loadedPdf.doc}
                totalPages={totalPages}
                layoutMode={layoutMode}
                scale={effectiveScale}
                rotation={rotation}
                currentPage={currentPage}
                initialScrollTop={props.activeSession?.scroll_top_px || 0}
                scrollToPageRequest={scrollToPageRequest}
                onPageVisible={handlePageVisible}
                onViewportChange={handleViewportChange}
                onPageSizeMeasured={handlePageSizeMeasured}
                onScrollPositionChange={handleScrollPositionChange}
                onFirstPagePaint={handleFirstPagePaint}
                onCopySelection={handleCopySelection}
                annotationsByPage={annotationsByPage}
                annotationAssets={annotationAssets}
                selectedAnnotationId={props.selected}
                palette={props.palette}
                onSelectAnnotation={(id) => {
                  props.setSelected(id);
                  props.setRightTab('annotations');
                  props.setRightOpen(true);
                }}
                embeddedByPage={embeddedOverlayByPage}
                onOpenEmbeddedImport={handleOpenEmbeddedImport}
                onNavigateLink={handlePageChange}
                onExternalLink={props.onExternalLink}
              />
            )}
          </RendererErrorBoundary>

          {/* Task 3.4: compact selection popover (FR-9.2) */}
          {selectionPopup && !captureActive && (
            <SelectionPopup
              anchor={selectionPopup}
              palette={props.palette}
              color={popupColor}
              onColorChange={setPopupColor}
              comment={popupComment}
              onCommentChange={setPopupComment}
              locked={popupLocked}
              onToggleLocked={() => setPopupLocked((prev) => {
                if (prev) setLockedAnnotationType(null);
                return !prev;
              })}
              busy={popupBusy}
              error={popupError}
              onCreate={(type) => void handleCreateFromSelection(type)}
              onClose={() => {
                setSelectionPopup(null);
                setPopupError(null);
              }}
            />
          )}
          {quickNoteSource && (
            <QuickNoteComposer source={quickNoteSource} onSave={saveQuickNote} onDismiss={() => setQuickNoteSource(null)} />
          )}

          {/* Task 3.4: one-drag area capture (FR-9.2) */}
          {captureActive && !areaPending && (
            <AreaCaptureLayer
              onComplete={handleAreaCaptureComplete}
              onCancel={() => setCaptureActive(false)}
            />
          )}

          {/* Task 3.4: area capture caption prompt (FR-9.2/9.7) */}
          {areaPending && !areaSaving && (
            <div className="area-caption-popover" role="dialog" aria-label="Save area capture">
              <span className="eyebrow">Area capture · p. {areaPending.pageNumber}</span>
              <label className="popup-field">
                <span>Optional caption</span>
                <textarea
                  value={areaCaption}
                  onChange={(e) => setAreaCaption(e.target.value)}
                  placeholder="e.g. Figure 3 — the retention curve"
                  aria-label="Area capture caption"
                  autoFocus
                />
              </label>
              {areaError && <p className="popup-error" role="alert">{areaError}</p>}
              <div className="popup-actions">
                <button className="button compact" onClick={() => setAreaPending(null)}>
                  Discard
                </button>
                <button className="button compact primary" onClick={() => void handleSaveAreaCapture()}>
                  Save capture
                </button>
              </div>
            </div>
          )}
        </div>

        {props.rightOpen && !props.readingOnly && (
          <>
            <div
              className={`pane-resizer right-resizer ${isResizingRight ? 'dragging' : ''}`}
              onMouseDown={() => setIsResizingRight(true)}
              title="Drag to resize annotations pane"
            />
            <RightPane
              {...props}
              rightPaneWidth={rightPaneWidth}
              embeddedImportCounts={embeddedCounts}
              embeddedImportDisabled={!props.currentVersionId}
              onOpenEmbeddedImport={() => setEmbeddedImportOpen(true)}
            />
          </>
        )}
      </div>

      {/* Task 3.6 (FR-9.9): explicit embedded-annotation import preview */}
      {embeddedImportOpen && (
        <EmbeddedImportModal
          previews={embeddedPreviews}
          importedSourceIds={embeddedImported}
          pageLabelFor={(pageIndex) => formatExtendedPageLabel(pageIndex + 1, totalPages).displayLabel}
          colorKeyFor={(preview) => matchPaletteKeyForRgb(preview.item.colorRgb, props.palette)}
          busy={embeddedImportBusy}
          onCancel={() => setEmbeddedImportOpen(false)}
          onImport={(previews) => void handleEmbeddedImport(previews)}
        />
      )}
    </>
  );
}

export function RightPane(props: ReaderProps) {
  const tabs: Array<[typeof props.rightTab, string]> = [["annotations", "Annotations"], ["note", "Note"]];
  const list = props.annotationsList || [];
  const [documentNotes, setDocumentNotes] = useState<NoteRecord[]>([]);
  const [noteAnchors, setNoteAnchors] = useState<Map<string, NoteSourceAnchorRecord>>(new Map());
  const [selectedNote, setSelectedNote] = useState<NoteRecord | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaveState, setNoteSaveState] = useState<'saved' | 'saving' | 'error' | 'unsaved'>('saved');
  const [noteDrawerMode, setNoteDrawerMode] = useState<'edit' | 'preview'>('edit');
  const selectedNoteRef = useRef<NoteRecord | null>(null);
  selectedNoteRef.current = selectedNote;
  const noteDraftRef = useRef(noteDraft);
  noteDraftRef.current = noteDraft;
  const activeDocumentIdRef = useRef(props.activeDocument.id);
  activeDocumentIdRef.current = props.activeDocument.id;
  const autosaveCoordinatorRef = useRef(new AutosaveCoordinator(400));
  const draftGenerationRef = useRef(0);

  const persistNote = useCallback(
    async (noteId: string, titleToPersist: string, bodyToPersist: string): Promise<void> => {
      const genAtStart = draftGenerationRef.current;
      setNoteSaveState('saving');
      try {
        const saved = await updateNote(noteId, titleToPersist, bodyToPersist);
        setDocumentNotes((all) => all.map((n) => (n.id === saved.id ? saved : n)));
        if (selectedNoteRef.current?.id === noteId && genAtStart === draftGenerationRef.current) {
          setSelectedNote(saved);
          setNoteDraft(saved.body_markdown);
          noteDraftRef.current = saved.body_markdown;
          setNoteSaveState('saved');
        }
      } catch (err) {
        if (selectedNoteRef.current?.id === noteId) {
          setNoteSaveState('error');
        }
        throw err;
      }
    },
    []
  );

  const handleFlushSave = useCallback(async (): Promise<boolean> => {
    const currentNote = selectedNoteRef.current;
    if (!currentNote) {
      setNoteSaveState('saved');
      return true;
    }
    const currentId = currentNote.id;
    const currentDraft = noteDraftRef.current;

    const hasPending = autosaveCoordinatorRef.current.hasPending(currentId);
    const hasInFlight = autosaveCoordinatorRef.current.hasInFlight(currentId);
    const isDirty = currentDraft !== currentNote.body_markdown;

    if (!hasPending && !hasInFlight && !isDirty) {
      setNoteSaveState('saved');
      return true;
    }

    if (!hasPending && isDirty) {
      const titleToSave = isAutoDerivedTitle(currentNote.title, currentNote.body_markdown)
        ? quickNoteTitle(currentDraft)
        : currentNote.title;
      autosaveCoordinatorRef.current.enqueue(currentId, titleToSave, currentDraft, persistNote);
    }

    try {
      setNoteSaveState('saving');
      await autosaveCoordinatorRef.current.flush(currentId, persistNote);
      if (selectedNoteRef.current?.id === currentId) {
        setNoteSaveState('saved');
      }
      return true;
    } catch {
      if (selectedNoteRef.current?.id === currentId) {
        setNoteSaveState('error');
      }
      return false;
    }
  }, [persistNote]);

  const refreshDocumentNotes = useCallback(async () => {
    const targetId = props.activeDocument.id;
    try {
      const [notes, anchors] = await Promise.all([listNotes({ documentId: targetId }), listNoteSourceAnchors(targetId)]);
      if (activeDocumentIdRef.current === targetId) {
        setDocumentNotes(notes);
        setNoteAnchors(new Map(anchors.map((anchor) => [anchor.note_id, anchor])));
      }
    } catch (e) {
      console.warn('Failed to refresh document notes', e);
    }
  }, [props.activeDocument.id]);

  useEffect(() => {
    let cancelled = false;
    const switchDoc = async () => {
      const ok = await handleFlushSave();
      if (cancelled) return;
      if (!ok) return;
      void refreshDocumentNotes();
      setSelectedNote(null);
    };
    void switchDoc();
    return () => { cancelled = true; };
  }, [props.activeDocument.id, refreshDocumentNotes, handleFlushSave]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId: string }>).detail;
      if (detail?.documentId === props.activeDocument.id) void refreshDocumentNotes();
    };
    window.addEventListener('mereth:quick-note-created', refresh);
    return () => window.removeEventListener('mereth:quick-note-created', refresh);
  }, [props.activeDocument.id, refreshDocumentNotes]);

  const previousSelectedNoteIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!selectedNote) {
      previousSelectedNoteIdRef.current = undefined;
      setNoteDraft('');
      noteDraftRef.current = '';
      draftGenerationRef.current = 0;
      setNoteSaveState('saved');
      return;
    }

    const idChanged = previousSelectedNoteIdRef.current !== selectedNote.id;
    previousSelectedNoteIdRef.current = selectedNote.id;

    if (idChanged || (!autosaveCoordinatorRef.current.hasPending(selectedNote.id) && !autosaveCoordinatorRef.current.hasInFlight(selectedNote.id))) {
      const draft = getRecoverableDraft(selectedNote.id);
      if (draft && draft.bodyMarkdown !== selectedNote.body_markdown) {
        setNoteDraft(draft.bodyMarkdown);
        noteDraftRef.current = draft.bodyMarkdown;
        setNoteSaveState('unsaved');
        const titleToPersist = isAutoDerivedTitle(selectedNote.title, selectedNote.body_markdown)
          ? quickNoteTitle(draft.bodyMarkdown)
          : (draft.title || selectedNote.title);
        autosaveCoordinatorRef.current.enqueue(selectedNote.id, titleToPersist, draft.bodyMarkdown, persistNote);
      } else {
        setNoteDraft(selectedNote.body_markdown);
        noteDraftRef.current = selectedNote.body_markdown;
        draftGenerationRef.current = 0;
        setNoteSaveState('saved');
      }
    }
  }, [selectedNote?.id, selectedNote?.body_markdown, persistNote]);

  useEffect(() => {
    return registerPendingSaveHandler(handleFlushSave);
  }, [handleFlushSave]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void handleFlushSave();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleFlushSave]);

  useEffect(() => {
    const close = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedNoteRef.current) {
          const ok = await handleFlushSave();
          if (!ok) return; // Keep drawer open and retain draft if save failed
          setSelectedNote(null);
        }
        props.setSelected('');
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [handleFlushSave, props.setSelected]);
  // ---- Task 3.7 (FR-9.6): sidebar search + filters, reset per document ----
  const [annotationFilters, setAnnotationFilters] = useState<AnnotationFilters>(EMPTY_ANNOTATION_FILTERS);
  useEffect(() => {
    setAnnotationFilters(EMPTY_ANNOTATION_FILTERS);
  }, [props.activeDocument.id]);
  const filtersActive =
    annotationFilters.searchText.trim() !== '' ||
    annotationFilters.types.length > 0 ||
    annotationFilters.paletteKeys.length > 0 ||
    annotationFilters.tags.some((t) => t.trim() !== '') ||
    annotationFilters.pageFrom !== null ||
    annotationFilters.pageTo !== null ||
    annotationFilters.noteStatus !== 'all' ||
    annotationFilters.rememberStatus !== 'all';
  const filteredList = useMemo(
    () =>
      applyAnnotationFilters(list, annotationFilters, {
        linkedIds: props.linkedAnnotationIds,
        rememberedIds: props.rememberedAnnotationIds,
      }),
    [list, annotationFilters, props.linkedAnnotationIds, props.rememberedAnnotationIds]
  );
  const activeFilteredIndex = filteredList.findIndex((item) => item.id === props.selected);
  const selectFilteredAt = (index: number) => {
    const item = filteredList[index];
    if (!item) return;
    props.setSelected(item.id);
    props.onJumpToAnnotation?.(item.page_index);
  };
  const patchFilters = (patch: Partial<AnnotationFilters>) =>
    setAnnotationFilters((prev) => ({ ...prev, ...patch }));

  // U6: live per-facet counts so chips show real zero/data states.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const type of ANNOTATION_TYPES) counts[type] = 0;
    for (const item of list) counts[item.annotation_type] = (counts[item.annotation_type] ?? 0) + 1;
    return counts;
  }, [list]);
  const paletteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of props.palette) counts[entry.key] = 0;
    for (const item of list) counts[item.color] = (counts[item.color] ?? 0) + 1;
    return counts;
  }, [list, props.palette]);

  return (
    <aside className={`right-pane${(props.rightTab === 'annotations' && props.activeAnnotation) || (props.rightTab === 'note' && selectedNote) ? ' detail-open' : ''}`} style={!(props.rightTab === 'annotations' && props.activeAnnotation) && !(props.rightTab === 'note' && selectedNote) && props.rightPaneWidth ? { width: `${props.rightPaneWidth}px` } : undefined}>
      <div className="pane-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={props.rightTab === id ? "pane-tab active" : "pane-tab"}
            onClick={async () => {
              if (props.rightTab === id) return;
              const ok = await handleFlushSave();
              if (!ok) return;
              props.setRightTab(id);
              props.setSelected('');
              setSelectedNote(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {props.rightTab === "annotations" && (
        <div className="annotation-list" onClick={(event) => { if (event.target === event.currentTarget) props.setSelected(''); }}>
          <div className="pane-heading">
            <span>All {list.length}{filtersActive ? ` · ${filteredList.length} shown` : ''}</span>
            <span className="pane-heading-actions">
              <button
                onClick={() => void props.onUndoAnnotation()}
                disabled={props.undoCount === 0}
                title={props.undoCount === 0 ? 'Nothing to undo yet' : `Undo last annotation action (${props.undoCount} available)`}
              >
                ↶ Undo
              </button>
            </span>
          </div>

          {/* Task 3.7 (FR-9.6): search + filters — pure semantics from
              annotationFilter.ts, benchmarked at 10k items. */}
          <div className="annotation-filters">
            <input
              className="filter-search"
              type="search"
              placeholder="Search quotes and comments…"
              value={annotationFilters.searchText}
              onChange={(e) => patchFilters({ searchText: e.target.value })}
              aria-label="Search annotation quote and comment text"
            />
            <div className="filter-chip-row" role="group" aria-label="Filter by annotation type">
              {ANNOTATION_TYPES.map((type) => {
                const on = annotationFilters.types.includes(type);
                const count = typeCounts[type] ?? 0;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`filter-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      patchFilters({
                        types: on
                          ? annotationFilters.types.filter((t) => t !== type)
                          : [...annotationFilters.types, type],
                      })
                    }
                  >
                    {type} {count}
                  </button>
                );
              })}
            </div>
            <div className="filter-chip-row" role="group" aria-label="Filter by colour label">
              {props.palette.map((entry) => {
                const on = annotationFilters.paletteKeys.includes(entry.key);
                const count = paletteCounts[entry.key] ?? 0;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={`filter-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    title={entry.label}
                    onClick={() =>
                      patchFilters({
                        paletteKeys: on
                          ? annotationFilters.paletteKeys.filter((k) => k !== entry.key)
                          : [...annotationFilters.paletteKeys, entry.key],
                      })
                    }
                  >
                    <i className="annotation-swatch" style={{ background: entry.color }} />
                    {entry.label} {count}
                  </button>
                );
              })}
            </div>
            <div className="filter-row">
              <input
                className="filter-tags"
                type="text"
                placeholder="Tags: claim, chapter-3"
                value={annotationFilters.tags.join(', ')}
                onChange={(e) => patchFilters({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                aria-label="Filter by tags (comma separated)"
              />
            </div>
            <div className="filter-row filter-pages">
              <span>Pages</span>
              <input
                type="number"
                min={1}
                placeholder="from"
                value={annotationFilters.pageFrom ?? ''}
                onChange={(e) =>
                  patchFilters({ pageFrom: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })
                }
                aria-label="Filter from page"
              />
              <span>–</span>
              <input
                type="number"
                min={1}
                placeholder="to"
                value={annotationFilters.pageTo ?? ''}
                onChange={(e) =>
                  patchFilters({ pageTo: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })
                }
                aria-label="Filter to page"
              />
            </div>
            <div className="filter-row filter-status">
              <select
                value={annotationFilters.noteStatus}
                onChange={(e) => patchFilters({ noteStatus: e.target.value as AnnotationFilters['noteStatus'] })}
                aria-label="Filter by note status"
              >
                <option value="all">Any note status</option>
                <option value="linked">Linked to a note</option>
                <option value="not-linked">Not linked to a note</option>
              </select>
              <select
                value={annotationFilters.rememberStatus}
                onChange={(e) => patchFilters({ rememberStatus: e.target.value as AnnotationFilters['rememberStatus'] })}
                aria-label="Filter by Remember status"
              >
                <option value="all">Any Remember status</option>
                <option value="remembered">Remembered</option>
                <option value="not-remembered">Not remembered</option>
              </select>
            </div>
            {filtersActive && (
              <button
                type="button"
                className="filter-clear"
                onClick={() => setAnnotationFilters(EMPTY_ANNOTATION_FILTERS)}
              >
                <Icon name="x" /> Clear filters
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <EmptyState viewType="annotations" />
          ) : filteredList.length === 0 ? (
            <p className="dimmed filter-empty">No annotations match these filters.</p>
          ) : (
            filteredList.map((item) => (
              <div
                key={item.id}
                className={props.selected === item.id ? "annotation-item active" : "annotation-item"}
              >
                <button
                  className="annotation-item-main"
                  onClick={() => {
                    props.setSelected(props.selected === item.id ? '' : item.id);
                    props.setRightTab('annotations');
                    if (props.selected !== item.id) props.onJumpToAnnotation?.(item.page_index);
                  }}
                  title={item.annotation_type === 'comment' ? item.comment : item.quote || paletteLabelFor(item.color, props.palette)}
                >
                  <i className="annotation-swatch" style={{ background: paletteColorFor(item.color, props.palette) }} />
                  <span>
                    <b>{paletteLabelFor(item.color, props.palette)} · {item.annotation_type}</b>
                    <small>p. {item.page_label || item.page_index + 1}</small>
                    <q>{item.annotation_type === 'area' ? 'Area capture' : item.annotation_type === 'bookmark' ? 'Bookmark' : item.comment || item.quote}</q>
                  </span>
                </button>
              </div>
            ))
          )}

          {props.activeAnnotation && (
            <><div className="annotation-detail-nav"><button disabled={activeFilteredIndex <= 0} onClick={() => selectFilteredAt(activeFilteredIndex - 1)}>← Previous</button><span>{activeFilteredIndex + 1} / {filteredList.length}</span><button disabled={activeFilteredIndex < 0 || activeFilteredIndex >= filteredList.length - 1} onClick={() => selectFilteredAt(activeFilteredIndex + 1)}>Next →</button><button aria-label="Close annotation detail" onClick={() => props.setSelected('')}>×</button></div><AnnotationEditor
              annotation={props.activeAnnotation}
              palette={props.palette}
              onSave={(id, color, comment, tags) => void props.onAnnotationUpdated(id, color, comment, tags)}
              onTrash={(id) => void props.onTrashAnnotation(id)}
              onRemember={(ann) => props.onRememberAnnotation?.(ann)}
              onAddEvidence={(ann) => props.onAddEvidenceToNote?.(ann)}
            />
            </>
          )}

          {props.trashedAnnotations.length > 0 && (
            <div className="trash-section">
              <div className="pane-heading">
                <span>Trash · {props.trashedAnnotations.length} recoverable</span>
              </div>
              {props.trashedAnnotations.map((item) => (
                <div key={item.id} className="annotation-item trash-item">
                  <i className="annotation-swatch" style={{ background: paletteColorFor(item.color, props.palette) }} />
                  <span>
                    <b>{paletteLabelFor(item.color, props.palette)} · {item.annotation_type}</b>
                    <small>p. {item.page_label || item.page_index + 1}</small>
                    <q>{item.annotation_type === 'area' ? 'Area capture' : item.annotation_type === 'bookmark' ? 'Bookmark' : item.comment || item.quote}</q>
                  </span>
                  <span className="trash-actions">
                    <button
                      className="button micro"
                      onClick={() => void props.onRestoreAnnotation(item.id)}
                      title="Restore from trash (FR-9.8)"
                    >
                      Restore
                    </button>
                    <button
                      className="button micro danger"
                      onClick={() => void props.onPurgeAnnotation(item.id)}
                      title="Purge permanently — this cannot be undone"
                    >
                      Purge
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {props.embeddedImportCounts &&
            props.embeddedImportCounts.newCount + props.embeddedImportCounts.duplicateCount > 0 && (
              <div className="embedded-summary-row">
                <button
                  className="wide-action"
                  onClick={props.onOpenEmbeddedImport}
                  disabled={props.embeddedImportDisabled}
                  title={
                    !props.embeddedImportDisabled
                      ? `Preview ${props.embeddedImportCounts.newCount + props.embeddedImportCounts.duplicateCount} PDF annotations before importing — duplicates and provenance are shown first (FR-9.9)`
                      : 'Document is still registering — retry in a moment'
                  }
                >
                  <Glyph name="layers" /> Import {props.embeddedImportCounts.newCount + props.embeddedImportCounts.duplicateCount} embedded PDF notes
                </button>
                <small>
                  This PDF carries its own annotations ({props.embeddedImportCounts.newCount} new ·{' '}
                  {props.embeddedImportCounts.duplicateCount} overlap · {props.embeddedImportCounts.unsupportedCount} skipped).
                  Import previews duplicates and provenance; the PDF is never modified.
                </small>
              </div>
            )}

          <button
            className="wide-action"
            onClick={() => props.activeAnnotation && props.onRememberAnnotation?.(props.activeAnnotation)}
            disabled={!props.activeAnnotation}
            title={!props.activeAnnotation ? 'Select a passage and annotate it first' : 'Draft a retrieval review prompt (R4 milestone)'}
          >
            <Glyph name="bookmark" /> Remember selected evidence
          </button>
        </div>
      )}
      {props.rightTab === "note" && <div className="document-note-workspace">
        <div className="document-note-list" onClick={async (event) => { if (event.target === event.currentTarget) { const ok = await handleFlushSave(); if (ok) setSelectedNote(null); } }}><div className="pane-heading"><span>Document notes · {documentNotes.length}</span></div>
          {documentNotes.length === 0 ? <p className="dimmed filter-empty">No notes are linked to this document yet. Press Alt+N while reading to capture one.</p> : documentNotes.map((note) => <button key={note.id} className={`document-note-row${selectedNote?.id === note.id ? ' active' : ''}`} onClick={async () => { if (selectedNote?.id === note.id) { const ok = await handleFlushSave(); if (ok) setSelectedNote(null); } else { const ok = await handleFlushSave(); if (ok) { setSelectedNote(note); props.setSelected(''); } } }}><b>{note.title || 'Untitled note'}</b><small>{note.note_type} · {new Date(note.updated_at).toLocaleDateString()}{noteAnchors.get(note.id) ? ` · p. ${noteAnchors.get(note.id)!.page_label}` : ''}</small><span>{note.body_markdown}</span></button>)}
        </div>
        {selectedNote && (
          <section className="note-detail-drawer">
            <header>
              <span>{selectedNote.note_type} note</span>
              <div className="note-drawer-header-actions">
                <button
                  type="button"
                  className="button micro"
                  onClick={() => setNoteDrawerMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
                  title={noteDrawerMode === 'edit' ? 'Preview formatted markdown' : 'Edit markdown'}
                >
                  {noteDrawerMode === 'edit' ? 'Preview' : 'Edit'}
                </button>
                {props.onOpenNoteInKnowledge && (
                  <button
                    type="button"
                    className="button micro"
                    onClick={async () => {
                      const ok = await handleFlushSave();
                      if (ok && selectedNoteRef.current) {
                        props.onOpenNoteInKnowledge?.(selectedNoteRef.current.id);
                      }
                    }}
                    title="Open in full 3-pane Knowledge view"
                  >
                    Open full
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close note detail"
                  onClick={async () => {
                    const ok = await handleFlushSave();
                    if (ok) setSelectedNote(null);
                  }}
                >
                  ×
                </button>
              </div>
            </header>
            <h2>{selectedNote.title}</h2>
            {noteDrawerMode === 'edit' ? (
              <textarea
                aria-label="Note body"
                value={noteDraft}
                onChange={(e) => {
                  const nextDraft = e.target.value;
                  setNoteDraft(nextDraft);
                  noteDraftRef.current = nextDraft;
                  draftGenerationRef.current += 1;
                  setNoteSaveState('saving');
                  const currentNote = selectedNoteRef.current;
                  if (currentNote) {
                    const titleToPersist = isAutoDerivedTitle(currentNote.title, currentNote.body_markdown)
                      ? quickNoteTitle(nextDraft)
                      : currentNote.title;
                    autosaveCoordinatorRef.current.enqueue(currentNote.id, titleToPersist, nextDraft, persistNote);
                  }
                }}
                onBlur={() => void handleFlushSave()}
                placeholder="Write in Markdown…"
              />
            ) : (
              <div
                className="note-reading note-sidecar-preview"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownToHtml(noteDraft || '*Empty note*'),
                }}
              />
            )}
            <footer>
              <span>
                {noteSaveState === 'saved'
                  ? 'Saved'
                  : noteSaveState === 'saving'
                  ? 'Saving…'
                  : noteSaveState === 'unsaved'
                  ? 'Unsaved changes'
                  : 'Save failed — retry by typing'}
                {noteSaveState === 'error' && (
                  <button
                    type="button"
                    className="button micro"
                    style={{ marginLeft: '8px' }}
                    onClick={() => void handleFlushSave()}
                  >
                    Retry
                  </button>
                )}
              </span>
              <div className="note-drawer-footer-actions">
                <button
                  type="button"
                  className="button danger-ghost micro"
                  onClick={async () => {
                    const currentId = selectedNote.id;
                    await trashNote(currentId);
                    setDocumentNotes((all) => all.filter((n) => n.id !== currentId));
                    if (selectedNoteRef.current?.id === currentId) {
                      setSelectedNote(null);
                    }
                  }}
                >
                  Trash
                </button>
                {props.onOpenNoteInKnowledge && (
                  <button
                    type="button"
                    className="button primary micro"
                    onClick={async () => {
                      const ok = await handleFlushSave();
                      if (ok && selectedNoteRef.current) {
                        props.onOpenNoteInKnowledge?.(selectedNoteRef.current.id);
                      }
                    }}
                  >
                    Open in Knowledge
                  </button>
                )}
              </div>
            </footer>
          </section>
        )}
      </div>}
    </aside>
  );
}



export function ReviewView({
  initialPromptId,
  reviewPreferences,
  onNavigateToAnnotation,
  onNavigateToNote,
  onSessionChange,
  onOpenSettings,
}: {
  initialPromptId?: string | null;
  reviewPreferences?: ReviewQueuePreferences;
  onNavigateToAnnotation?: (annotation: AnnotationRecord) => void;
  onNavigateToNote?: (noteId: string) => void;
  onSessionChange?: (session: ReviewSessionState | null) => void;
  onOpenSettings?: () => void;
}) {
  const [dueRows, setDueRows] = useState<DueReviewPromptRecord[]>([]);
  const [queueStats, setQueueStats] = useState<ReviewQueueStats>({ due_count: 0, adopted_count: 0, paused_count: 0 });
  const [session, setSession] = useState(() => getActiveReviewSession() ?? createReviewSession([]));
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [repairPrompt, setRepairPrompt] = useState<{ prompt: ReviewPromptRecord; failureCount: number } | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<ReviewPromptRecord | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [reviewedTodayMs, setReviewedTodayMs] = useState(0);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [synthesisText, setSynthesisText] = useState('');
  const [isSavingSynthesis, setIsSavingSynthesis] = useState(false);
  const [synthesisSaved, setSynthesisSaved] = useState(false);
  const [sourceContext, setSourceContext] = useState<{
    label: string;
    excerpt: string;
    annotation?: AnnotationRecord;
    noteId?: string;
  } | null>(null);
  // U19: browsable review history (recent events across all prompts).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recentEvents, setRecentEvents] = useState<RecentReviewEventRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // U19: per-prompt queue controls (pause / priority / reschedule / retire).
  const [queueMenuPromptId, setQueueMenuPromptId] = useState<string | null>(null);
  const [isRatingInFlight, setIsRatingInFlight] = useState(false);
  const isRatingInFlightRef = useRef(false);
  const undoStackRef = useRef<ReviewUndoStack>(new ReviewUndoStack());
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    if (session.step === 'prompt' || session.step === 'revealed') {
      setActiveReviewSession(session);
      onSessionChange?.(session);
    } else {
      setActiveReviewSession(null);
      onSessionChange?.(null);
    }
  }, [session, onSessionChange]);

  const applyControl = async (prompt: ReviewPromptRecord, action: Parameters<typeof applyQueueControl>[1]) => {
    setQueueMenuPromptId(null);
    const updated = applyQueueControl(prompt, action);
    try {
      await updateReviewPrompt(updated);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update prompt.');
    }
  };

  useEffect(() => {
    if (!session.current) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(session.current!.startedAt).getTime()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session.current?.startedAt]);

  const pauseCurrent = async () => {
    if (!session.current) return;
    try {
      await updateReviewPrompt({ ...session.current.prompt, paused_at: new Date().toISOString() });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause prompt.');
    }
  };

  const endSession = () => {
    clearActiveReviewSession();
    undoStackRef.current.clear();
    setCanUndo(false);
    onSessionChange?.(null);
    setSession(createReviewSession([]));
    setSynthesisText('');
    setSynthesisSaved(false);
  };

  const reload = useCallback(async () => {
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    if (reviewPreferences?.queuePaused === true) {
      setDueRows([]);
      setSession(createReviewSession([]));
      setActiveReviewSession(null);
      onSessionChange?.(null);
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    try {
      const usage = await getDailyReviewUsage();
      const countToday = usage.completed_cards;
      setCompletedToday(countToday);
      setReviewedTodayMs(usage.duration_ms);

      const dailyCardLimit = reviewPreferences?.dailyCardLimit ?? 50;
      const remainingDailyBudget = Math.max(0, dailyCardLimit - countToday);

      const timeLimitMs = (reviewPreferences?.dailyTimeLimitMinutes ?? 15) * 60_000;
      if (remainingDailyBudget <= 0 || (timeLimitMs > 0 && usage.duration_ms >= timeLimitMs)) {
        setDailyLimitReached(true);
        setDueRows([]);
        setSession(createReviewSession([]));
        setActiveReviewSession(null);
        onSessionChange?.(null);
        return;
      }

      setDailyLimitReached(false);
      const [due, stats, targetPrompt] = await Promise.all([
        getDueReviewPrompts(remainingDailyBudget),
        getReviewQueueStats(),
        initialPromptId ? getReviewPrompt(initialPromptId) : Promise.resolve(null),
      ]);
      // A deep link can prioritize a due card, but must not invent unscheduled variants.
      const mergedDue = targetPrompt ? [...due].sort((a, b) => Number(b.prompt.id === targetPrompt.id) - Number(a.prompt.id === targetPrompt.id)) : due;
      setDueRows(mergedDue);
      setQueueStats(stats);

      const active = getActiveReviewSession();
      if (active && (active.step === 'prompt' || active.step === 'revealed') && active.queue.length > 0) {
        const prunedQueue = pruneReviewSessionQueue(active, mergedDue, remainingDailyBudget);
        if (prunedQueue.length === 0) {
          setDailyLimitReached(true);
          setSession(createReviewSession([]));
          setActiveReviewSession(null);
          onSessionChange?.(null);
          return;
        }

        const prunedActive: ReviewSessionState = {
          ...active,
          queue: prunedQueue,
          currentIndex: active.currentIndex,
          current: prunedQueue[active.currentIndex]?.prompt.id === active.current?.prompt.id && prunedQueue[active.currentIndex]?.clozeIndex === active.current?.clozeIndex
            ? active.current : prunedQueue[active.currentIndex] ?? null,
        };

        const promptIds = Array.from(new Set(prunedQueue.map((c) => c.prompt.id)));
        const promptMap = new Map<string, ReviewPromptRecord | null>();
        await Promise.all(
          promptIds.map(async (id) => {
            const inDue = mergedDue.find((row) => row.prompt.id === id);
            if (inDue) {
              promptMap.set(id, inDue.prompt);
            } else {
              const fresh = await getReviewPrompt(id);
              promptMap.set(id, fresh);
            }
          })
        );
        const reconciled = reconcileReviewSession(prunedActive, promptMap);

        // Restore persisted schedules for retained retries or variants not present with schedule in mergedDue
        const uniqueVariants = Array.from(
          new Map(
            reconciled.queue.map((card) => [
              `${card.prompt.id}:${card.clozeIndex ?? 0}`,
              { promptId: card.prompt.id, clozeIndex: card.clozeIndex ?? 0 },
            ])
          ).values()
        );
        const restoredDueRows: DueReviewPromptRecord[] = [];
        await Promise.all(
          uniqueVariants.map(async ({ promptId, clozeIndex }) => {
            const inDueWithSchedule = mergedDue.find(
              (row) =>
                row.prompt.id === promptId &&
                (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === clozeIndex &&
                row.schedule != null
            );
            if (!inDueWithSchedule) {
              const schedule = await getReviewSchedule(promptId, clozeIndex);
              const prompt = promptMap.get(promptId) ?? reconciled.queue.find((c) => c.prompt.id === promptId)?.prompt;
              if (prompt) {
                restoredDueRows.push({
                  prompt,
                  schedule,
                  cloze_index: clozeIndex,
                });
              }
            }
          })
        );

        if (restoredDueRows.length > 0) {
          setDueRows([
            ...mergedDue.map((row) => {
              const restored = restoredDueRows.find(
                (r) =>
                  r.prompt.id === row.prompt.id &&
                  (r.cloze_index ?? 0) === (row.cloze_index ?? row.schedule?.cloze_index ?? 0)
              );
              return restored && restored.schedule ? restored : row;
            }),
            ...restoredDueRows.filter(
              (r) =>
                !mergedDue.some(
                  (row) =>
                    row.prompt.id === r.prompt.id &&
                    (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (r.cloze_index ?? 0)
                )
            ),
          ]);
        }

        // Set session and activate ONLY AFTER schedules and dueRows are restored!
        setSession(reconciled);
        if (reconciled.step === 'prompt' || reconciled.step === 'revealed') {
          setActiveReviewSession(reconciled);
          onSessionChange?.(reconciled);
        } else {
          setActiveReviewSession(null);
          onSessionChange?.(null);
        }
      } else {
        const newSession = limitReviewSession(createReviewSession(mergedDue), remainingDailyBudget);
        setSession(newSession);
        if (newSession.step === 'prompt') {
          setActiveReviewSession(newSession);
          onSessionChange?.(newSession);
        } else {
          setActiveReviewSession(null);
          onSessionChange?.(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [initialPromptId, onSessionChange, reviewPreferences?.dailyCardLimit, reviewPreferences?.dailyTimeLimitMinutes, reviewPreferences?.queuePaused]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Synthesis links must still resolve when their prompt is no longer due or
  // today's budget is exhausted. Inspecting a prompt does not reschedule it.
  useEffect(() => {
    if (!initialPromptId) return;
    let cancelled = false;
    void getReviewPrompt(initialPromptId).then(prompt => {
      if (!cancelled && prompt) setEditingPrompt(prompt);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open linked prompt.');
    });
    return () => { cancelled = true; };
  }, [initialPromptId]);

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryLoading(true);
    try {
      setRecentEvents(await getRecentReviewEvents(50));
    } catch {
      setRecentEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const currentPrompt = session.current?.prompt ?? null;

  useEffect(() => {
    let cancelled = false;
    setSourceContext(null);
    if (!currentPrompt) return () => { cancelled = true; };

    const loadSource = async () => {
      try {
        if (currentPrompt.annotation_id) {
          const annotation = await invoke<AnnotationRecord | null>('db_get_annotation', { id: currentPrompt.annotation_id });
          if (!cancelled && annotation) {
            setSourceContext({
              label: `Page ${annotation.page_label || annotation.page_index + 1}`,
              excerpt: annotation.quote || annotation.comment,
              annotation,
            });
          }
          return;
        }
        if (currentPrompt.note_id) {
          const note = await invoke<ReturnType<typeof createDefaultNoteRecord> | null>('db_get_note', { id: currentPrompt.note_id });
          if (!cancelled && note) {
            setSourceContext({
              label: note.title,
              excerpt: note.body_markdown.slice(0, 600),
              noteId: currentPrompt.note_id,
            });
          }
        }
      } catch {
        if (!cancelled) setSourceContext(null);
      }
    };
    void loadSource();
    return () => { cancelled = true; };
  }, [currentPrompt?.id, currentPrompt?.annotation_id, currentPrompt?.note_id]);

  const currentSchedule = currentPrompt
    ? dueRows.find((row) => row.prompt.id === currentPrompt.id && (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (session.current?.clozeIndex ?? 0))?.schedule ?? null
    : null;
  const previewBase = currentPrompt
    ? (['again', 'hard', 'good', 'easy'] as ReviewOutcome[]).map((outcome) => ({
        outcome,
        interval: scheduleReview({
          promptId: currentPrompt.id,
          outcome,
          reviewedAt: new Date(),
          previous: currentSchedule,
          clozeIndex: session.current?.clozeIndex ?? 0,
        }).intervalDays,
      }))
    : [];

  const reveal = () => {
    if (isRatingInFlightRef.current || loadingRef.current) return;
    setSession((prev) => revealCurrentCard(prev));
  };

  const rate = async (outcome: ReviewOutcome) => {
    if (isRatingInFlightRef.current || loadingRef.current) return;
    const currentCard = session.current;
    if (!currentCard || !currentCard.revealed) return;

    isRatingInFlightRef.current = true;
    setIsRatingInFlight(true);
    setError(null);

    const now = new Date();
    const { state: nextSession, attempt } = submitCurrentReview(session, outcome, now);
    if (!attempt) {
      isRatingInFlightRef.current = false;
      setIsRatingInFlight(false);
      return;
    }
    const previousSchedule = dueRows.find((row) => row.prompt.id === attempt.prompt.id && (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (attempt.clozeIndex ?? 0))?.schedule ?? null;
    const scheduled = scheduleReview({
      promptId: attempt.prompt.id,
      outcome,
      reviewedAt: now,
      previous: previousSchedule,
      clozeIndex: attempt.clozeIndex ?? 0,
    });
    const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `review-${Date.now()}`;
    try {
      const usage = await getDailyReviewUsage(now);
      const cardLimit = reviewPreferences?.dailyCardLimit ?? 50;
      if (reviewPreferences?.queuePaused || usage.completed_cards >= cardLimit) {
        setCompletedToday(usage.completed_cards);
        setDailyLimitReached(true);
        return;
      }
      await recordReviewEvent({
        id: eventId,
        prompt_id: attempt.prompt.id,
        cloze_index: attempt.clozeIndex ?? 0,
        reviewed_at: now.toISOString(),
        outcome,
        duration_ms: attempt.durationMs,
        user_response: attempt.userResponse,
        provenance: 'user_authored',
      }, {
        ...scheduled.schedule,
        cloze_index: attempt.clozeIndex ?? 0,
      });

      let sessionAfterOutcome = nextSession;
      if (outcome === 'again') {
        sessionAfterOutcome = requeueCardForRelearning(nextSession, currentCard, now);
      }
      const completed = usage.completed_cards + 1;
      const duration = usage.duration_ms + attempt.durationMs;
      const timeLimitMs = (reviewPreferences?.dailyTimeLimitMinutes ?? 15) * 60_000;
      const reached = completed >= cardLimit || (timeLimitMs > 0 && duration >= timeLimitMs);
      setCompletedToday(completed);
      setReviewedTodayMs(duration);
      setDailyLimitReached(reached);
      sessionAfterOutcome = limitReviewSession(sessionAfterOutcome, reached ? 0 : cardLimit - completed);

      undoStackRef.current.push({
        eventId,
        promptId: attempt.prompt.id,
        previousSchedule,
        attempt,
        clozeIndex: attempt.clozeIndex ?? 0,
        sessionBefore: session,
      });
      setCanUndo(true);

      setSession(sessionAfterOutcome);
      if (sessionAfterOutcome.step === 'prompt' || sessionAfterOutcome.step === 'revealed') {
        setActiveReviewSession(sessionAfterOutcome);
        onSessionChange?.(sessionAfterOutcome);
      } else {
        setActiveReviewSession(null);
        onSessionChange?.(null);
      }

      setQueueStats((prev) => ({ ...prev, due_count: Math.max(0, prev.due_count - 1) }));
      setDueRows((prev) => [
        ...prev.filter(row => !(row.prompt.id === attempt.prompt.id && (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (attempt.clozeIndex ?? 0))),
        { prompt: attempt.prompt, schedule: scheduled.schedule, cloze_index: attempt.clozeIndex ?? 0 },
      ]);

      if (outcome === 'again') {
        const history = await getReviewHistory(attempt.prompt.id);
        const failureCount = history.filter((event) => event.outcome === 'again').length;
        if (hasRepeatedFailures(failureCount)) {
          setRepairPrompt({ prompt: attempt.prompt, failureCount });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review outcome.');
    } finally {
      isRatingInFlightRef.current = false;
      setIsRatingInFlight(false);
    }
  };

  const undoLastReview = async () => {
    if (isRatingInFlightRef.current) return;
    const lastUndo = undoStackRef.current.pop();
    setCanUndo(undoStackRef.current.canUndo);
    if (!lastUndo) return;

    isRatingInFlightRef.current = true;
    setIsRatingInFlight(true);
    setError(null);

    try {
      await undoReviewEventIpc(
        lastUndo.eventId,
        lastUndo.promptId,
        lastUndo.previousSchedule,
        lastUndo.attempt.clozeIndex ?? 0
      );
      setCompletedToday(value => Math.max(0, value - 1));
      setReviewedTodayMs(value => Math.max(0, value - lastUndo.attempt.durationMs));
      setDailyLimitReached(false);

      const restoredCard: ReviewSessionCard = {
        prompt: lastUndo.attempt.prompt,
        userResponse: lastUndo.attempt.userResponse,
        revealed: true,
        startedAt: new Date().toISOString(),
        clozeIndex: lastUndo.attempt.clozeIndex,
      };

      const rewoundSession = lastUndo.sessionBefore
        ? { ...lastUndo.sessionBefore, current: restoredCard }
        : rewindReviewSession(session, restoredCard);
      setSession(rewoundSession);
      if (rewoundSession.step === 'prompt' || rewoundSession.step === 'revealed') {
        setActiveReviewSession(rewoundSession);
        onSessionChange?.(rewoundSession);
      } else {
        setActiveReviewSession(null);
        onSessionChange?.(null);
      }

      setQueueStats((prev) => ({ ...prev, due_count: prev.due_count + 1 }));
      setDueRows((prev) => {
        const exists = prev.some(
          (row) => row.prompt.id === lastUndo.promptId && (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (lastUndo.attempt.clozeIndex ?? 0)
        );
        if (exists) {
          return prev.map((row) =>
            row.prompt.id === lastUndo.promptId && (row.cloze_index ?? row.schedule?.cloze_index ?? 0) === (lastUndo.attempt.clozeIndex ?? 0)
              ? { ...row, schedule: lastUndo.previousSchedule }
              : row
          );
        }
        return [{ prompt: lastUndo.attempt.prompt, schedule: lastUndo.previousSchedule, cloze_index: lastUndo.attempt.clozeIndex ?? 0 }, ...prev];
      });
    } catch (err) {
      undoStackRef.current.push(lastUndo);
      setCanUndo(true);
      setError(err instanceof Error ? err.message : 'Failed to undo review.');
    } finally {
      isRatingInFlightRef.current = false;
      setIsRatingInFlight(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (loadingRef.current) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        repairPrompt ||
        editingPrompt
      ) {
        return;
      }

      // Ctrl+Z or Cmd+Z: in-session review undo
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
        event.preventDefault();
        if (!isRatingInFlightRef.current && canUndo) {
          void undoLastReview();
        }
        return;
      }

      if (isRatingInFlightRef.current) return;
      if (!session.current) return;

      if (event.key === ' ' || event.code === 'Space') {
        if (!session.current.revealed) {
          event.preventDefault();
          reveal();
        }
      } else if (session.current.revealed) {
        if (event.key === '1') {
          event.preventDefault();
          void rate('again');
        } else if (event.key === '2') {
          event.preventDefault();
          void rate('hard');
        } else if (event.key === '3') {
          event.preventDefault();
          void rate('good');
        } else if (event.key === '4') {
          event.preventDefault();
          void rate('easy');
        }
      }

      // J shortcut: only navigate to source if the answer has already been revealed
      // (Concealed-retrieval requirement: source cannot be opened before reveal or explicit "can't recall")
      if ((event.key === 'j' || event.key === 'J') && session.current.revealed) {
        if (sourceContext?.annotation && onNavigateToAnnotation) {
          event.preventDefault();
          onNavigateToAnnotation(sourceContext.annotation);
        } else if (sourceContext?.noteId && onNavigateToNote) {
          event.preventDefault();
          onNavigateToNote(sourceContext.noteId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, repairPrompt, editingPrompt, sourceContext, onNavigateToAnnotation, onNavigateToNote, canUndo, isRatingInFlight]);


  const isCloze = currentPrompt?.prompt_type === 'cloze';
  const clozeCard = (isCloze && currentPrompt)
    ? renderClozeCard(currentPrompt.question, session.current?.clozeIndex, session.current?.revealed ?? false)
    : null;

  const applyRepair = async (result: PromptRepairResult) => {
    const [primary, ...additional] = result.prompts;
    if (!primary) return;
    try {
      await updateReviewPrompt(primary);
      for (const prompt of additional) {
        await createReviewPrompt({
          ...prompt,
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${prompt.id}-${Date.now()}`,
          status: 'draft',
          adopted_at: null,
        });
      }
      setRepairPrompt(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply prompt repair.');
    }
  };

  return (
    <section className="review-view">
      {(session.current || canUndo) && !reviewPreferences?.queuePaused && (
        <div className="review-session-toolbar">
          <strong>Review</strong>
          {session.current && (
            <span>Card {session.currentIndex + 1} of {session.queue.length} · budget {reviewPreferences?.dailyCardLimit ?? 50}/day · {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} elapsed</span>
          )}
          <button
            type="button"
            className="button compact"
            onClick={() => void undoLastReview()}
            disabled={!canUndo || isRatingInFlight}
            title="Undo last review rating (Ctrl+Z)"
          >
            Undo (Ctrl+Z)
          </button>
          {session.current && (
            <>
              <button className="button compact" onClick={() => void pauseCurrent()} disabled={isRatingInFlight}>Pause this prompt</button>
              <button className="button compact" onClick={() => setEditingPrompt(session.current!.prompt)} disabled={isRatingInFlight}>Edit prompt</button>
            </>
          )}
          <button className="button compact" onClick={endSession} disabled={isRatingInFlight}>End session</button>
        </div>
      )}
      <span className="eyebrow">{queueStats.due_count} due · {queueStats.adopted_count} adopted · {queueStats.paused_count} paused</span>
      <h1>Review before you reveal.</h1>
      <p className="review-preamble">You decide the outcome. The source is the feedback authority.</p>
      <div className="destination-rule" />
      <button className="button compact" onClick={() => void toggleHistory()} aria-expanded={historyOpen}>
        {historyOpen ? 'Hide review history' : 'Show review history'}
      </button>
      {historyOpen && (
        historyLoading ? (
          <EmptyState viewType="annotations" customTitle="Loading history" customDescription="Reading recent review events." />
        ) : recentEvents.length === 0 ? (
          <EmptyState
            viewType="annotations"
            customTitle="No review history yet"
            customDescription="Rated reviews are recorded here as you work through the queue."
          />
        ) : (
          <ul className="review-history-list" aria-label="Recent review events">
            {recentEvents.map((event) => (
              <li key={event.id} className="review-history-item">
                <span className={`review-history-outcome outcome-${event.outcome}`}>{event.outcome}</span>
                <div>
                  <b>
                    {event.prompt_question.includes('{{c')
                      ? renderClozeCard(event.prompt_question, undefined, false).plainTextPrompt
                      : event.prompt_question}
                  </b>
                  <small>
                    {new Date(event.reviewed_at).toLocaleString()} · {Math.round(event.duration_ms / 100) / 10}s
                    {event.user_response ? ' · typed response recorded' : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {error && <p className="error-text">{error}</p>}
      {repairPrompt && (
        <PromptRepairModal
          isOpen={true}
          prompt={repairPrompt.prompt}
          failureCount={repairPrompt.failureCount}
          onClose={() => setRepairPrompt(null)}
          onRepair={(result) => void applyRepair(result)}
        />
      )}
      <PromptEditorModal isOpen={editingPrompt !== null} initialPrompt={editingPrompt} onClose={() => setEditingPrompt(null)} onSaved={() => void reload()} />

      {reviewPreferences?.queuePaused === true ? (
        <div
          className="review-paused-banner"
          role="alert"
          style={{
            maxWidth: '540px',
            margin: '24px auto',
            padding: '16px',
            background: 'var(--surface-color, #fff)',
            border: '1px solid var(--border-color, #e0e0e0)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 12px 0' }}>
            Review queue is paused. You can resume it in Settings &gt; Review.
          </p>
          {onOpenSettings && (
            <button type="button" className="button primary" onClick={onOpenSettings}>
              Open Settings
            </button>
          )}
        </div>
      ) : dailyLimitReached && session.step !== 'complete' ? (
        <div
          className="review-limit-reached-banner"
          role="status"
          style={{
            maxWidth: '540px',
            margin: '24px auto',
            padding: '16px',
            background: 'var(--surface-color, #fff)',
            border: '1px solid var(--border-color, #e0e0e0)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 12px 0' }}>
            Daily review budget reached ({completedToday} ratings, {Math.floor(reviewedTodayMs / 60_000)} minutes today). Take a break or adjust your limit in Settings.
          </p>
          {onOpenSettings && (
            <button type="button" className="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          )}
        </div>
      ) : loading ? (
        <EmptyState viewType="annotations" customTitle="Loading review queue" customDescription="Checking local due prompts." />
      ) : session.step === 'complete' ? (
        <div className="review-complete-container">
          <EmptyState
            viewType="annotations"
            customTitle="Review complete"
            customDescription={dailyLimitReached ? 'Daily review budget reached. Remaining cards stay due; your ratings were saved locally.' : 'All due prompts in this session have been rated. The next due dates were saved locally.'}
          />
          <section className="review-synthesis-section" style={{ maxWidth: '540px', margin: '16px auto', padding: '16px', background: 'var(--surface-color, #fff)', border: '1px solid var(--border-color, #e0e0e0)', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>What changed in your understanding?</h3>
            <textarea
              aria-label="What changed in your understanding?"
              value={synthesisText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSynthesisText(e.target.value)}
              placeholder="Synthesize what you learned or how your mental model shifted..."
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '12px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color, #ccc)' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
              {synthesisSaved && <span style={{ marginRight: 'auto', fontSize: '0.85rem', color: 'green' }}>Saved to Concept Note!</span>}
              <button
                type="button"
                className="button primary"
                disabled={!synthesisText.trim() || isSavingSynthesis}
                onClick={async () => {
                  if (!synthesisText.trim()) return;
                  setIsSavingSynthesis(true);
                  try {
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const reviewedCards = session.queue;
                    const seenPromptIds = new Set<string>();
                    const uniquePrompts: ReviewPromptRecord[] = [];
                    for (const card of reviewedCards) {
                      if (!seenPromptIds.has(card.prompt.id)) {
                        seenPromptIds.add(card.prompt.id);
                        uniquePrompts.push(card.prompt);
                      }
                    }
                    const reviewedPromptsList = uniquePrompts
                      .map((p) => `- ${formatReviewPromptLink(p)}`)
                      .join('\n');
                    const body = `# Review Synthesis — ${todayStr}\n\n*Review session completed on ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}*\n\n## Shifts in Understanding\n${synthesisText.trim()}${reviewedPromptsList ? `\n\n## Reviewed Prompts\n${reviewedPromptsList}` : ''}`;
                    const note = createDefaultNoteRecord({
                      note_type: 'concept',
                      title: `Review Synthesis — ${todayStr}`,
                      body_markdown: body,
                    });
                    await createNote(note);
                    setSynthesisSaved(true);
                    setSynthesisText('');
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : 'Failed to create concept note.');
                  } finally {
                    setIsSavingSynthesis(false);
                  }
                }}
              >
                Save to Concept Note
              </button>
              <button
                type="button"
                className="button"
                onClick={endSession}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : session.step === 'empty' || !session.current ? (
        <EmptyState
          viewType="annotations"
          customTitle="Nothing due"
          customDescription="Adopted prompts appear here when their local FSRS schedule is due."
        />
      ) : (
        <article className="review-card">
          {(reviewPreferences?.dailyTimeLimitMinutes ?? 15) > 0 && reviewedTodayMs / 1000 + elapsedSeconds >= (reviewPreferences?.dailyTimeLimitMinutes ?? 15) * 60 ? (
            <div
              className="review-time-limit-indicator"
              role="status"
              style={{
                padding: '8px 12px',
                marginBottom: '12px',
                background: 'var(--warning-bg, #fff3cd)',
                color: 'var(--warning-text, #856404)',
                borderRadius: '4px',
                fontSize: '0.9rem',
                textAlign: 'center',
              }}
            >
              Daily review time reached. Finish this card, then take a break.
            </div>
          ) : null}
          <div className="review-card-header">
            <span>Card {session.currentIndex + 1} of {session.queue.length}</span>
            <span>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')} elapsed</span>
            <div style={{ position: 'relative', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="button compact"
                aria-haspopup="menu"
                aria-expanded={queueMenuPromptId === session.current.prompt.id}
                onClick={() => setQueueMenuPromptId((prev) => (prev === session.current!.prompt.id ? null : session.current!.prompt.id))}
                disabled={isRatingInFlight}
              >
                Queue options
              </button>
              {queueMenuPromptId === session.current.prompt.id && (
                <div role="menu" aria-label="Queue controls" className="queue-controls-menu">
                  <button role="menuitem" onClick={() => void applyControl(session.current!.prompt, { type: 'pause' })}>Pause this prompt</button>
                  <button role="menuitem" onClick={() => void applyControl(session.current!.prompt, { type: 'set_priority', priority: session.current!.prompt.priority + 1 })}>Raise priority</button>
                  <button role="menuitem" onClick={() => void applyControl(session.current!.prompt, { type: 'reschedule', dueAt: new Date(Date.now() + 7 * 86400000).toISOString() })}>Reschedule +7 days</button>
                  <button role="menuitem" onClick={() => void applyControl(session.current!.prompt, { type: 'retire' })}>Retire prompt</button>
                </div>
              )}
            </div>
          </div>
          {isCloze && clozeCard ? (
            <h2
              className="cloze-prompt-heading"
              dangerouslySetInnerHTML={{ __html: clozeCard.html }}
            />
          ) : (
            <h2>{session.current.prompt.question}</h2>
          )}
          {session.current.prompt.cue && <p className="dimmed">Cue: {session.current.prompt.cue}</p>}

          {!session.current.revealed ? (
            <>
              <label className="field-label">
                Optional typed response
                <textarea
                  value={session.current.userResponse}
                  onChange={(event) => setSession((prev) => updateUserResponse(prev, event.target.value))}
                  placeholder="Answer from memory before revealing the source."
                  disabled={isRatingInFlight}
                />
              </label>
              <button className="wide-action primary" onClick={reveal} disabled={isRatingInFlight}>
                Reveal answer and source (Space)
              </button>
              <button className="wide-action" onClick={reveal} disabled={isRatingInFlight}>Skip — I can't recall</button>
            </>
          ) : (
            <>
              {session.current.userResponse && (
                <div className="evidence-block">
                  <b>Your response</b>
                  <p>{session.current.userResponse}</p>
                </div>
              )}
              <div className="evidence-block">
                <b>Adopted answer</b>
                <p>{(isCloze ? clozeCard?.answer : session.current.prompt.answer) || 'No adopted answer text was saved for this prompt.'}</p>
              </div>
              <div className="evidence-block">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <b>Linked source</b>
                  {sourceContext?.annotation && onNavigateToAnnotation && (
                    <button
                      type="button"
                      className="button micro primary"
                      onClick={() => onNavigateToAnnotation(sourceContext.annotation!)}
                      title="Jump to the source page in the PDF reader (Shortcut: J)"
                      disabled={isRatingInFlight}
                    >
                      Open page in PDF (J)
                    </button>
                  )}
                  {sourceContext?.noteId && onNavigateToNote && (
                    <button
                      type="button"
                      className="button micro primary"
                      onClick={() => onNavigateToNote(sourceContext.noteId!)}
                      title="Jump to note in Knowledge view (Shortcut: J)"
                      disabled={isRatingInFlight}
                    >
                      Open note (J)
                    </button>
                  )}
                </div>
                {sourceContext ? (
                  <><small>{sourceContext.label}</small><p>{sourceContext.excerpt || 'The linked source has no excerpt text.'}</p></>
                ) : (
                  <small>The linked source could not be resolved.</small>
                )}
              </div>
              <div className="review-ratings">
                {previewBase.map(({ outcome, interval }) => (
                  <button key={outcome} className="wide-action" onClick={() => void rate(outcome)} disabled={isRatingInFlight}>
                    {outcome === 'again'
                      ? 'Again (1)'
                      : outcome === 'hard'
                      ? 'Hard (2)'
                      : outcome === 'good'
                      ? 'Good (3)'
                      : 'Easy (4)'}
                    <small>{formatIntervalPreview(interval)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </article>
      )}

    </section>
  );
}

function SettingsView({
  appearance,
  onUpdateAppearance,
  palette,
  onSavePalette,
  updates,
  reviewPreferences,
  onUpdateReviewPreferences,
}: {
  appearance: AppearancePreferences;
  onUpdateAppearance: <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => void;
  palette: PaletteEntry[];
  onSavePalette: (palette: PaletteEntry[]) => void;
  updates: UpdateCenterModel;
  reviewPreferences: ReviewQueuePreferences;
  onUpdateReviewPreferences: (preferences: ReviewQueuePreferences) => void;
}) {
  const [settingTab, setSettingTab] = useState<'privacy' | 'updates' | 'shortcuts' | 'appearance' | 'annotations' | 'review' | 'export'>('privacy');
  const [exportOpen, setExportOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticCounts, setDiagnosticCounts] = useState({
    documentCount: 0, annotationCount: 0, noteCount: 0, reviewPromptCount: 0, reviewEventCount: 0,
  });
  // U21: pending export that hit an existing destination; the modal decides
  // overwrite vs rename-copy before anything is written.
  const [exportConflict, setExportConflict] = useState<{
    format: ExportFormat;
    destination: string;
    diffPreview: string;
  } | null>(null);

  const diagnosticReport = buildDiagnosticReport(
    {
      appVersion: updates.version,
      platform: navigator.platform || "unknown",
      arch: "unknown",
      memoryRssMb: null,
      totalSystemMemoryMb: null,
      theme: appearance.theme,
    },
    diagnosticCounts
  );

  const openDiagnostics = async () => {
    setDiagnosticCounts(await invoke<typeof diagnosticCounts>('db_get_diagnostic_counts'));
    setDiagnosticsOpen(true);
  };

  const writeExport = async (format: ExportFormat, destination: string) => {
    if (format === 'markdown') {
      await invoke('db_export_markdown_package', { destinationDir: destination });
    } else if (format === 'json_backup') {
      await invoke('db_create_json_backup', { destinationFile: destination });
    } else if (format === 'review_csv') {
      await invoke('db_export_review_csv', { destinationFile: destination, delimiter: ',' });
    } else if (format === 'review_tsv') {
      await invoke('db_export_review_csv', { destinationFile: destination, delimiter: '\t' });
    } else {
      throw new Error('Annotated PDF copy export is not connected to a native writer in this build.');
    }
    setExportStatus(`Export completed: ${destination}`);
  };

  const runExport = async (format: ExportFormat, destination: string) => {
    if (!destination) throw new Error('Choose an explicit destination first.');
    let snapshot: DestinationSnapshot | null = null;
    try {
      snapshot = await checkDestination(destination);
    } catch {
      snapshot = null; // Backend unavailable (dev preview): proceed as before.
    }
    if (snapshot) {
      const decision = resolveDestinationSafety({
        path: snapshot.path,
        exists: snapshot.exists,
        currentSha256: (snapshot as { current_sha256?: string | null }).current_sha256 ?? snapshot.currentSha256 ?? null,
      });
      if (decision.action === 'confirm_overwrite') {
        setExportConflict({ format, destination, diffPreview: decision.diffPreview });
        return;
      }
      if (decision.action === 'rename_copy') {
        destination = decision.suggestedPath;
      }
    }
    await writeExport(format, destination);
  };

  return (
    <section className="settings-view">
      <aside role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          id="tab-privacy"
          aria-selected={settingTab === 'privacy'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'privacy' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('privacy')}
        >
          Privacy
        </button>
        <button
          type="button"
          role="tab"
          id="tab-updates"
          aria-selected={settingTab === 'updates'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'updates' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('updates')}
        >
          Updates
        </button>
        <button
          type="button"
          role="tab"
          id="tab-shortcuts"
          aria-selected={settingTab === 'shortcuts'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'shortcuts' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('shortcuts')}
        >
          Shortcuts
        </button>
        <button
          type="button"
          role="tab"
          id="tab-appearance"
          aria-selected={settingTab === 'appearance'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'appearance' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('appearance')}
        >
          Appearance
        </button>
        <button
          type="button"
          role="tab"
          id="tab-annotations"
          aria-selected={settingTab === 'annotations'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'annotations' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('annotations')}
        >
          Annotations
        </button>
        <button
          type="button"
          role="tab"
          id="tab-review"
          aria-selected={settingTab === 'review'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'review' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('review')}
        >
          Review
        </button>
        <button
          type="button"
          role="tab"
          id="tab-export"
          aria-selected={settingTab === 'export'}
          aria-controls="settings-tabpanel"
          className={`settings-tab-btn${settingTab === 'export' ? ' selected-setting' : ''}`}
          onClick={() => setSettingTab('export')}
        >
          Export
        </button>
      </aside>
      <article id="settings-tabpanel" role="tabpanel" aria-labelledby={`tab-${settingTab}`}>
        {settingTab === 'updates' ? (
          <SettingsUpdates model={updates} />
        ) : settingTab === 'shortcuts' ? (
          <SettingsShortcuts />
        ) : settingTab === 'appearance' ? (
          <SettingsAppearance preferences={appearance} onUpdatePreference={onUpdateAppearance} />
        ) : settingTab === 'annotations' ? (
          <SettingsAnnotations palette={palette} onSavePalette={onSavePalette} />
        ) : settingTab === 'review' ? (
          <SettingsReview
            preferences={reviewPreferences}
            onChange={onUpdateReviewPreferences}
          />
        ) : settingTab === 'export' ? (
          <div>
            <span className="eyebrow">Portable, local output</span>
            <h1>Export and restore</h1>
            <p>Create readable packages or a complete backup containing evidence and area-capture files.</p>
            <div className="destination-rule" />
            <div className="setting-state">
              <div><b>Export</b><p>Write Markdown, a JSON backup, or review CSV/TSV through the native destination picker. Annotated PDF copy is shown but awaits its native writer.</p></div>
              <button className="wide-action primary" onClick={() => setExportOpen(true)}>Export...</button>
            </div>
            <div className="setting-state">
              <div><b>Local diagnostics</b><p>Inspect aggregate system and storage counts before copying or saving them. No document or note content is included.</p></div>
              <button className="wide-action" onClick={() => void openDiagnostics()}>Inspect diagnostics...</button>
            </div>
            <label className="field-label" htmlFor="restore-json">Backup JSON
              <textarea id="restore-json" rows={8} value={backupJson} onChange={(event) => setBackupJson(event.target.value)} placeholder="Paste the contents of a Mereth JSON backup." />
            </label>
            <button className="wide-action" disabled={!backupJson.trim()} onClick={() => setRestoreOpen(true)}>Preview restore</button>
            {exportStatus && <p role="status">{exportStatus}</p>}
            <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} onExport={runExport} onChooseDestination={chooseNativeExportDestination} />
            <DiagnosticExportModal
              isOpen={diagnosticsOpen}
              onClose={() => setDiagnosticsOpen(false)}
              report={diagnosticReport}
              onSaveJson={(json) => {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "mereth-diagnostics.json";
                link.click();
                URL.revokeObjectURL(url);
              }}
            />
            <RestoreBackupModal isOpen={restoreOpen} backupJson={backupJson} onClose={() => setRestoreOpen(false)} onRestore={async () => {
              await invoke('db_restore_from_backup', { backupJson });
              setExportStatus('Restore completed. Reopen the destination views to refresh restored records.');
            }} />
            <DestinationConflictModal
              isOpen={Boolean(exportConflict)}
              path={exportConflict?.destination ?? ''}
              diffPreview={exportConflict?.diffPreview ?? ''}
              onOverwrite={async () => {
                const conflict = exportConflict;
                setExportConflict(null);
                if (conflict) await writeExport(conflict.format, conflict.destination);
              }}
              onRename={async (path) => {
                const conflict = exportConflict;
                setExportConflict(null);
                if (conflict) await writeExport(conflict.format, suggestCopyPath(path));
              }}
              onCancel={() => setExportConflict(null)}
            />
          </div>
        ) : (
          <>
            <span className="eyebrow">Your local boundary</span>
            <h1>Privacy</h1>
            <p>Mereth's v1 reading, annotation, notes, review, search, and export workflows run locally without an account or model runtime.</p>
            <div className="destination-rule" />
            <div className="setting-state">
              <div>
                <b>Local-first workspace</b>
                <p>Mereth does not require a hosted service for the v1 product loop. Future optional AI work is deferred and is not exposed as a nonfunctional control.</p>
              </div>
            </div>
          </>
        )}
      </article>
    </section>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
}
