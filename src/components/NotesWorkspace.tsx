import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { AnnotationRecord, AnnotationType } from '../utils/annotationTypes';
import type { DocumentRecord } from '../utils/pdfImport';

interface NotesWorkspaceProps {
  document: DocumentRecord | null;
  annotations: AnnotationRecord[];
  rememberedAnnotationIds?: ReadonlySet<string>;
  onOpenAnnotation: (annotation: AnnotationRecord) => void;
  onOpenReader: () => void;
  onLinkAnnotation?: (annotation: AnnotationRecord) => void;
  onRememberAnnotation?: (annotation: AnnotationRecord) => void;
}

type NotesFilter = 'all' | AnnotationType;
const PAGE_SIZE = 20;
const FILTERS: Array<{ id: NotesFilter; label: string }> = [
  { id: 'all', label: 'All annotations' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'comment', label: 'Notes' },
  { id: 'underline', label: 'Underlines' },
  { id: 'area', label: 'Clippings' },
  { id: 'bookmark', label: 'Bookmarks' },
];

function annotationLabel(type: AnnotationType) {
  if (type === 'area') return 'Clipping';
  if (type === 'comment') return 'Note';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function NotesWorkspace({
  document,
  annotations,
  rememberedAnnotationIds = new Set<string>(),
  onOpenAnnotation,
  onOpenReader,
  onLinkAnnotation,
  onRememberAnnotation,
}: NotesWorkspaceProps) {
  const [filter, setFilter] = useState<NotesFilter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const activeAnnotations = useMemo(() => annotations.filter((item) => !item.deleted_at), [annotations]);
  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return activeAnnotations
      .filter((item) => filter === 'all' || item.annotation_type === filter)
      .filter((item) => !needle || `${item.quote} ${item.comment} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.page_index - b.page_index || a.created_at.localeCompare(b.created_at));
  }, [activeAnnotations, filter, deferredQuery]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageItems = useMemo(() => visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [page, visible]);
  const selected = pageItems.find((item) => item.id === selectedId) ?? pageItems[0] ?? null;
  const counts = useMemo(() => new Map(FILTERS.map(({ id }) => [
    id,
    id === 'all' ? activeAnnotations.length : activeAnnotations.filter((item) => item.annotation_type === id).length,
  ])), [activeAnnotations]);

  useEffect(() => {
    setPage(0);
    setSelectedId(null);
  }, [filter, query, document?.id]);

  useEffect(() => {
    setSelectedId(null);
  }, [page]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  return <section className="notes-workspace">
    <aside className="knowledge-sidebar">
      <header>Notes</header>
      <nav aria-label="Annotation filters">{FILTERS.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}><span>{item.label}</span><small>{counts.get(item.id) ?? 0}</small></button>)}</nav>
      <div className="knowledge-side-section"><b>Sources</b>{document ? <button className="source-active" onClick={onOpenReader}><span>{document.title}</span><small>{activeAnnotations.length}</small></button> : <p>Open a PDF to collect annotations.</p>}</div>
      <div className="knowledge-side-section notes-workflow-help"><b>Workflow</b><p>Capture in Reader, organise here, then link durable ideas into Knowledge.</p></div>
      <footer><span>Local storage</span><small>On this device</small></footer>
    </aside>

    <main className="annotations-main">
      <header className="annotations-titlebar"><div><span className="eyebrow">Source annotations</span><h1>{document?.title ?? 'Notes'}</h1><p>{activeAnnotations.length} annotations preserving page and source context</p></div><button className="button primary" onClick={onOpenReader} disabled={!document}>Open PDF</button></header>
      <div className="annotation-filter-chips" role="group" aria-label="Annotation type">{FILTERS.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label.replace(' annotations', '')}<small>{counts.get(item.id) ?? 0}</small></button>)}</div>
      <div className="annotations-toolbar"><label><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search annotations…" /></label><span>{filter === 'all' ? 'All annotation types' : annotationLabel(filter)}</span></div>
      <div className="annotation-feed">
        {pageItems.length === 0 ? <div className="annotation-feed-empty"><b>No annotations here yet</b><p>Highlight, underline, clip, or comment on a passage in the reader. It will appear here with its exact page context.</p><button className="button" onClick={onOpenReader}>Go to reader</button></div> : pageItems.map((item) => <article key={item.id} className={`annotation-feed-item${selected?.id === item.id ? ' selected' : ''}`} onClick={() => setSelectedId(item.id)} onDoubleClick={() => onOpenAnnotation(item)} tabIndex={0}>
          <i className={`annotation-type-${item.color}`} /><span className="annotation-page">p. {item.page_label}</span><span className="annotation-kind">{annotationLabel(item.annotation_type)}</span><time>{new Date(item.updated_at).toLocaleDateString()}</time>
          {item.quote && <q>{item.quote}</q>}{item.comment && <p><b>My note</b>{item.comment}</p>}<span className="annotation-tags">{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</span>
          <footer className="annotation-card-actions"><button onClick={(event) => { event.stopPropagation(); onOpenAnnotation(item); }}>Open PDF</button>{onLinkAnnotation && <button onClick={(event) => { event.stopPropagation(); onLinkAnnotation(item); }}>Link to note</button>}{onRememberAnnotation && <button className={rememberedAnnotationIds.has(item.id) ? 'remembered' : ''} onClick={(event) => { event.stopPropagation(); onRememberAnnotation(item); }}>{rememberedAnnotationIds.has(item.id) ? 'Remembered' : 'Remember'}</button>}</footer>
        </article>)}
      </div>
      {visible.length > PAGE_SIZE && <footer className="annotation-pagination"><span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length}</span><div><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><b>{page + 1} / {pageCount}</b><button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>}
    </main>

    <aside className="annotation-inspector">
      <header><b>Annotation details</b>{selected && <span>{visible.indexOf(selected) + 1} of {visible.length}</span>}</header>
      {selected ? <><div className="inspector-meta"><span>{annotationLabel(selected.annotation_type)}</span><b>p. {selected.page_label}</b></div>{selected.quote && <q>{selected.quote}</q>}<section><b>My note</b><p>{selected.comment || 'No note added.'}</p></section><dl><div><dt>Source</dt><dd>{document?.title ?? 'PDF document'}</dd></div><div><dt>Added</dt><dd>{new Date(selected.created_at).toLocaleString()}</dd></div><div><dt>Tags</dt><dd>{selected.tags.join(', ') || 'None'}</dd></div></dl><div className="inspector-actions"><button className="button" onClick={() => onOpenAnnotation(selected)}>Open PDF</button>{onLinkAnnotation && <button className="button" onClick={() => onLinkAnnotation(selected)}>Link</button>}</div><section className="inspector-review"><span>Spaced repetition</span><b>{rememberedAnnotationIds.has(selected.id) ? 'Review prompt created' : 'Not scheduled'}</b><p>{rememberedAnnotationIds.has(selected.id) ? 'This annotation has a prompt in Review.' : 'Choose Remember to author a review prompt from this exact source.'}</p>{onRememberAnnotation && !rememberedAnnotationIds.has(selected.id) && <button className="button compact" onClick={() => onRememberAnnotation(selected)}>Remember</button>}</section></> : <p className="inspector-empty">Select an annotation to inspect its source and page context.</p>}
    </aside>
  </section>;
}
