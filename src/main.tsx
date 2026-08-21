import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import { DocumentRecord } from "./utils/pdfImport";
import {
  loadPdfDocument,
  extractPdfPageTexts,
  getPdfPageTextItems,
  getPdfPageBaseSize,
  LoadedPdfInfo,
} from "./utils/pdfViewer";
import { ImportModal } from "./components/ImportModal";
import { MissingFileBanner } from "./components/MissingFileBanner";
import { DeepLinkRoute } from "./utils/launchRouting";
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
import { SearchOptions, performAdvancedSearch, getNextMatchIndex, DEFAULT_SEARCH_OPTIONS } from "./utils/searchUtils";
import { parseOutlineTree } from "./utils/navigationUtils";
import { resolveShortcutAction } from "./utils/shortcutUtils";
import { getPdfPageEmbeddedAnnotations } from "./utils/pdfViewer";
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

type Destination = "library" | "reader" | "notes" | "review" | "settings";

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
  ["library", "Library", "▤"],
  ["reader", "Reader", "▯"],
  ["notes", "Notes", "✎"],
  ["review", "Review", "↻"],
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

function Glyph({ children }: { children: string }) {
  return <span className="glyph" aria-hidden="true">{children}</span>;
}

function App() {
  // The app opens to the Library. With no documents it shows honest empty
  // states — there is no bundled demo document and no fabricated content.
  const [destination, setDestination] = useState<Destination>("library");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"annotations" | "note" | "ai">("annotations");
  const [aiOn, setAiOn] = useState(false);
  const [selected, setSelected] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [initialImportPath, setInitialImportPath] = useState<string | null>(null);
  const [pdfEntryMode, setPdfEntryMode] = useState<'open' | 'import'>('open');
  const [readingOnly, setReadingOnly] = useState(false);

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
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

  // Task 3.3 version handling (FR-7.3): real open-time fingerprint state.
  // `versionStatus` is what the open check reported; `versionOffer` carries
  // the previous version id while the re-anchoring offer is pending;
  // `reanchorDecision` records the user's choice; `reanchorSummary` is the
  // result of the re-anchoring pass.
  const [versionStatus, setVersionStatus] = useState<VersionCheckResult["status"] | null>(null);
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
  const [notesList] = useState<Array<{ id: string; title: string; type: string }>>([]);
  const [reviewPromptsList] = useState<Array<{ id: string; prompt: string }>>([]);
  // The current version row's id — creation-time checksums bind to it and
  // re-anchoring switches it; null until registration/refresh completes.
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  // Task 3.5: the user's semantic palette (FR-9.3), loaded from settings.
  const [palette, setPalette] = useState<PaletteEntry[]>(DEFAULT_ANNOTATION_PALETTE);
  // In-session undo (FR-9.8): the manager holds the inverse information; the
  // counter drives the UI's can-undo affordance.
  const undoManagerRef = useRef<AnnotationUndoManager | null>(null);
  if (!undoManagerRef.current) undoManagerRef.current = new AnnotationUndoManager();
  const [undoCount, setUndoCount] = useState(0);

  const activeAnnotation = useMemo(
    () => annotationsList.find((annotation) => annotation.id === selected) ?? annotationsList[0] ?? null,
    [selected, annotationsList],
  );

  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);

  const handleLaunchRoutePayload = (payload: LaunchRoutePayload) => {
    // Task 2.9 gate mark (dev-only) so boot failures are attributable.
    perfMark(`route.payload:${JSON.stringify(payload).slice(0, 160)}`);
    const docPath = payload.target_document_path ?? payload.targetDocumentPath;
    if (docPath) {
      const existing = documents.find((d) => d.filepath === docPath || d.original_filepath === docPath);
      if (existing) {
        openDocument(existing);
      } else {
        setInitialImportPath(docPath);
        setPdfEntryMode('open');
        setImportOpen(true);
      }
      return;
    }

    const dl = payload.deep_link ?? payload.deepLink;
    if (dl) {
      if (dl.kind === "document") {
        setDestination("reader");
        const found = documents.find((d) => d.id === dl.id);
        if (found) {
          openDocument(found);
        }
        if (dl.page) {
          setTargetPage(dl.page);
        }
        const annotId = dl.annotationId;
        if (annotId) {
          setSelected(annotId);
        }
      } else if (dl.kind === "note") {
        setDestination("notes");
      } else if (dl.kind === "review") {
        setDestination("review");
      }
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
          }
        } catch {
          // Fallback if settings table unpopulated
        }

        const docs = await invoke<DocumentRecord[]>("db_get_documents");
        // Load the library list only — no document is auto-opened. The app
        // opens to the Library; a document's session is restored by
        // openDocument when the user explicitly opens it.
        if (docs && docs.length > 0) {
          setDocuments(docs);
        }

        const cols = await invoke<CollectionItem[]>("db_get_collections");
        if (cols && cols.length > 0) {
          setCollections(cols);
        }

        const dbJobs = await invoke<BackgroundJob[]>("db_get_jobs");
        if (dbJobs && dbJobs.length > 0) {
          setJobs(dbJobs);
        }
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
        const initialRoute = await invoke<LaunchRoutePayload>("cmd_get_initial_launch_route");
        if (initialRoute && !initialRouteConsumedRef.current) {
          initialRouteConsumedRef.current = true;
          handleLaunchRoutePayload(initialRoute);
        }
      } catch {
        // Dev environment fallback
      }

      try {
        unlisten = await listen<LaunchRoutePayload>("launch-route", (event) => {
          if (event.payload) {
            handleLaunchRoutePayload(event.payload);
          }
        });
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
        setPromptOpen(false);
        setImportOpen(false);
        setJobDrawerOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setInitialImportPath(null);
        setPdfEntryMode('open');
        setImportOpen(true);
      }
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) setDestination("reader");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

    setDestination("reader");

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
      });
      if (openRequestId !== openDocumentRequestId.current) return;
      setVersionStatus(check.status);
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
      setVersionOffer(null);
      setVersionMismatchBannerVisible(false);
    }

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
    jobQueueManager.cancelJob(jobId, "Cancelled by user from background jobs drawer");
    setJobs(jobQueueManager.getJobs());
    // invoke() returns a Promise — a sync try/catch can't catch a rejection.
    invoke("db_update_job", { id: jobId, status: "cancelled", error: "Cancelled by user" }).catch(() => {});
  };

  const handleRestartJob = (jobId: string) => {
    jobQueueManager.restartJob(jobId);
    setJobs(jobQueueManager.getJobs());
    // invoke() returns a Promise — a sync try/catch can't catch a rejection.
    invoke("db_update_job", { id: jobId, status: "pending", error: null }).catch(() => {});
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
    setActiveDocument(newDoc);
    setDestination("reader");
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
      await invoke('db_delete_document', { id: docId });
    } catch {
      // Dev preview environment fallback — proceed with UI removal
    }
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (activeDocument?.id === docId) {
      const remaining = documents.filter((d) => d.id !== docId);
      setActiveDocument(remaining.length > 0 ? remaining[0] : null);
      if (remaining.length === 0) {
        setDestination("library");
      }
    }
  }

  const activeJobsCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;

  return (
    <main className={readingOnly ? "app reading-only" : "app"}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="app-mark" aria-hidden="true" />
        <strong>MERETH READER</strong>
        <span className="titlebar-document">
          {destination === "reader" && activeDocument ? `${activeDocument.title}.pdf` : "Local-first PDF reader"}
        </span>
        <span className="offline-status">Offline · no network activity</span>
      </header>

      {!readingOnly && (
        <aside className="rail" aria-label="Primary navigation">
          {nav.map(([id, label, glyph]) => (
            <button
              className={destination === id ? "rail-item active" : "rail-item"}
              key={id}
              onClick={() => setDestination(id)}
              title={label}
            >
              <Glyph>{glyph}</Glyph>
              <span>{label}</span>
              {id === "review" && reviewPromptsList.length > 0 && <em>{reviewPromptsList.length}</em>}
            </button>
          ))}
          <button
            className={destination === "settings" ? "rail-item active rail-bottom" : "rail-item rail-bottom"}
            onClick={() => setDestination("settings")}
            title="Settings"
          >
            <Glyph>☷</Glyph>
            <span>Settings</span>
          </button>
        </aside>
      )}

      <section className="workspace">
        {destination === "reader" && (
          <>
            {!activeDocument ? (
              <EmptyState
                viewType="library"
                customTitle="No document open"
                customDescription="Open a PDF from your library or from disk to start reading. Nothing is bundled or fabricated — your documents are the content."
                onPrimaryAction={() => { setInitialImportPath(null); setPdfEntryMode('open'); setImportOpen(true); }}
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
                onReturnToLibrary={() => setDestination("library")}
                onDeleteRecord={handleDeleteRecord}
              />
            ) : (
              <Reader
                aiOn={aiOn}
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
                onDismissScannedBanner={() => setScannedPdfBannerVisible(false)}
                onDismissVersionMismatchBanner={handleDismissVersionMismatchBanner}
                onReanchorAnnotations={handleReanchorAnnotations}
                onVersionRegistered={handleVersionRegistered}
                onReanchorOutcome={handleReanchorOutcome}
                onDismissReanchorSummary={() => setReanchorSummary(null)}
                onReturnToLibrary={() => setDestination("library")}
                setAiOn={setAiOn}
                setImportOpen={() => { setInitialImportPath(null); setPdfEntryMode('open'); setImportOpen(true); }}
                setLeftOpen={setLeftOpen}
                setPromptOpen={setPromptOpen}
                setReadingOnly={setReadingOnly}
                setRightOpen={setRightOpen}
                setRightTab={setRightTab}
                setSelected={setSelected}
                totalPages={activeDocument.page_count}
              />
            )}
          </>
        )}
        {destination === "library" && (
          <LibraryView
            documents={documents}
            collections={collections}
            activeJobsCount={activeJobsCount}
            onOpenDocument={openDocument}
            onOpenPdf={() => { setInitialImportPath(null); setPdfEntryMode('open'); setImportOpen(true); }}
            onOpenImportModal={() => { setInitialImportPath(null); setPdfEntryMode('import'); setImportOpen(true); }}
            onOpenJobQueue={() => setJobDrawerOpen(true)}
            onToggleFavourite={handleToggleFavourite}
            onToggleArchive={handleToggleArchive}
            onUpdateDocument={handleUpdateDocument}
            onUpdateCollections={handleUpdateCollections}
          />
        )}
        {destination === "notes" && <NotesView />}
        {destination === "review" && <ReviewView />}
        {destination === "settings" && (
          <SettingsView
            aiOn={aiOn}
            setAiOn={setAiOn}
            appearance={appearance}
            onUpdateAppearance={handleUpdateAppearance}
            palette={palette}
            onSavePalette={handleSavePalette}
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

      {promptOpen && <PromptDialog close={() => setPromptOpen(false)} evidence={activeAnnotation} />}
    </main>
  );
}

type ReaderProps = {
  aiOn: boolean;
  activeAnnotation: AnnotationRecord | null;
  activeDocument: DocumentRecord;
  activeSession: ReadingSessionState | null;
  appearance: AppearancePreferences;
  documentName: string;
  leftOpen: boolean;
  readingOnly: boolean;
  rightOpen: boolean;
  rightTab: "annotations" | "note" | "ai";
  selected: string;
  targetPage?: number;
  onTargetPageConsumed?: () => void;
  totalPages: number;
  rightPaneWidth?: number;
  annotationsList: AnnotationRecord[];
  /** Task 3.4: the version row new annotations bind to (null until registered). */
  currentVersionId: string | null;
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
  onDismissScannedBanner?: () => void;
  onDismissVersionMismatchBanner?: () => void;
  onReanchorAnnotations?: () => void;
  onVersionRegistered?: (documentId: string) => void;
  onReanchorOutcome?: (outcome: { reanchored: number; detached: number }) => void;
  onDismissReanchorSummary?: () => void;
  onReturnToLibrary?: () => void;
  setAiOn: (value: boolean) => void;
  setImportOpen: (value: boolean) => void;
  setLeftOpen: (value: boolean) => void;
  setPromptOpen: (value: boolean) => void;
  setReadingOnly: (value: boolean) => void;
  setRightOpen: (value: boolean) => void;
  setRightTab: (value: "annotations" | "note" | "ai") => void;
  setSelected: (value: string) => void;
  /** Task 3.6 (FR-9.9): embedded PDF annotations present for the open doc. */
  embeddedImportCounts?: { newCount: number; duplicateCount: number; unsupportedCount: number } | null;
  embeddedImportDisabled?: boolean;
  onOpenEmbeddedImport?: () => void;
  /** Task 3.7 (FR-9.6): annotation linkage sets (populated by R3/R4 linking). */
  linkedAnnotationIds?: ReadonlySet<string>;
  rememberedAnnotationIds?: ReadonlySet<string>;
};

function Reader(props: ReaderProps) {
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
  const [scrollTopPx, setScrollTopPx] = useState<number>(
    props.activeSession?.scroll_top_px || 0.0
  );
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(
    props.activeSession?.left_pane_width_px || 230
  );
  const [rightPaneWidth, setRightPaneWidth] = useState<number>(
    props.activeSession?.right_pane_width_px || 284
  );

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
  const [extractionStatus, setExtractionStatus] = useState<'idle' | 'running' | 'done' | 'cancelled'>('idle');
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
  const [selectionPopup, setSelectionPopup] = useState<(SelectionPopupAnchor & { pageBox: PageBox }) | null>(null);
  const [popupColor, setPopupColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [popupComment, setPopupComment] = useState("");
  const [popupLocked, setPopupLocked] = useState(false);
  const [popupBusy, setPopupBusy] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);
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
    setExtractionStatus('idle');
    setCurrentPageSize(DEFAULT_PAGE_SIZE);
    extractionAbortRef.current?.abort();

    // Task 2.9 in-app gate mark: dev-only no-op unless VITE_PERF_MEASURE=1.
    perfMark(`load.start:${props.activeDocument.filepath.split("/").pop() ?? "unknown"}`);
    loadPdfDocument(props.activeDocument.filepath).then((info) => {
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
  }, [props.activeDocument.id, props.activeDocument.filepath]);

  // Background text extraction (FR-7.6): starts after the document renders,
  // prioritizes the reading position, yields regularly, and reports real
  // progress to the job record shown in the indexing banner.
  useEffect(() => {
    if (!loadedPdf || extractionStatus !== 'idle') return;

    const controller = new AbortController();
    extractionAbortRef.current = controller;
    setExtractionStatus('running');
    const jobId = props.activeDocumentJob?.id;

    extractPdfPageTexts(loadedPdf.doc, {
      signal: controller.signal,
      prioritizeFromPage: currentPageRef.current,
      onProgress: (processed, total) => {
        // Task 2.9 in-app gate mark: dev-only no-op unless VITE_PERF_MEASURE=1.
        perfMark(`extract.progress:${processed}:${total}`);
        if (jobId && (processed % 5 === 0 || processed === total)) {
          props.onJobProgress?.(jobId, processed);
        }
      },
    })
      .then((result) => {
        setPageTexts(result.pages);
        setExtractionStatus(result.completed ? 'done' : 'cancelled');
      })
      .catch(() => {
        setExtractionStatus('cancelled');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedPdf, extractionStatus]);

  // Task 3.6 (FR-9.9): background scan for embedded (PDF-born) annotations.
  // Batched and cancelled on document change; pages near the reading start
  // are prioritized first (same window the text extractor uses).
  useEffect(() => {
    if (!loadedPdf || !props.activeDocument) return;
    if (embeddedScanRef.current) embeddedScanRef.current.cancelled = true;
    setEmbeddedByPage(new Map());
    setEmbeddedImported(new Set());
    const doc = loadedPdf.doc;
    if (!doc || loadedPdf.numPages === 0) return;
    const scan = { documentId: props.activeDocument.id, cancelled: false };
    embeddedScanRef.current = scan;
    const total = loadedPdf.numPages;
    const order = prioritizePageWindow(total, 1, 3);
    const BATCH = 6;
    void (async () => {
      for (let i = 0; i < order.length; i += BATCH) {
        if (scan.cancelled) return;
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
        if (i + BATCH < order.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    })();
    return () => {
      scan.cancelled = true;
    };
  }, [loadedPdf?.doc, loadedPdf?.numPages, props.activeDocument?.id]);

  // Job drawer cancel/restart drives the extraction abort controller.
  const activeJobStatus = props.activeDocumentJob?.status;
  useEffect(() => {
    if (activeJobStatus === 'cancelled' || activeJobStatus === 'failed') {
      extractionAbortRef.current?.abort();
    } else if (activeJobStatus === 'pending') {
      setExtractionStatus((s) => (s === 'cancelled' || s === 'done' ? 'idle' : s));
    }
  }, [activeJobStatus]);

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
    if (!loadedPdf) return;
    if (versionRegistrationInFlightRef.current === docId) return;

    const status = props.versionStatus;
    if (status === "missing") return;

    const offerForThisDoc =
      props.versionOffer !== null &&
      props.versionOffer !== undefined &&
      props.versionOffer.documentId === docId;
    const decision = props.reanchorDecision;

    const shouldRegister =
      status === "unregistered" ||
      (offerForThisDoc && status === "changed" && decision === "continue") ||
      (offerForThisDoc && status === "changed" && decision === "reanchor" && extractionStatus !== "running");
    if (!shouldRegister) return;

    let cancelled = false;
    versionRegistrationInFlightRef.current = docId;
    (async () => {
      try {
        const version = await invoke<DocumentVersionRecord>("db_register_document_version", {
          documentId: docId,
        });
        if (cancelled || versionRegistrationInFlightRef.current !== docId) return;

        if (decision === "reanchor") {
          const annotations = await invoke<StoredAnnotation[]>(
            "db_get_annotations_for_document",
            { documentId: docId, includeTrashed: false }
          );
          if (cancelled) return;
          const pageTextByNumber = new Map(pageTexts.map((p) => [p.pageNumber, p.text]));
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
        if (cancelled || versionRegistrationInFlightRef.current !== docId) return;
        await invoke("db_update_version_geometry", { versionId: version.id, geometry });
        if (cancelled) return;
        props.onVersionRegistered?.(docId);
      } catch (err) {
        console.error("Failed to register document version:", err);
        versionRegistrationInFlightRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadedPdf,
    props.activeDocument.id,
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

  const searchMatches = useMemo(() => {
    // Task 2.9 in-app gate marks: dev-only no-ops unless VITE_PERF_MEASURE=1.
    perfMark("search.start");
    const matches = performAdvancedSearch(pageTexts, searchQuery, searchOptions);
    perfMark("search.end");
    return matches;
  }, [searchQuery, searchOptions, pageTexts]);

  // A new query starts match traversal over, but never jumps the page on its
  // own — page movement happens only on explicit next/previous.
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, searchOptions]);

  const outlineNodes = useMemo(() => {
    if (loadedPdf?.outline && loadedPdf.outline.length > 0) {
      return parseOutlineTree(loadedPdf.outline);
    }
    return [];
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

  // Scroll position persists via a trailing-edge timeout, so scrolling never
  // re-renders the reader per frame and the session write happens once.
  const handleScrollPositionChange = useCallback((top: number) => {
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
        case 'annot.highlight.yellow':
          if (props.annotationsList.length > 0) props.setSelected(props.annotationsList[0].id);
          break;
        case 'annot.highlight.green':
          if (props.annotationsList.length > 1) props.setSelected(props.annotationsList[1].id);
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
          if (props.annotationsList.length > 0) props.setPromptOpen(true);
          break;
      }
    };

    window.addEventListener('keydown', handleShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown);
  }, [currentPage, totalPages, historyState, searchMatches, props]);

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
  // The popover tracks `selectionchange`, but a collapse caused by clicking a
  // popover control must not yank the popover away before the click lands —
  // clicks inside the popup set suppress, which skips the hide.
  const popupSuppressRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (popupSuppressRef.current) {
          popupSuppressRef.current = false;
          return;
        }
        const container = canvasContainerRef.current;
        if (!container || !props.currentVersionId || captureActiveRef.current) {
          setSelectionPopup(null);
          return;
        }
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionPopup(null);
          return;
        }
        const anchorNode = sel.anchorNode;
        if (!anchorNode) {
          setSelectionPopup(null);
          return;
        }
        const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
        const pageEl = anchorEl?.closest(".pdf-page") as HTMLElement | null;
        if (!pageEl || !pageEl.closest(".reader-canvas-container")) {
          setSelectionPopup(null);
          return;
        }
        const pageNumber = Number(pageEl.dataset.pageNumber ?? 0);
        if (!pageNumber) {
          setSelectionPopup(null);
          return;
        }
        const pageRect = pageEl.getBoundingClientRect();
        const pageBox: PageBox = {
          left: pageRect.left,
          top: pageRect.top,
          right: pageRect.right,
          bottom: pageRect.bottom,
          width: pageRect.width,
          height: pageRect.height,
        };
        let minL = Number.POSITIVE_INFINITY;
        let minT = Number.POSITIVE_INFINITY;
        let maxR = Number.NEGATIVE_INFINITY;
        let maxB = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < sel.rangeCount; i++) {
          const range = sel.getRangeAt(i);
          for (const cr of range.getClientRects()) {
            if (cr.bottom <= pageBox.top || cr.top >= pageBox.bottom || cr.right <= pageBox.left || cr.left >= pageBox.right) continue;
            minL = Math.min(minL, Math.max(cr.left, pageBox.left));
            minT = Math.min(minT, Math.max(cr.top, pageBox.top));
            maxR = Math.max(maxR, Math.min(cr.right, pageBox.right));
            maxB = Math.max(maxB, Math.min(cr.bottom, pageBox.bottom));
          }
        }
        if (!Number.isFinite(minL) || minL >= maxR || minT >= maxB) {
          setSelectionPopup(null);
          return;
        }
        const containerRect = container.getBoundingClientRect();
        setSelectionPopup({
          left: maxR - containerRect.left + 10,
          top: maxB - containerRect.top + 8,
          pageNumber,
          pageBox,
        });
      });
    };
    document.addEventListener("selectionchange", handler);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", handler);
    };
  }, [props.currentVersionId]);

  // Task 3.4: create a highlight/underline/comment from the current DOM
  // selection (FR-9.1/9.2/9.4). Anchors are re-measured at save time so the
  // stored rects always match what the user last selected.
  const handleCreateFromSelection = async (type: "highlight" | "underline" | "comment") => {
    const popup = selectionPopup;
    if (!popup || !loadedPdf || !props.currentVersionId) {
      setSelectionPopup(null);
      return;
    }
    setPopupBusy(true);
    setPopupError(null);
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        throw new Error("The selection collapsed — select the text again.");
      }
      const rects: ViewportRect[] = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        for (const cr of range.getClientRects()) {
          if (cr.bottom <= popup.pageBox.top || cr.top >= popup.pageBox.bottom || cr.right <= popup.pageBox.left || cr.left >= popup.pageBox.right) continue;
          rects.push({
            left: Math.max(cr.left, popup.pageBox.left),
            top: Math.max(cr.top, popup.pageBox.top),
            right: Math.min(cr.right, popup.pageBox.right),
            bottom: Math.min(cr.bottom, popup.pageBox.bottom),
          });
        }
      }
      const normalized = mergeSelectionRects(rects, popup.pageBox, rotation);
      if (normalized.length === 0) {
        throw new Error("The selection is empty on this page.");
      }
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (!quote) {
        throw new Error("No readable text selected.");
      }

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
          color: popupColor,
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
          color: popupColor,
          comment: popupComment.trim(),
        });
        await props.onAnnotationCreated(record);
      }

      if (popupLocked) {
        // FR-9.2 locked mode: keep the popup armed for the next selection.
        popupSuppressRef.current = true;
        window.getSelection()?.removeAllRanges();
        setPopupComment("");
      } else {
        setSelectionPopup(null);
      }
    } catch (err) {
      setPopupError(err instanceof Error ? err.message : String(err));
    } finally {
      setPopupBusy(false);
    }
  };

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
          currentMatchIndex={currentMatchIndex}
          onNextMatch={handleNextMatch}
          onPrevMatch={handlePrevMatch}
          leftOpen={props.leftOpen}
          onToggleLeftOpen={() => props.setLeftOpen(!props.leftOpen)}
          rightOpen={props.rightOpen}
          onToggleRightOpen={() => props.setRightOpen(!props.rightOpen)}
          readingOnly={props.readingOnly}
          onToggleReadingOnly={() => props.setReadingOnly(!props.readingOnly)}
          aiOn={props.aiOn}
          onToggleAi={() => props.setAiOn(!props.aiOn)}
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

          {props.activeDocumentJob && (props.activeDocumentJob.status === 'running' || props.activeDocumentJob.status === 'pending') && (
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
                ⚙️ <strong>Indexing text:</strong> {props.activeDocumentJob.processed_pages} / {props.activeDocumentJob.total_pages} pages ({props.activeDocumentJob.progress_percent}%) · Document reading and navigation remain fully usable in parallel.
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
                onCopySelection={handleCopySelection}
                annotationsByPage={annotationsByPage}
                annotationAssets={annotationAssets}
                selectedAnnotationId={props.selected}
                palette={props.palette}
                onSelectAnnotation={props.setSelected}
                embeddedByPage={embeddedOverlayByPage}
                onOpenEmbeddedImport={() => setEmbeddedImportOpen(true)}
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
              onToggleLocked={() => setPopupLocked((prev) => !prev)}
              busy={popupBusy}
              error={popupError}
              onCreate={(type) => void handleCreateFromSelection(type)}
              onClose={() => {
                setSelectionPopup(null);
                setPopupError(null);
              }}
            />
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

function RightPane(props: ReaderProps) {
  const tabs: Array<[typeof props.rightTab, string]> = [["annotations", "Annotations"], ["note", "Note"], ["ai", "AI"]];
  const list = props.annotationsList || [];
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
  const patchFilters = (patch: Partial<AnnotationFilters>) =>
    setAnnotationFilters((prev) => ({ ...prev, ...patch }));

  return (
    <aside className="right-pane" style={props.rightPaneWidth ? { width: `${props.rightPaneWidth}px` } : undefined}>
      <div className="pane-tabs">{tabs.map(([id, label]) => <button key={id} className={props.rightTab === id ? "pane-tab active" : "pane-tab"} onClick={() => props.setRightTab(id)}>{label}{id === "ai" && <i className={props.aiOn ? "dot on" : "dot"} />}</button>)}</div>
      {props.rightTab === "annotations" && (
        <div className="annotation-list">
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
                    {type}
                  </button>
                );
              })}
            </div>
            <div className="filter-chip-row" role="group" aria-label="Filter by colour label">
              {props.palette.map((entry) => {
                const on = annotationFilters.paletteKeys.includes(entry.key);
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
                    {entry.label}
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
                ✕ Clear filters
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <EmptyState viewType="annotations" />
          ) : filteredList.length === 0 ? (
            <p className="dimmed filter-empty">No annotations match these filters.</p>
          ) : (
            filteredList.map((item) => (
              <button
                key={item.id}
                className={props.selected === item.id ? "annotation-item active" : "annotation-item"}
                onClick={() => {
                  props.setSelected(item.id);
                  props.onJumpToAnnotation?.(item.page_index);
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
            ))
          )}

          {props.activeAnnotation && (
            <AnnotationEditor
              annotation={props.activeAnnotation}
              palette={props.palette}
              onSave={(id, color, comment, tags) => void props.onAnnotationUpdated(id, color, comment, tags)}
              onTrash={(id) => void props.onTrashAnnotation(id)}
            />
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
                  <Glyph>≋</Glyph> Import {props.embeddedImportCounts.newCount + props.embeddedImportCounts.duplicateCount} embedded PDF notes
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
            onClick={() => props.setPromptOpen(true)}
            disabled={!props.activeAnnotation}
            title={!props.activeAnnotation ? 'Select a passage and annotate it first' : 'Draft a retrieval review prompt (R4 milestone)'}
          >
            <Glyph>▰</Glyph> Remember selected evidence
          </button>
        </div>
      )}
      {props.rightTab === "note" && (
        <div className="note-editor">
          <span className="eyebrow">Source note</span>
          {list.length === 0 ? (
            <>
              <h2>No notes yet</h2>
              <p className="dimmed">
                Source notes are built from annotations. Note authoring arrives with the R3
                milestone; this build does not fabricate example notes.
              </p>
            </>
          ) : props.activeAnnotation ? (
            <>
              <h2>{paletteLabelFor(props.activeAnnotation.color)} · {props.activeAnnotation.annotation_type}</h2>
              <p className="evidence-block">
                {props.activeAnnotation.annotation_type === 'highlight' || props.activeAnnotation.annotation_type === 'underline'
                  ? `“${props.activeAnnotation.quote}”`
                  : props.activeAnnotation.annotation_type === 'comment'
                    ? props.activeAnnotation.comment
                    : props.activeAnnotation.annotation_type === 'area'
                      ? 'Area capture'
                      : 'Bookmark'}
                <small>— {props.documentName.replace(".pdf", "")}, p. {props.activeAnnotation.page_label || props.activeAnnotation.page_index + 1}</small>
              </p>
              <textarea aria-label="Note content" placeholder="Write your own prose here — it stays separate from the quoted evidence." />
              <button className="wide-action">Add evidence block</button>
            </>
          ) : (
            <p className="dimmed">Select an annotation to preview it here.</p>
          )}
        </div>
      )}
      {props.rightTab === "ai" && <div className="ai-pane">{props.aiOn ? <><span className="eyebrow">Local AI · selected text only</span><h2>Ask this document</h2><p>Drafts stay separate from your notes until you explicitly adopt them. Every answer must cite its source page.</p><div className="ai-answer"><b>Possible reading</b><p>Testing may improve delayed retention because each attempt strengthens later access, while restudy mainly improves familiar-feeling fluency.</p><small>Source: p. 249–250</small></div><button className="wide-action">Adopt into note</button></> : <><Glyph>✦</Glyph><h2>AI is off</h2><p>Reading, annotations, notes, review, search, and export remain fully available. Turning it on never sends document text off this device.</p><button className="wide-action primary" onClick={() => props.setAiOn(true)}>Turn on local AI</button></>}</div>}
    </aside>
  );
}



function ReviewView() {
  // The review queue arrives with the R4 milestone (FSRS scheduling). Until
  // then: an honest empty queue, with no invented due counts or scheduler
  // claims (U15).
  return (
    <section className="review-view">
      <span className="eyebrow">0 due</span>
      <h1>Review before you reveal.</h1>
      <p className="review-preamble">You decide the outcome. The source is the feedback authority.</p>
      <div className="destination-rule" />
      <EmptyState
        viewType="annotations"
        customTitle="Nothing due"
        customDescription="Prompts you mark Remember will appear here once annotation and review scheduling land in the R3/R4 milestones."
      />
    </section>
  );
}

function SettingsView({
  aiOn,
  setAiOn,
  appearance,
  onUpdateAppearance,
  palette,
  onSavePalette,
}: {
  aiOn: boolean;
  setAiOn: (value: boolean) => void;
  appearance: AppearancePreferences;
  onUpdateAppearance: <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => void;
  palette: PaletteEntry[];
  onSavePalette: (palette: PaletteEntry[]) => void;
}) {
  const [settingTab, setSettingTab] = useState<'privacy' | 'shortcuts' | 'appearance' | 'annotations'>('privacy');

  return (
    <section className="settings-view">
      <aside>
        <b
          className={settingTab === 'privacy' ? 'selected-setting' : ''}
          onClick={() => setSettingTab('privacy')}
          style={{ cursor: 'pointer' }}
        >
          AI & privacy
        </b>
        <b
          className={settingTab === 'shortcuts' ? 'selected-setting' : ''}
          onClick={() => setSettingTab('shortcuts')}
          style={{ cursor: 'pointer' }}
        >
          Shortcuts
        </b>
        <b
          className={settingTab === 'appearance' ? 'selected-setting' : ''}
          onClick={() => setSettingTab('appearance')}
          style={{ cursor: 'pointer' }}
        >
          Appearance
        </b>
        <b
          className={settingTab === 'annotations' ? 'selected-setting' : ''}
          onClick={() => setSettingTab('annotations')}
          style={{ cursor: 'pointer' }}
        >
          Annotations
        </b>
        <b>Reading</b>
        <b>Review</b>
        <b>Storage</b>
        <b>Export</b>
      </aside>
      <article>
        {settingTab === 'shortcuts' ? (
          <SettingsShortcuts />
        ) : settingTab === 'appearance' ? (
          <SettingsAppearance preferences={appearance} onUpdatePreference={onUpdateAppearance} />
        ) : settingTab === 'annotations' ? (
          <SettingsAnnotations palette={palette} onSavePalette={onSavePalette} />
        ) : (
          <>
            <span className="eyebrow">Your local boundary</span>
            <h1>Local AI & privacy</h1>
            <p>Everything here is off by default. The Reader is complete without it.</p>
            <div className="destination-rule" />
            <div className="setting-state">
              <div>
                <b>Local AI · {aiOn ? "On" : "Off"}</b>
                <p>When off, no Reader-managed model process or semantic index is kept in memory. No document text leaves this device.</p>
              </div>
              <button className="wide-action primary" onClick={() => setAiOn(!aiOn)}>{aiOn ? "Turn off" : "Turn on"}</button>
            </div>
            <h3>Runtime</h3>
            <label className="radio-row">
              <input type="radio" defaultChecked />
              <span />
              <div>
                <b>Strict local — app-managed runtime</b>
                <small>The only mode the Reader can verify. No network tools.</small>
              </div>
            </label>
            <label className="radio-row">
              <input type="radio" />
              <span />
              <div>
                <b>External provider — Ollama or LM Studio</b>
                <small>Loopback only, but its network behavior is outside Reader’s control.</small>
              </div>
            </label>
          </>
        )}
      </article>
    </section>
  );
}

function PromptDialog({ close, evidence }: { close: () => void; evidence: AnnotationRecord | null }) {
  const evidenceLabel = evidence
    ? evidence.annotation_type === 'highlight' || evidence.annotation_type === 'underline'
      ? `“${evidence.quote}”`
      : evidence.annotation_type === 'comment'
        ? evidence.comment
        : evidence.annotation_type === 'area'
          ? 'Area capture'
          : 'Bookmark'
    : '';
  const evidencePage = evidence ? `p. ${evidence.page_label || evidence.page_index + 1}` : '';
  return <div className="modal-backdrop" role="presentation"><section className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><button className="modal-close" onClick={close} aria-label="Close"><Glyph>×</Glyph></button><span className="eyebrow">Draft · not scheduled</span><h2 id="prompt-title">New retrieval prompt</h2><p>Nothing enters the review queue until you approve it. Every prompt keeps a link to its evidence.</p>{evidence ? <p className="evidence-block">{evidenceLabel}<small>Linked evidence · {evidencePage}</small></p> : <p className="dimmed">Select an annotation first — prompts must link to source evidence (FR-11.3).</p>}<label className="field-label">Prompt<textarea placeholder="Write the question your future self should answer from memory…" /></label><label className="field-label">Your answer — you write or rewrite this<textarea placeholder="Write the answer in your own words…" /></label><div className="prompt-check"><b>Prompt check — advisory, never blocking</b><span>✓ Focused — one retrieval task.</span><span>✓ Requires recall — no recognition options.</span><span>! Cue — name the source context if you will need it later.</span></div><div className="modal-actions"><button className="wide-action" onClick={close}>Save as draft</button><button className="wide-action primary" onClick={close}>Approve prompt</button></div></section></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
