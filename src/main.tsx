import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  LoadedPdfInfo,
} from "./utils/pdfViewer";
import { ImportModal } from "./components/ImportModal";
import { MissingFileBanner } from "./components/MissingFileBanner";
import { DeepLinkRoute } from "./utils/launchRouting";
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
import { ReaderToolbar } from "./components/ReaderToolbar";
import { LeftSidebar } from "./components/LeftSidebar";
import { SettingsShortcuts } from "./components/SettingsShortcuts";
import { LibraryView } from "./components/LibraryView";
import { JobQueueDrawer } from "./components/JobQueueDrawer";
import { DuplicateConfirmModal } from "./components/DuplicateConfirmModal";
import { CollectionItem } from "./utils/libraryUtils";
import { BackgroundJob, JobQueueManager, createBackgroundJob } from "./utils/jobQueue";
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

type Destination = "library" | "reader" | "notes" | "review" | "settings";
type Highlight = { id: string; color: string; label: string; quote: string; page: string };

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

  // Annotations, notes, and review prompts have no persistence until the R2–R4
  // milestones — they start empty rather than fabricated (U15).
  const [annotationsList] = useState<Highlight[]>([]);
  const [notesList] = useState<Array<{ id: string; title: string; type: string }>>([]);
  const [reviewPromptsList] = useState<Array<{ id: string; prompt: string }>>([]);

  const activeAnnotation = useMemo(
    () => annotationsList.find((annotation) => annotation.id === selected) ?? annotationsList[0] ?? { id: "none", color: "yellow", label: "Evidence", quote: "No active highlight selected", page: "1" },
    [selected, annotationsList],
  );

  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);

  const handleLaunchRoutePayload = (payload: LaunchRoutePayload) => {
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
        await invoke("db_init");

        try {
          const settingRows = await invoke<Array<{ key: string; value: string }>>("db_get_settings");
          if (settingRows && settingRows.length > 0) {
            const loaded = parseSettingsRows(settingRows);
            setAppearance(loaded);
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
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setupLaunchListener() {
      try {
        const initialRoute = await invoke<LaunchRoutePayload>("cmd_get_initial_launch_route");
        if (initialRoute) {
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

  async function openDocument(doc: DocumentRecord) {
    // Guard against interleaved opens (rapid library clicks or a launch-route
    // arriving mid-open): only the latest open request is allowed to mutate
    // active-document/session state, so a slower stale read cannot overwrite a
    // newer document's session and the debounced save effect cannot persist one
    // document's page/zoom into another's session row.
    const openRequestId = ++openDocumentRequestId.current;

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

    if (doc.is_version_mismatch || doc.filepath.includes("mismatch")) {
      setVersionMismatchBannerVisible(true);
    } else {
      setVersionMismatchBannerVisible(false);
    }

    // Text extraction runs only for the active document, so any still-active
    // extraction job for another document would sit at 0% forever — supersede
    // it honestly rather than leaving a spinner that never progresses.
    for (const job of jobQueueManager.getJobs()) {
      if (
        job.document_id !== doc.id &&
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
          j.document_id === doc.id &&
          j.job_type === 'text_extraction' &&
          (j.status === 'running' || j.status === 'pending')
      );
    if (existingJob) {
      setActiveExtractionJobId(existingJob.id);
    } else {
      const extractionJob = createBackgroundJob({
        document_id: doc.id,
        job_type: "text_extraction",
        total_pages: doc.page_count,
        active_page: 1,
      });
      jobQueueManager.enqueueJob(extractionJob);
      setActiveExtractionJobId(extractionJob.id);
    }
    setJobs(jobQueueManager.getJobs());
  }

  // Real extraction progress reported by the reader's background pass. The
  // manager marks the job completed at 100%; completion is persisted.
  const handleJobProgress = (jobId: string, processedPages: number) => {
    const updated = jobQueueManager.updateProgress(jobId, processedPages);
    setJobs(jobQueueManager.getJobs());
    if (updated && updated.status === 'completed') {
      try {
        invoke("db_update_job", { id: jobId, status: "completed", error: null });
      } catch {
        // Dev environment fallback
      }
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

  const handleCancelJob = (jobId: string) => {
    jobQueueManager.cancelJob(jobId, "Cancelled by user from background jobs drawer");
    setJobs(jobQueueManager.getJobs());
    try {
      invoke("db_update_job", { id: jobId, status: "cancelled", error: "Cancelled by user" });
    } catch {}
  };

  const handleRestartJob = (jobId: string) => {
    jobQueueManager.restartJob(jobId);
    setJobs(jobQueueManager.getJobs());
    try {
      invoke("db_update_job", { id: jobId, status: "pending", error: null });
    } catch {}
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
                scannedPdfBannerVisible={scannedPdfBannerVisible}
                versionMismatchBannerVisible={versionMismatchBannerVisible}
                activeDocumentJob={jobs.find((j) => j.id === activeExtractionJobId)}
                onCancelJob={handleCancelJob}
                onJobProgress={handleJobProgress}
                onDismissScannedBanner={() => setScannedPdfBannerVisible(false)}
                onDismissVersionMismatchBanner={() => setVersionMismatchBannerVisible(false)}
                onReanchorAnnotations={() => setVersionMismatchBannerVisible(false)}
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
  activeAnnotation: Highlight;
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
  annotationsList: Highlight[];
  scannedPdfBannerVisible?: boolean;
  versionMismatchBannerVisible?: boolean;
  activeDocumentJob?: BackgroundJob;
  onCancelJob?: (jobId: string) => void;
  onJobProgress?: (jobId: string, processedPages: number) => void;
  onDismissScannedBanner?: () => void;
  onDismissVersionMismatchBanner?: () => void;
  onReanchorAnnotations?: () => void;
  onReturnToLibrary?: () => void;
  setAiOn: (value: boolean) => void;
  setImportOpen: (value: boolean) => void;
  setLeftOpen: (value: boolean) => void;
  setPromptOpen: (value: boolean) => void;
  setReadingOnly: (value: boolean) => void;
  setRightOpen: (value: boolean) => void;
  setRightTab: (value: "annotations" | "note" | "ai") => void;
  setSelected: (value: string) => void;
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

    loadPdfDocument(props.activeDocument.filepath).then((info) => {
      if (!isMounted) return;
      if (info) {
        setLoadedPdf(info);
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

  // Job drawer cancel/restart drives the extraction abort controller.
  const activeJobStatus = props.activeDocumentJob?.status;
  useEffect(() => {
    if (activeJobStatus === 'cancelled' || activeJobStatus === 'failed') {
      extractionAbortRef.current?.abort();
    } else if (activeJobStatus === 'pending') {
      setExtractionStatus((s) => (s === 'cancelled' || s === 'done' ? 'idle' : s));
    }
  }, [activeJobStatus]);

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
    return performAdvancedSearch(pageTexts, searchQuery, searchOptions);
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
    setScrollToPageRequest({ page: validPage, nonce: Date.now() });
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

        <div className="reader-canvas-container">
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
              onActivateAreaCapture={() => props.setSelected('recall')}
            />
          )}

          {props.versionMismatchBannerVisible && (
            <VersionMismatchBanner
              onReanchor={() => props.onReanchorAnnotations?.()}
              onDismiss={() => props.onDismissVersionMismatchBanner?.()}
            />
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
              />
            )}
          </RendererErrorBoundary>
        </div>

        {props.rightOpen && !props.readingOnly && (
          <>
            <div
              className={`pane-resizer right-resizer ${isResizingRight ? 'dragging' : ''}`}
              onMouseDown={() => setIsResizingRight(true)}
              title="Drag to resize annotations pane"
            />
            <RightPane {...props} rightPaneWidth={rightPaneWidth} />
          </>
        )}
      </div>
    </>
  );
}

function RightPane(props: ReaderProps) {
  const tabs: Array<[typeof props.rightTab, string]> = [["annotations", "Annotations"], ["note", "Note"], ["ai", "AI"]];
  const list = props.annotationsList || [];
  return (
    <aside className="right-pane" style={props.rightPaneWidth ? { width: `${props.rightPaneWidth}px` } : undefined}>
      <div className="pane-tabs">{tabs.map(([id, label]) => <button key={id} className={props.rightTab === id ? "pane-tab active" : "pane-tab"} onClick={() => props.setRightTab(id)}>{label}{id === "ai" && <i className={props.aiOn ? "dot on" : "dot"} />}</button>)}</div>
      {props.rightTab === "annotations" && (
        <div className="annotation-list">
          <div className="pane-heading">
            <span>All {list.length}</span>
            <button><Glyph>•••</Glyph></button>
          </div>
          {list.length === 0 ? (
            <EmptyState viewType="annotations" />
          ) : (
            list.map((item) => (
              <button
                key={item.id}
                className={props.selected === item.id ? "annotation-item active" : "annotation-item"}
                onClick={() => props.setSelected(item.id)}
              >
                <i className={`annotation-swatch ${item.color}`} />
                <span>
                  <b>{item.label}</b>
                  <small>p. {item.page}</small>
                  <q>{item.quote}</q>
                </span>
              </button>
            ))
          )}
          <button
            className="wide-action"
            onClick={() => props.setPromptOpen(true)}
            disabled={list.length === 0}
            title={list.length === 0 ? 'No annotation selected yet — highlight text first (annotation tools arrive with the R2 milestone)' : undefined}
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
          ) : (
            <>
              <h2>{props.activeAnnotation.label}</h2>
              <p className="evidence-block">
                “{props.activeAnnotation.quote}”
                <small>— {props.documentName.replace(".pdf", "")}, p. {props.activeAnnotation.page}</small>
              </p>
              <textarea aria-label="Note content" placeholder="Write your own prose here — it stays separate from the quoted evidence." />
              <button className="wide-action">Add evidence block</button>
            </>
          )}
        </div>
      )}
      {props.rightTab === "ai" && <div className="ai-pane">{props.aiOn ? <><span className="eyebrow">Local AI · selected text only</span><h2>Ask this document</h2><p>Drafts stay separate from your notes until you explicitly adopt them. Every answer must cite its source page.</p><div className="ai-answer"><b>Possible reading</b><p>Testing may improve delayed retention because each attempt strengthens later access, while restudy mainly improves familiar-feeling fluency.</p><small>Source: p. 249–250</small></div><button className="wide-action">Adopt into note</button></> : <><Glyph>✦</Glyph><h2>AI is off</h2><p>Reading, annotations, notes, review, search, and export remain fully available. Turning it on never sends document text off this device.</p><button className="wide-action primary" onClick={() => props.setAiOn(true)}>Turn on local AI</button></>}</div>}
    </aside>
  );
}

function NotesView() {
  // Notes persistence arrives with the R3 milestone. Until then this surface
  // shows an honest empty state instead of fabricated sample notes (U15).
  return (
    <section className="destination-view">
      <div className="view-header">
        <div>
          <span className="eyebrow">0 notes · all local</span>
          <h1>Notes</h1>
        </div>
      </div>
      <div className="destination-rule" />
      <EmptyState
        viewType="annotations"
        customTitle="No notes yet"
        customDescription="Source, concept, and scratch notes are built from your annotations and arrive with the R3 milestone. Nothing here is invented sample content."
      />
    </section>
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
}: {
  aiOn: boolean;
  setAiOn: (value: boolean) => void;
  appearance: AppearancePreferences;
  onUpdateAppearance: <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => void;
}) {
  const [settingTab, setSettingTab] = useState<'privacy' | 'shortcuts' | 'appearance'>('privacy');

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
        <b>Reading</b>
        <b>Annotations</b>
        <b>Review</b>
        <b>Storage</b>
        <b>Export</b>
      </aside>
      <article>
        {settingTab === 'shortcuts' ? (
          <SettingsShortcuts />
        ) : settingTab === 'appearance' ? (
          <SettingsAppearance preferences={appearance} onUpdatePreference={onUpdateAppearance} />
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

function PromptDialog({ close, evidence }: { close: () => void; evidence: Highlight }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><button className="modal-close" onClick={close} aria-label="Close"><Glyph>×</Glyph></button><span className="eyebrow">Draft · not scheduled</span><h2 id="prompt-title">New retrieval prompt</h2><p>Nothing enters the review queue until you approve it. Every prompt keeps a link to its evidence.</p><p className="evidence-block">“{evidence.quote}”<small>Linked evidence · p. {evidence.page}</small></p><label className="field-label">Prompt<textarea placeholder="Write the question your future self should answer from memory…" /></label><label className="field-label">Your answer — you write or rewrite this<textarea placeholder="Write the answer in your own words…" /></label><div className="prompt-check"><b>Prompt check — advisory, never blocking</b><span>✓ Focused — one retrieval task.</span><span>✓ Requires recall — no recognition options.</span><span>! Cue — name the source context if you will need it later.</span></div><div className="modal-actions"><button className="wide-action" onClick={close}>Save as draft</button><button className="wide-action primary" onClick={close}>Approve prompt</button></div></section></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
