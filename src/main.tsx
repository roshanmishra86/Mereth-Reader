import { StrictMode, useEffect, useMemo, useState, memo } from "react";
import { createRoot } from "react-dom/client";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles.css";

type Destination = "library" | "reader" | "notes" | "review" | "settings";
type Highlight = { id: string; color: string; label: string; quote: string; page: string };

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

const nav = [
  ["library", "Library", "▤"],
  ["reader", "Reader", "▯"],
  ["notes", "Notes", "✎"],
  ["review", "Review", "↻"],
] as const;

// ⚡ Bolt: Memoize Glyph to prevent unnecessary re-renders for purely static icons
const Glyph = memo(function Glyph({ children }: { children: string }) {
  return <span className="glyph" aria-hidden="true">{children}</span>;
});

function App() {
  const [destination, setDestination] = useState<Destination>("reader");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"annotations" | "note" | "ai">("annotations");
  const [aiOn, setAiOn] = useState(false);
  const [selected, setSelected] = useState("recall");
  const [promptOpen, setPromptOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [readingOnly, setReadingOnly] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [documentName, setDocumentName] = useState("Test-Enhanced Learning.pdf");

  const activeAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selected) ?? annotations[0],
    [selected],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReadingOnly(false);
        setPromptOpen(false);
        setImportOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
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

  async function choosePdf() {
    try {
      const file = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      });
      if (file && !Array.isArray(file)) {
        const fileName = file.split(/[\\/]/).pop() || file;
        setDocumentName(fileName);
        setDestination("reader");
        setImportOpen(false);
      }
    } catch {
      // The browser preview has no native Tauri dialog; the import sheet remains usable.
    }
  }

  return (
    <main className={readingOnly ? "app reading-only" : "app"}>
      <header className="titlebar" data-tauri-drag-region>
        <span className="app-mark" aria-hidden="true" />
        <strong>MERETH READER</strong>
        <span className="titlebar-document">{destination === "reader" ? documentName : "Local-first PDF reader"}</span>
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
              {id === "review" && <em>12</em>}
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
          <Reader
            aiOn={aiOn}
            activeAnnotation={activeAnnotation}
            documentName={documentName}
            leftOpen={leftOpen}
            readingOnly={readingOnly}
            rightOpen={rightOpen}
            rightTab={rightTab}
            selected={selected}
            setAiOn={setAiOn}
            setImportOpen={setImportOpen}
            setLeftOpen={setLeftOpen}
            setPromptOpen={setPromptOpen}
            setReadingOnly={setReadingOnly}
            setRightOpen={setRightOpen}
            setRightTab={setRightTab}
            setSelected={setSelected}
          />
        )}
        {destination === "library" && <LibraryView onOpen={() => setImportOpen(true)} onRead={() => setDestination("reader")} />}
        {destination === "notes" && <NotesView onRemember={() => setPromptOpen(true)} />}
        {destination === "review" && <ReviewView revealed={revealed} setRevealed={setRevealed} />}
        {destination === "settings" && <SettingsView aiOn={aiOn} setAiOn={setAiOn} />}
      </section>

      {!readingOnly && <footer>41 annotations · 6 notes <span /> Autosaved just now</footer>}
      {importOpen && <ImportDialog close={() => setImportOpen(false)} choosePdf={choosePdf} />}
      {promptOpen && <PromptDialog close={() => setPromptOpen(false)} evidence={activeAnnotation} />}
    </main>
  );
}

type ReaderProps = {
  aiOn: boolean; activeAnnotation: Highlight; documentName: string; leftOpen: boolean; readingOnly: boolean;
  rightOpen: boolean; rightTab: "annotations" | "note" | "ai"; selected: string;
  setAiOn: (value: boolean) => void; setImportOpen: (value: boolean) => void; setLeftOpen: (value: boolean) => void;
  setPromptOpen: (value: boolean) => void; setReadingOnly: (value: boolean) => void; setRightOpen: (value: boolean) => void;
  setRightTab: (value: "annotations" | "note" | "ai") => void; setSelected: (value: string) => void;
};

