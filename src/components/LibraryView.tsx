import React, { useState, useMemo } from 'react';
import { DocumentRecord } from '../utils/pdfImport';
import {
  CollectionItem,
  LibraryFilterCategory,
  LibrarySortField,
  LibrarySortOrder,
  filterDocuments,
  sortDocuments,
  extractAllUniqueTags,
} from '../utils/libraryUtils';
import { MetadataEditorModal } from './MetadataEditorModal';
import { CollectionManagerModal } from './CollectionManagerModal';
import { EmptyState } from './EmptyState';

interface LibraryViewProps {
  documents: DocumentRecord[];
  removedDocuments: DocumentRecord[];
  collections: CollectionItem[];
  activeJobsCount: number;
  onOpenDocument: (doc: DocumentRecord) => void;
  onOpenPdf: () => void;
  onOpenImportModal: () => void;
  onOpenJobQueue: () => void;
  onToggleFavourite: (docId: string, currentStatus: boolean) => void;
  onToggleArchive: (docId: string, currentStatus: boolean) => void;
  onUpdateDocument: (doc: DocumentRecord) => void;
  onUpdateCollections: (collections: CollectionItem[]) => void;
  onRestoreDocument: (docId: string) => void;
  onPurgeDocument: (doc: DocumentRecord) => void;
}

