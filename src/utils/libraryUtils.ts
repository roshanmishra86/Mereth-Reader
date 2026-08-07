/**
 * Library & Organization Utilities for Mereth Reader (PRD FR-7.5).
 * Filters, sorting, favourites, collections, tags, recents, and archive status management.
 * Strict TypeScript without `any` types.
 */

import { DocumentRecord } from './pdfImport';

export type LibraryFilterCategory = 'all' | 'favourites' | 'recents' | 'archive' | 'collection' | 'tag';
export type LibrarySortField = 'title' | 'date_added' | 'last_opened' | 'page_count';
export type LibrarySortOrder = 'asc' | 'desc';

export interface CollectionItem {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface LibraryFilterOptions {
  category: LibraryFilterCategory;
  collectionName?: string;
  tagName?: string;
  searchQuery?: string;
}

/**
 * Filters document list according to selected category (favourites, recents, archive, collection, tag) and search query.
 */
export function filterDocuments(
  documents: DocumentRecord[],
  options: LibraryFilterOptions
): DocumentRecord[] {
  const query = options.searchQuery ? options.searchQuery.trim().toLowerCase() : '';

  return documents.filter((doc) => {
    // 1. Search Query filter (matches title, author, subject, tags, collections, filepath)
    if (query) {
      const matchTitle = doc.title.toLowerCase().includes(query);
      const matchAuthor = doc.author ? doc.author.toLowerCase().includes(query) : false;
      const matchSubject = doc.subject ? doc.subject.toLowerCase().includes(query) : false;
      const matchFilepath = doc.filepath.toLowerCase().includes(query);
      const matchTags = doc.tags ? doc.tags.some((t) => t.toLowerCase().includes(query)) : false;
      const matchCollections = doc.collections ? doc.collections.some((c) => c.toLowerCase().includes(query)) : false;

      if (!matchTitle && !matchAuthor && !matchSubject && !matchFilepath && !matchTags && !matchCollections) {
        return false;
      }
    }

    // 2. Category Filter
    switch (options.category) {
      case 'favourites':
        return Boolean(doc.is_favourite) && !doc.is_archived;

      case 'recents':
        return Boolean(doc.last_opened_at) && !doc.is_archived;

      case 'archive':
        return Boolean(doc.is_archived);

      case 'collection':
        if (!options.collectionName) return !doc.is_archived;
        return (
          !doc.is_archived &&
          Boolean(doc.collections && doc.collections.includes(options.collectionName))
        );

      case 'tag':
        if (!options.tagName) return !doc.is_archived;
        return !doc.is_archived && Boolean(doc.tags && doc.tags.includes(options.tagName));

      case 'all':
      default:
        return !doc.is_archived;
    }
  });
}

/**
 * Sorts document records by specified field and order.
 */
export function sortDocuments(
  documents: DocumentRecord[],
  sortBy: LibrarySortField,
  sortOrder: LibrarySortOrder = 'asc'
): DocumentRecord[] {
  const sorted = [...documents].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'title':
        comparison = a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
        break;

      case 'date_added':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;

      case 'last_opened': {
        const timeA = a.last_opened_at ? new Date(a.last_opened_at).getTime() : 0;
        const timeB = b.last_opened_at ? new Date(b.last_opened_at).getTime() : 0;
        comparison = timeA - timeB;
        break;
      }

      case 'page_count':
        comparison = a.page_count - b.page_count;
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

/**
 * Extracts all unique tags from a list of documents in alphabetical order.
 */
export function extractAllUniqueTags(documents: DocumentRecord[]): string[] {
  const tagSet = new Set<string>();
  for (const doc of documents) {
    if (doc.tags && Array.isArray(doc.tags)) {
      for (const tag of doc.tags) {
        if (tag && tag.trim()) {
          tagSet.add(tag.trim());
        }
      }
    }
  }
  return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
}

/**
 * Collection management helpers (create, rename, delete, add document to collection, remove document from collection).
 */
export function createCollection(name: string, description?: string): CollectionItem {
  const now = new Date().toISOString();
  return {
    id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim(),
    description: description ? description.trim() : undefined,
    created_at: now,
  };
}

export function renameCollection(collections: CollectionItem[], id: string, newName: string): CollectionItem[] {
  return collections.map((col) => {
    if (col.id === id) {
      return { ...col, name: newName.trim() };
    }
    return col;
  });
}

export function deleteCollection(collections: CollectionItem[], id: string): CollectionItem[] {
  return collections.filter((col) => col.id !== id);
}

export function addDocumentToCollection(doc: DocumentRecord, collectionName: string): DocumentRecord {
  const currentCols = doc.collections ? [...doc.collections] : [];
  if (!currentCols.includes(collectionName)) {
    currentCols.push(collectionName);
  }
  return { ...doc, collections: currentCols };
}

export function removeDocumentFromCollection(doc: DocumentRecord, collectionName: string): DocumentRecord {
  const currentCols = doc.collections ? doc.collections.filter((c) => c !== collectionName) : [];
  return { ...doc, collections: currentCols };
}

export function addTagToDocument(doc: DocumentRecord, tag: string): DocumentRecord {
  const cleanTag = tag.trim();
  if (!cleanTag) return doc;
  const currentTags = doc.tags ? [...doc.tags] : [];
  if (!currentTags.includes(cleanTag)) {
    currentTags.push(cleanTag);
  }
  return { ...doc, tags: currentTags };
}

export function removeTagFromDocument(doc: DocumentRecord, tag: string): DocumentRecord {
  const currentTags = doc.tags ? doc.tags.filter((t) => t !== tag) : [];
  return { ...doc, tags: currentTags };
}
