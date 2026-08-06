import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
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
  PDFTextItem,
  PageTextContent,
  OutlineItem,
} from "./utils/pdfUtils";
import { DocumentRecord, createDocumentRecord } from "./utils/pdfImport";
import { ImportModal } from "./components/ImportModal";
import { MissingFileBanner } from "./components/MissingFileBanner";
import { DeepLinkRoute } from "./utils/launchRouting";
import { LayoutMode, RotationAngle, calculateZoom, rotateView } from "./utils/viewModeUtils";
import { SearchOptions, performAdvancedSearch, getNextMatchIndex, DEFAULT_SEARCH_OPTIONS } from "./utils/searchUtils";
import { parseOutlineTree, formatExtendedPageLabel } from "./utils/navigationUtils";
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
import { validatePdfPassword, detectScannedPdf } from "./utils/recoveryUtils";

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

const annotations: Highlight[] = [
  {
    id: "testing",
    color: "yellow",
    label: "Evidence",
    quote: "Repeated testing produced substantially better performance after a delay of one week.",
    page: "249",
  },
  {
    id: "recall",
    color: "green",
    label: "Claim",
    quote: "Testing three times recalled 61% of idea units one week later, compared with 40% after repeated study.",
    page: "249",
  },
  {
    id: "route",
    color: "blue",
    label: "Mechanism",
    quote: "The effect follows from strengthening the retrieval route rather than enriching the representation.",
    page: "250",
  },
];

const sampleRawOutline: OutlineItem[] = [
  {
    title: "Abstract",
    dest: "1",
  },
  {
    title: "Introduction",
    dest: "2",
    items: [
      { title: "Testing as Assessment", dest: "2" },
      { title: "Retrieval Practice", dest: "3" },
    ],
  },
  {
    title: "Experiment 1",
    dest: "4",
    items: [
      { title: "Method", dest: "4" },
      { title: "Results & Discussion", dest: "6" },
    ],
  },
  {
    title: "Experiment 2",
    dest: "8",
  },
  {
    title: "General Discussion",
    dest: "10",
  },
  {
    title: "References",
    dest: "12",
  },
];

const samplePageTexts: PageTextContent[] = [
  { pageNumber: 1, text: "Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention. Henry L. Roediger III and Jeffrey D. Karpicke." },
  { pageNumber: 2, text: "Abstract— Taking a test on studied material is commonly treated as a neutral measurement of what a learner already knows. Two experiments examined whether the act of retrieval itself changes later retention." },
  { pageNumber: 3, text: "Students read short prose passages and then either restudied the passage or took a free-recall test. Repeated studying produced better performance on an immediate test." },
  { pageNumber: 4, text: "In Experiment 1, participants who studied a passage once and were then tested three times recalled 61% of idea units one week later, compared with 40% after repeated study." },
  { pageNumber: 5, text: "This dissociation between immediate and delayed performance matters for how learners regulate their own study. Fluency during study was read as evidence of durability." },
  { pageNumber: 6, text: "We interpret the effect as a consequence of the retrieval route being strengthened rather than the representation being enriched." },
  { pageNumber: 7, text: "On this account, the difficulty of the retrieval attempt is not incidental; it is the mechanism." },
  { pageNumber: 8, text: "Experiment 2 replicated the pattern with a different set of passages and added a feedback manipulation." },
  { pageNumber: 9, text: "Providing the correct answer after an unsuccessful attempt raised delayed recall further." },
  { pageNumber: 10, text: "General Discussion. Retrieval practice is a powerful learning tool that promotes long-term retention." },
  { pageNumber: 11, text: "Educational applications of test-enhanced learning." },
  { pageNumber: 12, text: "References. Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. Psychological Science, 17, 249-255." },
];

