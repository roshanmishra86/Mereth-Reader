import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CollectionItem, createCollection } from '../utils/libraryUtils';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface CollectionManagerModalProps {
  isOpen: boolean;
  collections: CollectionItem[];
  onClose: () => void;
  onUpdateCollections: (collections: CollectionItem[]) => void;
}

export function CollectionManagerModal({
  isOpen,
  collections,
  onClose,
  onUpdateCollections,
}: CollectionManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    if (collections.some((c) => c.name.toLowerCase() === newName.trim().toLowerCase())) {
      setError(`A collection named "${newName.trim()}" already exists.`);
      return;
    }

    setError(null);
    const item = createCollection(newName, newDesc);

    try {
      await invoke('db_add_collection', { collection: item });
    } catch {
      // Dev mode fallback
    }

    onUpdateCollections([...collections, item]);
    setNewName('');
    setNewDesc('');
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    setError(null);

    try {
      await invoke('db_rename_collection', { id, name: editName.trim() });
    } catch {
      // Dev mode fallback
    }

    const updated = collections.map((col) => (col.id === id ? { ...col, name: editName.trim() } : col));
    onUpdateCollections(updated);
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the collection "${name}"?`)) {
      return;
    }

    try {
      await invoke('db_delete_collection', { id });
    } catch {
      // Dev mode fallback
    }

    const filtered = collections.filter((c) => c.id !== id);
    onUpdateCollections(filtered);
  };

  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="sheet collection-manager-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-header">
          <h3 id="collection-manager-title">Collection Manager (FR-7.5)</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close manager">✕</button>
        </header>

        <div className="sheet-body">
          {error && <div className="banner warning">{error}</div>}

          <form onSubmit={handleCreate} className="create-collection-form">
            <h4>Create New Collection</h4>
            <div className="form-row">
              <input
                type="text"
                className="input-field"
                placeholder="Collection Name (e.g. Cognitive Science)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <input
                type="text"
                className="input-field"
                placeholder="Description (Optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <button type="submit" className="button primary compact">
                + Create
              </button>
            </div>
          </form>

          <hr className="divider" />

          <h4>Existing Collections ({collections.length})</h4>

          {collections.length === 0 ? (
            <p className="dimmed">No collections created yet. Create one above to organize your documents.</p>
          ) : (
            <div className="collections-list">
              {collections.map((col) => (
                <div key={col.id} className="collection-row">
                  {editingId === col.id ? (
                    <div className="edit-collection-box">
                      <input
                        type="text"
                        className="input-field"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <button className="button primary micro" onClick={() => handleRename(col.id)}>Save</button>
                      <button className="button secondary micro" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="col-info">
                        <strong>📁 {col.name}</strong>
                        {col.description && <span className="dimmed micro">{col.description}</span>}
                      </div>
                      <div className="col-actions">
                        <button
                          className="button secondary micro"
                          onClick={() => {
                            setEditingId(col.id);
                            setEditName(col.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="button danger micro"
                          onClick={() => handleDelete(col.id, col.name)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <button className="button secondary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