// ⚡ Bolt: Memoize Reader to avoid re-rendering the entire reading view when top-level App state changes
const Reader = memo(function Reader(props: ReaderProps) {
  return <>
    {!props.readingOnly && <div className="reader-toolbar">
      <button className="outline-button" onClick={() => props.setLeftOpen(!props.leftOpen)}><Glyph>☰</Glyph> Outline</button>
      <div className="toolbar-rule" />
      <span className="page-control">4 <small>/ 12 · p. 249</small></span>
      <div className="toolbar-rule" />
      <label className="search-control"><Glyph>⌕</Glyph><input aria-label="Search this document" defaultValue="retrieval" /><b>7 / 41</b></label>
      <div className="toolbar-spacer" />
      <button className="outline-button" onClick={() => props.setReadingOnly(true)}>Reading only</button>
      <button className="outline-button" onClick={() => props.setRightOpen(!props.rightOpen)}><Glyph>▯</Glyph> Side pane</button>
      <button className={props.aiOn ? "ai-toggle on" : "ai-toggle"} onClick={() => props.setAiOn(!props.aiOn)}>
        <i /> Local AI · {props.aiOn ? "On" : "Off"}
      </button>
    </div>}
    <div className="reader-layout">
      {props.leftOpen && !props.readingOnly && <Outline />}
      <article className="reader-canvas">
        {props.readingOnly && <button className="reading-indicator" onClick={() => props.setReadingOnly(false)}>PAGE 249 · READING ONLY · PRESS ESC</button>}
        <DocumentPage setSelected={props.setSelected} />
      </article>
      {props.rightOpen && !props.readingOnly && <RightPane {...props} />}
    </div>
  </>;
});

// ⚡ Bolt: Memoize Outline since it represents a completely static structure
const Outline = memo(function Outline() {
  return <aside className="outline-pane"><div className="pane-tabs"><b>Outline</b><span>Pages</span></div><nav>
    <button>Abstract <small>249</small></button><button className="outline-active">Introduction <small>250</small></button><button>Experiment 1 <small>251</small></button><button>Experiment 2 <small>252</small></button><button>General discussion <small>257</small></button><button>References <small>260</small></button>
  </nav><div className="outline-note"><Glyph>☷</Glyph> Document outline</div></aside>;
});

// ⚡ Bolt: Memoize DocumentPage to prevent expensive DOM re-renders when parent state (like right pane tabs) changes
const DocumentPage = memo(function DocumentPage({ setSelected }: { setSelected: (value: string) => void }) {
  return <div className="page-sheet"><div className="paper-running"><span>Psychological Science · Vol. 17 · No. 3</span><span>249</span></div><p className="paper-kicker">Research article</p><h1>Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention</h1><p className="authors">Henry L. Roediger III and Jeffrey D. Karpicke</p><div className="paper-rule" /><div className="paper-columns">
    <p><b>Abstract—</b> Taking a test on studied material is commonly treated as a neutral measurement of what a learner already knows. Two experiments examined whether the act of retrieval itself changes later retention. Students read short prose passages and then either restudied the passage or took a free-recall test. <mark className="highlight yellow" onClick={() => setSelected("testing")}>Repeated studying produced better performance on an immediate test, but repeated testing produced substantially better performance after a delay of one week.</mark> The advantage of restudy reversed over time.</p>
    <p>Educational practice treats assessment as an instrument of measurement. The instrument metaphor is convenient for administration, but it is a poor description of what happens in memory. Retrieving information is itself a learning event, and the size of that event depends on the conditions under which retrieval occurs.</p>
    <p><mark className="highlight green" onClick={() => setSelected("recall")}>In Experiment 1, participants who studied a passage once and were then tested three times recalled 61% of idea units one week later, compared with 40% for participants who studied the same passage four times.</mark> The reversal was not visible at five minutes, where the repeated-study group performed best.</p>
    <p>This dissociation between immediate and delayed performance matters for how learners regulate their own study. When asked to predict their later recall, participants in the repeated-study condition were consistently more confident. Fluency during study was read as evidence of durability, and it was not.</p>
    <p><mark className="highlight blue" onClick={() => setSelected("route")}>We interpret the effect as a consequence of the retrieval route being strengthened rather than the representation being enriched.</mark> On this account, the difficulty of the retrieval attempt is not incidental; it is the mechanism.</p>
    <p>Experiment 2 replicated the pattern with a different set of passages and added a feedback manipulation. Providing the correct answer after an unsuccessful attempt raised delayed recall further.</p>
  </div></div>;
});

