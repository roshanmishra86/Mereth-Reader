import { describe, it, expect } from 'vitest';
import {
  filterDocuments,
  sortDocuments,
  extractAllUniqueTags,
  createCollection,
  renameCollection,
  deleteCollection,
  addDocumentToCollection,
  removeDocumentFromCollection,
  addTagToDocument,
  removeTagFromDocument,
  CollectionItem,
} from './libraryUtils';
import { createDocumentRecord, DocumentRecord } from './pdfImport';

describe('libraryUtils', () => {
  const sampleDocs: DocumentRecord[] = [
    {
      ...createDocumentRecord({
        id: 'doc-1',
        title: 'Cognitive Load Theory',
        filepath: '/path/doc1.pdf',
        sha256_hash: 'hash-1',
        page_count: 24,
        ownership_mode: 'open_in_place',
      }),
      is_favourite: true,
      is_archived: false,
      last_opened_at: '2026-08-05T10:00:00Z',
      tags: ['Cognition', 'Education'],
      collections: ['Psychology'],
      author: 'John Sweller',
    },
    {
      ...createDocumentRecord({
        id: 'doc-2',
        title: 'Deep Learning Review',
        filepath: '/path/doc2.pdf',
        sha256_hash: 'hash-2',
        page_count: 50,
        ownership_mode: 'managed_library',
      }),
      is_favourite: false,
      is_archived: false,
      last_opened_at: '2026-08-06T04:00:00Z',
      tags: ['AI', 'Neural Nets'],
      collections: ['Computer Science'],
      author: 'Yann LeCun',
    },
    {
      ...createDocumentRecord({
        id: 'doc-3',
        title: 'Archived Paper',
        filepath: '/path/doc3.pdf',
        sha256_hash: 'hash-3',
        page_count: 10,
        ownership_mode: 'open_in_place',
      }),
      is_favourite: true,
      is_archived: true,
      last_opened_at: '2026-07-01T00:00:00Z',
      tags: ['Old'],
      collections: [],
    },
  ];

  it('filters documents by category: favourites, recents, archive, all', () => {
    const favs = filterDocuments(sampleDocs, { category: 'favourites' });
    expect(favs.length).toBe(1);
    expect(favs[0].id).toBe('doc-1');

    const recents = filterDocuments(sampleDocs, { category: 'recents' });
    expect(recents.length).toBe(2);

    const archived = filterDocuments(sampleDocs, { category: 'archive' });
    expect(archived.length).toBe(1);
    expect(archived[0].id).toBe('doc-3');

    const allActive = filterDocuments(sampleDocs, { category: 'all' });
    expect(allActive.length).toBe(2);
  });

  it('filters documents by collection and tag', () => {
    const psychDocs = filterDocuments(sampleDocs, { category: 'collection', collectionName: 'Psychology' });
    expect(psychDocs.length).toBe(1);
    expect(psychDocs[0].id).toBe('doc-1');

    const aiDocs = filterDocuments(sampleDocs, { category: 'tag', tagName: 'AI' });
    expect(aiDocs.length).toBe(1);
    expect(aiDocs[0].id).toBe('doc-2');
  });

  it('sorts documents by title, page_count, date_added, and last_opened', () => {
    const sortedByTitle = sortDocuments(sampleDocs, 'title', 'asc');
    expect(sortedByTitle[0].title).toBe('Archived Paper');

    const sortedByPageCountDesc = sortDocuments(sampleDocs, 'page_count', 'desc');
    expect(sortedByPageCountDesc[0].page_count).toBe(50);
  });

  it('extracts all unique tags across documents in alphabetical order', () => {
    const tags = extractAllUniqueTags(sampleDocs);
    expect(tags).toEqual(['AI', 'Cognition', 'Education', 'Neural Nets', 'Old']);
  });

  it('manages collections: create, rename, delete', () => {
    let collections: CollectionItem[] = [];
    const newCol = createCollection('Neuroscience', 'Study of brain functions');
    collections.push(newCol);
    expect(collections.length).toBe(1);

    collections = renameCollection(collections, newCol.id, 'Cognitive Neuroscience');
    expect(collections.find((c) => c.name === 'Neuroscience')).toBeUndefined();
    expect(collections[0].name).toBe('Cognitive Neuroscience');

    collections = deleteCollection(collections, newCol.id);
    expect(collections.length).toBe(0);
  });

  it('adds and removes collections and tags on document record', () => {
    let doc = sampleDocs[0];
    doc = addDocumentToCollection(doc, 'Neuroscience');
    expect(doc.collections).toContain('Neuroscience');

    doc = removeDocumentFromCollection(doc, 'Psychology');
    expect(doc.collections).not.toContain('Psychology');

    doc = addTagToDocument(doc, 'Important');
    expect(doc.tags).toContain('Important');

    doc = removeTagFromDocument(doc, 'Cognition');
    expect(doc.tags).not.toContain('Cognition');
  });
});