const initialDocumentsList: DocumentRecord[] = [
  createDocumentRecord({
    id: "doc-sample-1",
    title: "Test-Enhanced Learning",
    filepath: "/corpus/test_enhanced_learning.pdf",
    sha256_hash: "hash-test-enhanced-learning-sha256",
    page_count: 12,
    ownership_mode: "open_in_place",
  }),
  createDocumentRecord({
    id: "doc-sample-2",
    title: "How We Learn",
    filepath: "/documents/how_we_learn.pdf",
    original_filepath: "/downloads/how_we_learn.pdf",
    sha256_hash: "hash-how-we-learn-sha256",
    page_count: 336,
    ownership_mode: "managed_library",
  }),
];

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
  const [destination, setDestination] = useState<Destination>("reader");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"annotations" | "note" | "ai">("annotations");
  const [aiOn, setAiOn] = useState(false);
  const [selected, setSelected] = useState("recall");
  const [promptOpen, setPromptOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [initialImportPath, setInitialImportPath] = useState<string | null>(null);
  const [readingOnly, setReadingOnly] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const [documents, setDocuments] = useState<DocumentRecord[]>(initialDocumentsList);
  const [activeDocument, setActiveDocument] = useState<DocumentRecord>(initialDocumentsList[0]);
  const [activeSession, setActiveSession] = useState<ReadingSessionState | null>(null);
  const [collections, setCollections] = useState<CollectionItem[]>([]);

  // Background Jobs state
  const jobQueueManager = useMemo(() => new JobQueueManager(), []);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [jobDrawerOpen, setJobDrawerOpen] = useState(false);
  // Duplicate Confirmation state
  const [duplicateConfirmState, setDuplicateConfirmState] = useState<DuplicateConfirmationState | null>(null);

  // Recovery & Password Dialog state
  const [passwordPromptDoc, setPasswordPromptDoc] = useState<DocumentRecord | null>(null);
  const [isPasswordRejected, setIsPasswordRejected] = useState(false);
  const [scannedPdfBannerVisible, setScannedPdfBannerVisible] = useState(false);
  const [versionMismatchBannerVisible, setVersionMismatchBannerVisible] = useState(false);

  // Prototype Honesty (U15) state driven by real records
  const [annotationsList, setAnnotationsList] = useState<Highlight[]>(annotations);
  const [notesList, setNotesList] = useState<Array<{ id: string; title: string; type: string }>>([
    { id: "note-1", title: "Testing strengthens the route to recall", type: "Source note" },
    { id: "note-2", title: "Retrieval is an event, not a check", type: "Concept note" },
  ]);
  const [reviewPromptsList, setReviewPromptsList] = useState<Array<{ id: string; prompt: string }>>([
    { id: "prompt-1", prompt: "Why can repeated restudy produce higher confidence but weaker retention?" },
  ]);

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
        if (docs && docs.length > 0) {
          setDocuments(docs);
          setActiveDocument(docs[0]);

          try {
            const rawSession = await invoke<ReadingSessionState | null>("db_get_reading_session", { documentId: docs[0].id });
            if (rawSession) {
              const sanitized = validateAndSanitizeReadingSession(rawSession, DEFAULT_LAYOUT_BOUNDS, docs[0].page_count);
              setActiveSession(sanitized);
              setLeftOpen(sanitized.left_pane_open);
              setRightOpen(sanitized.right_pane_open);
            } else {
              const defaultS = createDefaultReadingSession(docs[0].id);
              setActiveSession(defaultS);
              setLeftOpen(defaultS.left_pane_open);
              setRightOpen(defaultS.right_pane_open);
            }
          } catch {
            setActiveSession(createDefaultReadingSession(docs[0].id));
          }
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

  async function openDocument(doc: DocumentRecord) {
    let fileExists = true;
    try {
      fileExists = await invoke<boolean>("check_file_exists", { filepath: doc.filepath });
    } catch {
      // Dev preview fallback: check path pattern
      if (doc.filepath.includes("missing")) {
        fileExists = false;
      }
    }

    const nowIso = new Date().toISOString();
    const updatedDoc: DocumentRecord = { ...doc, is_missing: !fileExists, last_opened_at: nowIso };

    try {
      await invoke("db_update_last_opened", { id: doc.id });
    } catch {
      // Dev fallback
    }

    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updatedDoc : d)));
    setActiveDocument(updatedDoc);

    // Restore saved reading session from Rust SQLite database (Task 2.6)
    try {
      const rawSession = await invoke<ReadingSessionState | null>("db_get_reading_session", { documentId: doc.id });
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
      const defaultS = createDefaultReadingSession(doc.id);
      setActiveSession(defaultS);
    }

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

    // Queue prioritized text extraction & thumbnail background job for opened document
    const extractionJob = createBackgroundJob({
      document_id: doc.id,
      job_type: "text_extraction",
      total_pages: doc.page_count,
      active_page: 1,
    });
    jobQueueManager.enqueueJob(extractionJob);
    setJobs(jobQueueManager.getJobs());
  }

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
    if (activeDocument.id === updatedDoc.id) {
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

  function handleDeleteRecord(docId: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    if (activeDocument.id === docId && documents.length > 1) {
      setActiveDocument(documents.find((d) => d.id !== docId) || documents[0]);
    }
  }

  const activeJobsCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;

  return (
    <main className={readingOnly ? "app reading-only" : "app"}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="app-mark" aria-hidden="true" />
        <strong>MERETH READER</strong>
        <span className="titlebar-document">
          {destination === "reader" ? `${activeDocument.title}.pdf` : "Local-first PDF reader"}
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
            {activeDocument.is_missing ? (
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
                annotationsList={annotationsList}
                scannedPdfBannerVisible={scannedPdfBannerVisible}
                versionMismatchBannerVisible={versionMismatchBannerVisible}
                activeDocumentJob={jobs.find((j) => j.document_id === activeDocument.id && (j.status === 'running' || j.status === 'pending'))}
                onCancelJob={handleCancelJob}
                onDismissScannedBanner={() => setScannedPdfBannerVisible(false)}
                onDismissVersionMismatchBanner={() => setVersionMismatchBannerVisible(false)}
                onReanchorAnnotations={() => setVersionMismatchBannerVisible(false)}
                onReturnToLibrary={() => setDestination("library")}
                setAiOn={setAiOn}
                setImportOpen={() => { setInitialImportPath(null); setImportOpen(true); }}
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
            onOpenImportModal={() => { setInitialImportPath(null); setImportOpen(true); }}
            onOpenJobQueue={() => setJobDrawerOpen(true)}
            onToggleFavourite={handleToggleFavourite}
            onToggleArchive={handleToggleArchive}
            onUpdateDocument={handleUpdateDocument}
            onUpdateCollections={handleUpdateCollections}
          />
        )}
        {destination === "notes" && <NotesView notesCount={notesList.length} onRemember={() => setPromptOpen(true)} />}
        {destination === "review" && <ReviewView reviewCount={reviewPromptsList.length} revealed={revealed} setRevealed={setRevealed} />}
        {destination === "settings" && (
          <SettingsView
            aiOn={aiOn}
            setAiOn={setAiOn}
            appearance={appearance}
            onUpdateAppearance={handleUpdateAppearance}
          />
        )}
      </section>

      {!readingOnly && <footer>{annotationsList.length} annotations · {notesList.length} notes <span /> Autosaved just now</footer>}
      
      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportComplete={handleImportComplete}
        existingDocuments={documents}
        initialFilePath={initialImportPath}
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
  totalPages: number;
  rightPaneWidth?: number;
  annotationsList: Highlight[];
  scannedPdfBannerVisible?: boolean;
  versionMismatchBannerVisible?: boolean;
  activeDocumentJob?: BackgroundJob;
  onCancelJob?: (jobId: string) => void;
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
  const canvasRef = useRef<HTMLElement | null>(null);
  const totalPages = props.totalPages || 12;

  const [historyState, setHistoryState] = useState(() => createNavigationHistory(currentPage));
  const [copyWarning, setCopyWarning] = useState<string | null>(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState("retrieval");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

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

  // Restore scroll offset when canvas mounts or session restored
  useEffect(() => {
    if (canvasRef.current && typeof scrollTopPx === 'number' && scrollTopPx > 0) {
      canvasRef.current.scrollTop = scrollTopPx;
    }
  }, [props.activeDocument.id, props.activeSession?.scroll_top_px]);

  // Handle canvas scroll offset
  const handleCanvasScroll = (e: React.UIEvent<HTMLElement>) => {
    setScrollTopPx(e.currentTarget.scrollTop);
  };

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

  // Auto-persist reading session state to Rust SQLite backend (debounced)
  useEffect(() => {
    if (!props.activeDocument || !props.activeDocument.id) return;

    const sessionToSave: ReadingSessionState = {
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
    zoomScale,
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
    return performAdvancedSearch(samplePageTexts, searchQuery, searchOptions);
  }, [searchQuery, searchOptions]);

  const outlineNodes = useMemo(() => {
    return parseOutlineTree(sampleRawOutline);
  }, []);

  useEffect(() => {
    if (props.targetPage && props.targetPage > 0) {
      handlePageChange(props.targetPage);
    }
  }, [props.targetPage]);

  // Jump page on active search match change
  useEffect(() => {
    if (searchMatches.length > 0 && searchMatches[currentMatchIndex]) {
      const match = searchMatches[currentMatchIndex];
      handlePageChange(match.pageNumber);
    }
  }, [currentMatchIndex, searchMatches]);

  const handlePageChange = (newPage: number) => {
    const validPage = Math.max(1, Math.min(newPage, totalPages));
    setCurrentPage(validPage);
    setHistoryState((prev) => pushNavigationHistory(prev, validPage));
  };

  const handleBack = () => {
    const result = navigateHistoryBack(historyState);
    if (result.page !== null) {
      setHistoryState(result.state);
      setCurrentPage(result.page);
    }
  };

  const handleForward = () => {
    const result = navigateHistoryForward(historyState);
    if (result.page !== null) {
      setHistoryState(result.state);
      setCurrentPage(result.page);
    }
  };

  const handleZoomChange = (
    action: 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page' | 'set',
    value?: number
  ) => {
    const result = calculateZoom(zoomScale, action, value);
    setZoomScale(result.scale);
    setZoomMode(result.mode);
  };

  const handleRotateChange = (direction: 'cw' | 'ccw') => {
    setRotation((prev) => rotateView(prev, direction));
  };

  const handleNextMatch = () => {
    if (searchMatches.length > 0) {
      setCurrentMatchIndex((prev) => getNextMatchIndex(prev, searchMatches.length, 'next'));
    }
  };

  const handlePrevMatch = () => {
    if (searchMatches.length > 0) {
      setCurrentMatchIndex((prev) => getNextMatchIndex(prev, searchMatches.length, 'prev'));
    }
  };

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
          props.setSelected('testing');
          break;
        case 'annot.highlight.green':
          props.setSelected('recall');
          break;
        case 'annot.remember':
          props.setPromptOpen(true);
          break;
      }
    };

    window.addEventListener('keydown', handleShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown);
  }, [currentPage, totalPages, historyState, searchMatches, props]);

  const handleCopySelection = () => {
    const selection = window.getSelection();
    if (!selection || !selection.toString().trim()) return;

    // Multi-column reading order extraction check (FR-8.4)
    const dummyItems: PDFTextItem[] = [
      { str: "Col 1 text", transform: [10, 0, 0, 10, 50, 700], width: 90, height: 10 },
      { str: "Col 2 text", transform: [10, 0, 0, 10, 75, 700], width: 90, height: 10 },
    ];
    const extraction = extractOrderedText(dummyItems);

    if (extraction.isLowConfidence && extraction.warning) {
      setCopyWarning(extraction.warning);
    } else {
      setCopyWarning(null);
    }
  };

  const canvasClass = `reader-canvas layout-${layoutMode} ${isFullscreen ? 'fullscreen' : ''}`;

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
          zoomScale={zoomScale}
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

          <RendererErrorBoundary onReturnToLibrary={props.onReturnToLibrary}>
            <article className={canvasClass} ref={canvasRef} onScroll={handleCanvasScroll} onCopy={handleCopySelection}>
              {props.readingOnly && (
                <button className="reading-indicator" onClick={() => props.setReadingOnly(false)}>
                  PAGE {currentPage} · READING ONLY · PRESS ESC
                </button>
              )}

              {copyWarning && (
                <div
                  style={{
                    background: "#fff3cd",
                    color: "#856404",
                    padding: "0.5rem 1rem",
                    border: "1px solid #ffeeba",
                    borderRadius: "4px",
                    margin: "0.5rem 1rem",
                    fontSize: "0.85rem",
                  }}
                >
                  ⚠️ {copyWarning}
                </div>
              )}

              <div
                className="document-canvas-wrapper"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  transition: "transform 0.2s ease-in-out",
                  width: "100%",
                }}
              >
                {layoutMode === "facing" ? (
                  <div className="facing-page-container">
                    <DocumentPage setSelected={props.setSelected} zoomScale={zoomScale} pageNumber={currentPage} />
                    {currentPage + 1 <= totalPages && (
                      <DocumentPage setSelected={props.setSelected} zoomScale={zoomScale} pageNumber={currentPage + 1} />
                    )}
                  </div>
                ) : (
                  <DocumentPage setSelected={props.setSelected} zoomScale={zoomScale} pageNumber={currentPage} />
                )}
              </div>
            </article>
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