function RightPane(props: ReaderProps) {
  const tabs: Array<[typeof props.rightTab, string]> = [["annotations", "Annotations"], ["note", "Note"], ["ai", "AI"]];
  return <aside className="right-pane"><div className="pane-tabs">{tabs.map(([id, label]) => <button key={id} className={props.rightTab === id ? "pane-tab active" : "pane-tab"} onClick={() => props.setRightTab(id)}>{label}{id === "ai" && <i className={props.aiOn ? "dot on" : "dot"} />}</button>)}</div>
    {props.rightTab === "annotations" && <div className="annotation-list"><div className="pane-heading"><span>All 41</span><button><Glyph>•••</Glyph></button></div>{annotations.map((item) => <button key={item.id} className={props.selected === item.id ? "annotation-item active" : "annotation-item"} onClick={() => props.setSelected(item.id)}><i className={`annotation-swatch ${item.color}`} /><span><b>{item.label}</b><small>p. {item.page}</small><q>{item.quote}</q></span></button>)}<button className="wide-action" onClick={() => props.setPromptOpen(true)}><Glyph>▰</Glyph> Remember selected evidence</button></div>}
    {props.rightTab === "note" && <div className="note-editor"><span className="eyebrow">Source note</span><h2>Testing strengthens the route to recall</h2><p className="evidence-block">“{props.activeAnnotation.quote}”<small>— {props.documentName.replace(".pdf", "")}, p. {props.activeAnnotation.page}</small></p><textarea aria-label="Note content" defaultValue="Restudy can feel more fluent in the moment, but retrieval practice makes a later attempt more likely to succeed." /><button className="wide-action">Add evidence block</button></div>}
    {props.rightTab === "ai" && <div className="ai-pane">{props.aiOn ? <><span className="eyebrow">Local AI · selected text only</span><h2>Ask this document</h2><p>Drafts stay separate from your notes until you explicitly adopt them. Every answer must cite its source page.</p><div className="ai-answer"><b>Possible reading</b><p>Testing may improve delayed retention because each attempt strengthens later access, while restudy mainly improves familiar-feeling fluency.</p><small>Source: p. 249–250</small></div><button className="wide-action">Adopt into note</button></> : <><Glyph>✦</Glyph><h2>AI is off</h2><p>Reading, annotations, notes, review, search, and export remain fully available. Turning it on never sends document text off this device.</p><button className="wide-action primary" onClick={() => props.setAiOn(true)}>Turn on local AI</button></>}</div>}
  </aside>;
}

function LibraryView({ onOpen, onRead }: { onOpen: () => void; onRead: () => void }) {
  return <section className="destination-view"><div className="view-header"><div><span className="eyebrow">Your documents</span><h1>Library</h1></div><button className="wide-action primary" onClick={onOpen}><Glyph>□</Glyph> Open a PDF</button></div><div className="destination-rule" /><label className="library-search"><Glyph>⌕</Glyph><input placeholder="Search titles, authors, annotations…" /></label><div className="document-list"><button onClick={onRead}><Glyph>▯</Glyph><span><b>Test-Enhanced Learning</b><small>Roediger & Karpicke · 12 pages · Open in place</small></span><em>Opened now</em><Glyph>›</Glyph></button><button onClick={onRead}><Glyph>▯</Glyph><span><b>How We Learn</b><small>Brown, Roediger & McDaniel · 336 pages · Managed</small></span><em>3 notes</em><Glyph>›</Glyph></button></div></section>;
}

function NotesView({ onRemember }: { onRemember: () => void }) {
  return <section className="destination-view"><div className="view-header"><div><span className="eyebrow">6 notes · all local</span><h1>Notes</h1></div><button className="wide-action primary" onClick={onRemember}>Remember this</button></div><div className="destination-rule" /><div className="notes-layout"><aside><input placeholder="Search notes" /><button className="note-list-active">Testing strengthens the route to recall<small>Source note · updated now</small></button><button>Retrieval is an event, not a check<small>Concept note · 2 sources</small></button></aside><article className="note-reading"><span className="eyebrow">Source note · Test-Enhanced Learning</span><h2>Testing strengthens the route to recall</h2><p className="evidence-block">“Testing three times recalled 61% of idea units one week later, compared with 40% after repeated study.”<small>— Roediger & Karpicke, p. 249</small></p><p>The thing to preserve is the distinction between performance now and access later. Restudy improves familiarity, but it does not exercise the retrieval route the eventual test requires.</p></article></div></section>;
}