export function LibraryView({
  documents,
  removedDocuments,
  collections,
  activeJobsCount,
  onOpenDocument,
  onOpenPdf,
  onOpenImportModal,
  onOpenJobQueue,
  onToggleFavourite,
  onToggleArchive,
  onUpdateDocument,
  onUpdateCollections,
  onRestoreDocument,
  onPurgeDocument,
}: LibraryViewProps) {
  const [filterCategory, setFilterCategory] = useState<LibraryFilterCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<string | undefined>(undefined);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<LibrarySortField>('title');
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>('asc');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');

  const [editingDoc, setEditingDoc] = useState<DocumentRecord | null>(null);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);

  const allRecords = useMemo(() => [...documents, ...removedDocuments], [documents, removedDocuments]);
  const availableTags = useMemo(() => extractAllUniqueTags(documents), [documents]);

  const filteredDocs = useMemo(() => {
    const filtered = filterDocuments(allRecords, {
      category: filterCategory,
      collectionName: selectedCollection,
      tagName: selectedTag,
      searchQuery,
    });
    return sortDocuments(filtered, sortBy, sortOrder);
  }, [allRecords, filterCategory, selectedCollection, selectedTag, searchQuery, sortBy, sortOrder]);

  const handleSelectCategory = (cat: LibraryFilterCategory) => {
    setFilterCategory(cat);
    setSelectedCollection(undefined);
    setSelectedTag(undefined);
  };

  const handleSelectCollection = (colName: string) => {
    setFilterCategory('collection');
    setSelectedCollection(colName);
    setSelectedTag(undefined);
  };

  const handleSelectTag = (tagName: string) => {
    setFilterCategory('tag');
    setSelectedTag(tagName);
    setSelectedCollection(undefined);
  };

  return (
    <div className="library-view-container">
      {/* Left Organization Sidebar (FR-7.5) */}
      <aside className="library-sidebar">
        <div className="sidebar-section">
          <h4>LIBRARY & FILTERS</h4>
          <button
            className={`sidebar-nav-item ${filterCategory === 'all' ? 'active' : ''}`}
            onClick={() => handleSelectCategory('all')}
          >
            <span>📚 All Documents</span>
            <span className="badge">{documents.filter((d) => !d.is_archived).length}</span>
          </button>

          <button
            className={`sidebar-nav-item ${filterCategory === 'favourites' ? 'active' : ''}`}
            onClick={() => handleSelectCategory('favourites')}
          >
            <span>⭐ Favourites</span>
            <span className="badge">{documents.filter((d) => d.is_favourite && !d.is_archived).length}</span>
          </button>

          <button
            className={`sidebar-nav-item ${filterCategory === 'recents' ? 'active' : ''}`}
            onClick={() => handleSelectCategory('recents')}
          >
            <span>🕒 Recents</span>
            <span className="badge">{documents.filter((d) => d.last_opened_at && !d.is_archived).length}</span>
          </button>

          <button
            className={`sidebar-nav-item ${filterCategory === 'archive' ? 'active' : ''}`}
            onClick={() => handleSelectCategory('archive')}
          >
            <span>📦 Archive</span>
            <span className="badge">{documents.filter((d) => d.is_archived).length}</span>
          </button>

          <button className={`sidebar-nav-item ${filterCategory === 'recently_removed' ? 'active' : ''}`} onClick={() => handleSelectCategory('recently_removed')}>
            <span>🗑 Recently Removed</span>
            <span className="badge">{removedDocuments.length}</span>
          </button>
        </div>

        <hr className="divider" />

        {/* Collections Section */}
        <div className="sidebar-section">
          <div className="section-header-row">
            <h4>COLLECTIONS</h4>
            <button
              className="icon-button micro"
              onClick={() => setCollectionManagerOpen(true)}
              title="Manage collections"
            >
              ⚙️
            </button>
          </div>

          {collections.length === 0 ? (
            <p className="dimmed micro">No collections created.</p>
          ) : (
            collections.map((col) => (
              <button
                key={col.id}
                className={`sidebar-nav-item ${filterCategory === 'collection' && selectedCollection === col.name ? 'active' : ''}`}
                onClick={() => handleSelectCollection(col.name)}
              >
                <span>📁 {col.name}</span>
                <span className="badge">
                  {documents.filter((d) => !d.is_archived && d.collections?.includes(col.name)).length}
                </span>
              </button>
            ))
          )}

          <button
            className="button secondary compact block add-col-btn"
            onClick={() => setCollectionManagerOpen(true)}
          >
            + New Collection
          </button>
        </div>

        <hr className="divider" />

        {/* Tags Section */}
        <div className="sidebar-section">
          <h4>TAGS</h4>
          {availableTags.length === 0 ? (
            <p className="dimmed micro">No tags defined.</p>
          ) : (
            <div className="tags-cloud">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  className={`tag-pill ${filterCategory === 'tag' && selectedTag === tag ? 'selected' : ''}`}
                  onClick={() => handleSelectTag(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="library-main">
        {/* Top Control Bar */}
        <header className="library-header">
          <div className="header-left">
            <h2>
              {filterCategory === 'all' && 'All Documents'}
              {filterCategory === 'favourites' && '⭐ Favourite Documents'}
              {filterCategory === 'recents' && '🕒 Recently Opened'}
              {filterCategory === 'archive' && '📦 Archived Documents'}
              {filterCategory === 'recently_removed' && '🗑 Recently Removed'}
              {filterCategory === 'collection' && `📁 Collection: ${selectedCollection ?? ''}`}
              {filterCategory === 'tag' && `# Tag: ${selectedTag ?? ''}`}
            </h2>
            <span className="dimmed micro">Showing {filteredDocs.length} of {allRecords.length} records</span>
          </div>

          <div className="header-actions">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="input-field search-input"
                placeholder="Search title, author, tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>

            <div className="sort-controls">
              <label className="dimmed micro" htmlFor="sort-by-select">Sort by:</label>
              <select
                id="sort-by-select"
                className="input-field select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as LibrarySortField)}
              >
                <option value="title">Title</option>
                <option value="date_added">Date Added</option>
                <option value="last_opened">Last Opened</option>
                <option value="page_count">Page Count</option>
              </select>

              <button
                className="icon-button sort-order-btn"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                title={`Sort order: ${sortOrder.toUpperCase()}`}
              >
                {sortOrder === 'asc' ? '▲' : '▼'}
              </button>
            </div>

            <div className="layout-toggle">
              <button
                className={`icon-button ${viewLayout === 'grid' ? 'active' : ''}`}
                onClick={() => setViewLayout('grid')}
                title="Grid view"
              >
                ▤
              </button>
              <button
                className={`icon-button ${viewLayout === 'list' ? 'active' : ''}`}
                onClick={() => setViewLayout('list')}
                title="List view"
              >
                ☰
              </button>
            </div>

            <button className="button secondary compact" onClick={onOpenJobQueue} title="Background jobs">
              ⚙️ Jobs {activeJobsCount > 0 && <span className="badge running">{activeJobsCount}</span>}
            </button>

            <button className="button primary compact" onClick={onOpenPdf}>
              Open PDF
            </button>
            <button className="button secondary compact" onClick={onOpenImportModal}>
              Import a copy
            </button>
          </div>
        </header>

        {/* Document Grid / List Container */}
        {filteredDocs.length === 0 ? (
          documents.length === 0 ? (
            <EmptyState viewType="library" onPrimaryAction={onOpenPdf} onSecondaryAction={onOpenImportModal} />
          ) : (
            <EmptyState
              viewType="search"
              context={{ searchQuery }}
              onPrimaryAction={() => setSearchQuery('')}
              onSecondaryAction={onOpenImportModal}
            />
          )
        ) : (
          <div className={`documents-container view-${viewLayout}`}>
            {filteredDocs.map((doc) => (
              <div key={doc.id} className="document-card">
                <div className="card-top-row">
                  <span className="doc-type-icon">📄</span>
                  <div className="card-header-text">
                    <h3 className="doc-title" title={doc.title} onClick={() => !doc.removed_at && onOpenDocument(doc)}>
                      {doc.title}
                    </h3>
                    {doc.author && <span className="doc-author">{doc.author}</span>}
                  </div>

                  <button
                    className={`fav-star-button ${doc.is_favourite ? 'active' : ''}`}
                    onClick={() => onToggleFavourite(doc.id, Boolean(doc.is_favourite))}
                    title={doc.is_favourite ? 'Unmark favourite' : 'Mark as favourite'}
                  >
                    {doc.is_favourite ? '★' : '☆'}
                  </button>
                </div>

                <div className="card-meta-details">
                  <span className="meta-item">{doc.page_count} pages</span>
                  {doc.doi && <span className="meta-item doi-tag">DOI: {doc.doi}</span>}
                  <span className="meta-item ownership-tag">{doc.ownership_mode}</span>
                </div>

                {/* Tags and Collections Badges */}
                {((doc.tags && doc.tags.length > 0) || (doc.collections && doc.collections.length > 0)) && (
                  <div className="badges-row">
                    {doc.collections?.map((col) => (
                      <span key={col} className="collection-badge">📁 {col}</span>
                    ))}
                    {doc.tags?.map((tag) => (
                      <span key={tag} className="tag-badge">#{tag}</span>
                    ))}
                  </div>
                )}

                <div className="card-bottom-bar">
                  <span className="fingerprint-hash" title={`SHA-256: ${doc.sha256_hash}`}>
                    SHA: {doc.sha256_hash.substring(0, 10)}...
                  </span>

                  <div className="card-action-buttons">
                    {doc.removed_at ? <>
                      <button className="button secondary micro" onClick={() => onRestoreDocument(doc.id)}>Restore</button>
                      <button className="button primary micro" onClick={() => onPurgeDocument(doc)}>Permanently Delete</button>
                    </> : <>
                    <button
                      className="button secondary micro"
                      onClick={() => onToggleArchive(doc.id, Boolean(doc.is_archived))}
                      title={doc.is_archived ? 'Unarchive' : 'Archive'}
                    >
                      {doc.is_archived ? 'Unarchive' : 'Archive'}
                    </button>

                    <button
                      className="button secondary micro"
                      onClick={() => setEditingDoc(doc)}
                      title="Edit Metadata (FR-7.4)"
                    >
                      ✏️ Edit
                    </button>

                    <button
                      className="button primary micro"
                      onClick={() => onOpenDocument(doc)}
                    >
                      Read
                    </button>
                    </>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Metadata Editor Modal */}
      {editingDoc && (
        <MetadataEditorModal
          isOpen={Boolean(editingDoc)}
          document={editingDoc}
          collectionsList={collections}
          onClose={() => setEditingDoc(null)}
          onSave={(updated) => {
            onUpdateDocument(updated);
            setEditingDoc(null);
          }}
        />
      )}

      {/* Collection Manager Modal */}
      {collectionManagerOpen && (
        <CollectionManagerModal
          isOpen={collectionManagerOpen}
          collections={collections}
          onClose={() => setCollectionManagerOpen(false)}
          onUpdateCollections={onUpdateCollections}
        />
      )}
    </div>
  );
}