function DocumentPage({
  setSelected,
  zoomScale,
  pageNumber,
}: {
  setSelected: (value: string) => void;
  zoomScale?: number;
  pageNumber?: number;
}) {
  const scale = zoomScale ?? 1.0;
  const pageLabelInfo = formatExtendedPageLabel(pageNumber || 4, 12);

  return (
    <div
      className="page-sheet"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        transition: "transform 0.15s ease-out",
      }}
    >
      <div className="paper-running">
        <span>Psychological Science · Vol. 17 · No. 3</span>
        <span>{pageLabelInfo.displayLabel}</span>
      </div>
      <p className="paper-kicker">Research article</p>
      <h1>Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention</h1>
      <p className="authors">Henry L. Roediger III and Jeffrey D. Karpicke</p>
      <div className="paper-rule" />
      <div className="paper-columns">
        <p>
          <b>Abstract—</b> Taking a test on studied material is commonly treated as a neutral measurement of what a learner already knows. Two experiments examined whether the act of retrieval itself changes later retention. Students read short prose passages and then either restudied the passage or took a free-recall test.{" "}
          <mark className="highlight yellow" onClick={() => setSelected("testing")}>
            Repeated studying produced better performance on an immediate test, but repeated testing produced substantially better performance after a delay of one week.
          </mark>{" "}
          The advantage of restudy reversed over time.
        </p>
        <p>
          Educational practice treats assessment as an instrument of measurement. The instrument metaphor is convenient for administration, but it is a poor description of what happens in memory. Retrieving information is itself a learning event, and the size of that event depends on the conditions under which retrieval occurs.
        </p>
        <p>
          <mark className="highlight green" onClick={() => setSelected("recall")}>
            In Experiment 1, participants who studied a passage once and were then tested three times recalled 61% of idea units one week later, compared with 40% for participants who studied the same passage four times.
          </mark>{" "}
          The reversal was not visible at five minutes, where the repeated-study group performed best.
        </p>
        <p>
          This dissociation between immediate and delayed performance matters for how learners regulate their own study. When asked to predict their later recall, participants in the repeated-study condition were consistently more confident. Fluency during study was read as evidence of durability, and it was not.
        </p>
        <p>
          <mark className="highlight blue" onClick={() => setSelected("route")}>
            We interpret the effect as a consequence of the retrieval route being strengthened rather than the representation being enriched.
          </mark>{" "}
          On this account, the difficulty of the retrieval attempt is not incidental; it is the mechanism.
        </p>
        <p>
          Experiment 2 replicated the pattern with a different set of passages and added a feedback manipulation. Providing the correct answer after an unsuccessful attempt raised delayed recall further.
        </p>
      </div>
    </div>
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
          <button className="wide-action" onClick={() => props.setPromptOpen(true)}>
            <Glyph>▰</Glyph> Remember selected evidence
          </button>
        </div>
      )}
      {props.rightTab === "note" && <div className="note-editor"><span className="eyebrow">Source note</span><h2>Testing strengthens the route to recall</h2><p className="evidence-block">“{props.activeAnnotation.quote}”<small>— {props.documentName.replace(".pdf", "")}, p. {props.activeAnnotation.page}</small></p><textarea aria-label="Note content" defaultValue="Restudy can feel more fluent in the moment, but retrieval practice makes a later attempt more likely to succeed." /><button className="wide-action">Add evidence block</button></div>}
      {props.rightTab === "ai" && <div className="ai-pane">{props.aiOn ? <><span className="eyebrow">Local AI · selected text only</span><h2>Ask this document</h2><p>Drafts stay separate from your notes until you explicitly adopt them. Every answer must cite its source page.</p><div className="ai-answer"><b>Possible reading</b><p>Testing may improve delayed retention because each attempt strengthens later access, while restudy mainly improves familiar-feeling fluency.</p><small>Source: p. 249–250</small></div><button className="wide-action">Adopt into note</button></> : <><Glyph>✦</Glyph><h2>AI is off</h2><p>Reading, annotations, notes, review, search, and export remain fully available. Turning it on never sends document text off this device.</p><button className="wide-action primary" onClick={() => props.setAiOn(true)}>Turn on local AI</button></>}</div>}
    </aside>
  );
}