function ReviewView({ revealed, setRevealed }: { revealed: boolean; setRevealed: (value: boolean) => void }) {
  return <section className="review-view"><span className="eyebrow">12 due · FSRS · desired retention 90%</span><h1>Review before you reveal.</h1><p className="review-preamble">You decide the outcome. The source is the feedback authority.</p><div className="review-prompt"><span className="eyebrow">Explanation · source linked</span><h2>Why can repeated restudy produce higher confidence but weaker one-week retention than repeated testing?</h2>{!revealed ? <><textarea placeholder="Say it out loud, or write it here…" /><div><button className="wide-action primary" onClick={() => setRevealed(true)}>Reveal source</button><button className="wide-action" onClick={() => setRevealed(true)}>Skip — I can’t recall</button></div></> : <><div className="revealed-source"><b>Source feedback</b><p>Restudy raises fluency, which can be misread as learning. Testing strengthens later retrieval access, which delayed tests measure.</p><small>Linked evidence · Test-Enhanced Learning, p. 249</small></div><div className="rating-row">{["Again · 1 d", "Hard · 9 d", "Good · 24 d", "Easy · 41 d"].map((rating) => <button key={rating} onClick={() => setRevealed(false)}>{rating}</button>)}</div><p className="hard-note"><b>Hard is still successful recall.</b> Use Again only when you could not retrieve it.</p></>}</div></section>;
}

function SettingsView({ aiOn, setAiOn }: { aiOn: boolean; setAiOn: (value: boolean) => void }) {
  return <section className="settings-view"><aside><b>Appearance</b><b>Reading</b><b>Annotations</b><b>Review</b><b className="selected-setting">AI & privacy</b><b>Storage</b><b>Export</b><b>Shortcuts</b></aside><article><span className="eyebrow">Your local boundary</span><h1>Local AI & privacy</h1><p>Everything here is off by default. The Reader is complete without it.</p><div className="destination-rule" /><div className="setting-state"><div><b>Local AI · {aiOn ? "On" : "Off"}</b><p>When off, no Reader-managed model process or semantic index is kept in memory. No document text leaves this device.</p></div><button className="wide-action primary" onClick={() => setAiOn(!aiOn)}>{aiOn ? "Turn off" : "Turn on"}</button></div><h3>Runtime</h3><label className="radio-row"><input type="radio" defaultChecked /><span /><div><b>Strict local — app-managed runtime</b><small>The only mode the Reader can verify. No network tools.</small></div></label><label className="radio-row"><input type="radio" /><span /><div><b>External provider — Ollama or LM Studio</b><small>Loopback only, but its network behavior is outside Reader’s control.</small></div></label></article></section>;
}

function ImportDialog({ close, choosePdf }: { close: () => void; choosePdf: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="modal-close" onClick={close} aria-label="Close"><Glyph>×</Glyph></button><span className="eyebrow">Import</span><h2 id="import-title">Open a PDF</h2><p>Choose how Reader should hold this file. Import never moves or alters the original.</p><label className="import-choice selected"><input type="radio" defaultChecked name="ownership" /><span><b>Open in place</b><small>Fastest for ad hoc reading. If you move or replace the file, Reader will ask you to locate it again.</small></span></label><label className="import-choice"><input type="radio" name="ownership" /><span><b>Copy into the managed library</b><small>Keeps a private copy in app data and records the original source path.</small></span></label><div className="modal-actions"><button className="wide-action" onClick={close}>Cancel</button><button className="wide-action primary" onClick={choosePdf}>Choose PDF</button></div></section></div>;
}

function PromptDialog({ close, evidence }: { close: () => void; evidence: Highlight }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"><button className="modal-close" onClick={close} aria-label="Close"><Glyph>×</Glyph></button><span className="eyebrow">Draft · not scheduled</span><h2 id="prompt-title">New retrieval prompt</h2><p>Nothing enters the review queue until you approve it. Every prompt keeps a link to its evidence.</p><p className="evidence-block">“{evidence.quote}”<small>Linked evidence · p. {evidence.page}</small></p><label className="field-label">Prompt<textarea defaultValue="Why does repeated restudy produce higher confidence but weaker one-week retention than repeated testing?" /></label><label className="field-label">Your answer — you write or rewrite this<textarea defaultValue="Restudy raises fluency, while testing strengthens the retrieval route a delayed test measures." /></label><div className="prompt-check"><b>Prompt check — advisory, never blocking</b><span>✓ Focused — one retrieval task.</span><span>✓ Requires recall — no recognition options.</span><span>! Cue — name the source context if you will need it later.</span></div><div className="modal-actions"><button className="wide-action" onClick={close}>Save as draft</button><button className="wide-action primary" onClick={close}>Approve prompt</button></div></section></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