function NotesView({ notesCount, onRemember }: { notesCount: number; onRemember: () => void }) {
  return (
    <section className="destination-view">
      <div className="view-header">
        <div>
          <span className="eyebrow">{notesCount} notes · all local</span>
          <h1>Notes</h1>
        </div>
        <button className="wide-action primary" onClick={onRemember}>
          Remember this
        </button>
      </div>
      <div className="destination-rule" />
      <div className="notes-layout">
        <aside>
          <input placeholder="Search notes" />
          <button className="note-list-active">
            Testing strengthens the route to recall<small>Source note · updated now</small>
          </button>
          <button>
            Retrieval is an event, not a check<small>Concept note · 2 sources</small>
          </button>
        </aside>
        <article className="note-reading">
          <span className="eyebrow">Source note · Test-Enhanced Learning</span>
          <h2>Testing strengthens the route to recall</h2>
          <p className="evidence-block">
            “Testing three times recalled 61% of idea units one week later, compared with 40% after repeated study.”
            <small>— Roediger & Karpicke, p. 249</small>
          </p>
          <p>
            The thing to preserve is the distinction between performance now and access later. Restudy improves familiarity, but it does not exercise the retrieval route the eventual test requires.
          </p>
        </article>
      </div>
    </section>
  );
}

function ReviewView({
  reviewCount,
  revealed,
  setRevealed,
}: {
  reviewCount: number;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
}) {
  return (
    <section className="review-view">
      <span className="eyebrow">
        {reviewCount > 0 ? `${reviewCount} due` : "0 due"} · FSRS · desired retention 90%
      </span>
      <h1>Review before you reveal.</h1>
      <p className="review-preamble">You decide the outcome. The source is the feedback authority.</p>
      <div className="review-prompt">
        <span className="eyebrow">Explanation · source linked</span>
        <h2>Why can repeated restudy produce higher confidence but weaker one-week retention than repeated testing?</h2>
        {!revealed ? (
          <>
            <textarea placeholder="Say it out loud, or write it here…" />
            <div>
              <button className="wide-action primary" onClick={() => setRevealed(true)}>
                Reveal source
              </button>
              <button className="wide-action" onClick={() => setRevealed(true)}>
                Skip — I can’t recall
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="revealed-source">
              <b>Source feedback</b>
              <p>Restudy raises fluency, which can be misread as learning. Testing strengthens later retrieval access, which delayed tests measure.</p>
              <small>Linked evidence · Test-Enhanced Learning, p. 249</small>
            </div>
            <div className="rating-row">
              {["Again · 1 d", "Hard · 9 d", "Good · 24 d", "Easy · 41 d"].map((rating) => (
                <button key={rating} onClick={() => setRevealed(false)}>
                  {rating}
                </button>
              ))}
            </div>
            <p className="hard-note">
              <b>Hard is still successful recall.</b> Use Again only when you could not retrieve it.
            </p>
          </>
        )}
      </div>
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
  return <div className="modal-backdrop" role="presentation"><section className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><button className="modal-close" onClick={close} aria-label="Close"><Glyph>×</Glyph></button><span className="eyebrow">Draft · not scheduled</span><h2 id="prompt-title">New retrieval prompt</h2><p>Nothing enters the review queue until you approve it. Every prompt keeps a link to its evidence.</p><p className="evidence-block">“{evidence.quote}”<small>Linked evidence · p. {evidence.page}</small></p><label className="field-label">Prompt<textarea defaultValue="Why does repeated restudy produce higher confidence but weaker one-week retention than repeated testing?" /></label><label className="field-label">Your answer — you write or rewrite this<textarea defaultValue="Restudy raises fluency, while testing strengthens the retrieval route a delayed test measures." /></label><div className="prompt-check"><b>Prompt check — advisory, never blocking</b><span>✓ Focused — one retrieval task.</span><span>✓ Requires recall — no recognition options.</span><span>! Cue — name the source context if you will need it later.</span></div><div className="modal-actions"><button className="wide-action" onClick={close}>Save as draft</button><button className="wide-action primary" onClick={close}>Approve prompt</button></div></section></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
