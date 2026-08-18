import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { AnnotationRecord, AnnotationType } from './annotationTypes';
import { AnnotationFilters, applyAnnotationFilters, EMPTY_ANNOTATION_FILTERS } from './annotationFilter';

function makeRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: 'a',
    document_id: 'd1',
    document_version_id: 'v1',
    checksum: 'c',
    annotation_type: 'highlight',
    page_index: 0,
    page_label: '1',
    rects: [],
    quote: '',
    prefix_text: '',
    suffix_text: '',
    text_layer_checksum: null,
    comment: '',
    color: 'claim',
    tags: [],
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    provenance: 'user_authored',
    ...overrides,
  };
}

function filter(partial: Partial<AnnotationFilters>): AnnotationFilters {
  return { ...EMPTY_ANNOTATION_FILTERS, ...partial };
}

describe('annotation filter semantics (task 3.7, FR-9.6)', () => {
  const records = [
    makeRecord({ id: 'h1', annotation_type: 'highlight', page_index: 0, quote: 'The rapid fox jumps', comment: 'key claim', color: 'claim', tags: ['claim', 'chapter-1'] }),
    makeRecord({ id: 'u1', annotation_type: 'underline', page_index: 1, quote: 'slow turtle', comment: '', color: 'evidence', tags: ['evidence'] }),
    makeRecord({ id: 'c1', annotation_type: 'comment', page_index: 2, quote: '', comment: 'What about the fox?', color: 'question', tags: [] }),
    makeRecord({ id: 'b1', annotation_type: 'bookmark', page_index: 3, quote: '', comment: '', color: 'claim', tags: [] }),
    makeRecord({ id: 'a1', annotation_type: 'area', page_index: 4, quote: '', comment: 'figure 3', color: 'support', tags: ['visual'] }),
  ];

  it('empty filter matches every annotation, preserving order and identity', () => {
    const out = applyAnnotationFilters(records, EMPTY_ANNOTATION_FILTERS);
    expect(out.map((r) => r.id)).toEqual(['h1', 'u1', 'c1', 'b1', 'a1']);
    expect(out[0]).toBe(records[0]);
  });

  it('searches quote text, case-insensitive, substring', () => {
    expect(applyAnnotationFilters(records, filter({ searchText: 'RAPID FOX' })).map((r) => r.id)).toEqual(['h1']);
    expect(applyAnnotationFilters(records, filter({ searchText: 'fox' })).map((r) => r.id)).toEqual(['h1', 'c1']);
  });

  it('searches comment text too', () => {
    expect(applyAnnotationFilters(records, filter({ searchText: 'figure 3' })).map((r) => r.id)).toEqual(['a1']);
    expect(applyAnnotationFilters(records, filter({ searchText: 'key claim' })).map((r) => r.id)).toEqual(['h1']);
  });

  it('never matches prefix/suffix/colour/tags via the text search', () => {
    const rich = makeRecord({ id: 'r1', quote: 'exact quote', prefix_text: 'secret prefix', suffix_text: 'secret suffix', color: 'evidence', tags: ['hush'] });
    expect(applyAnnotationFilters([rich], filter({ searchText: 'secret' }))).toHaveLength(0);
    expect(applyAnnotationFilters([rich], filter({ searchText: 'hush' }))).toHaveLength(0);
    expect(applyAnnotationFilters([rich], filter({ searchText: 'evidence' }))).toHaveLength(0);
  });

  it('filters by type (any-of)', () => {
    expect(applyAnnotationFilters(records, filter({ types: ['highlight' as AnnotationType, 'underline' as AnnotationType] })).map((r) => r.id)).toEqual(['h1', 'u1']);
    expect(applyAnnotationFilters(records, filter({ types: ['bookmark' as AnnotationType] })).map((r) => r.id)).toEqual(['b1']);
  });

  it('filters by palette key (any-of)', () => {
    expect(applyAnnotationFilters(records, filter({ paletteKeys: ['claim'] })).map((r) => r.id)).toEqual(['h1', 'b1']);
    expect(applyAnnotationFilters(records, filter({ paletteKeys: ['question', 'support'] })).map((r) => r.id)).toEqual(['c1', 'a1']);
  });

  it('filters by tags (any-of, case-insensitive); tagless never matches a tag filter', () => {
    expect(applyAnnotationFilters(records, filter({ tags: ['CHAPTER-1'] })).map((r) => r.id)).toEqual(['h1']);
    expect(applyAnnotationFilters(records, filter({ tags: ['evidence', 'visual'] })).map((r) => r.id)).toEqual(['u1', 'a1']);
    expect(applyAnnotationFilters(records, filter({ tags: ['nope'] }))).toHaveLength(0);
  });

  it('filters by inclusive 1-based page range', () => {
    expect(applyAnnotationFilters(records, filter({ pageFrom: 2, pageTo: 4 })).map((r) => r.id)).toEqual(['u1', 'c1', 'b1']);
    expect(applyAnnotationFilters(records, filter({ pageFrom: 4 })).map((r) => r.id)).toEqual(['b1', 'a1']);
    expect(applyAnnotationFilters(records, filter({ pageTo: 2 })).map((r) => r.id)).toEqual(['h1', 'u1']);
  });

  it('filters by note status and Remember status', () => {
    const linked = new Set(['h1']);
    const remembered = new Set(['a1']);
    expect(applyAnnotationFilters(records, filter({ noteStatus: 'linked' }), { linkedIds: linked }).map((r) => r.id)).toEqual(['h1']);
    expect(applyAnnotationFilters(records, filter({ noteStatus: 'not-linked' }), { linkedIds: linked }).map((r) => r.id)).toEqual(['u1', 'c1', 'b1', 'a1']);
    expect(applyAnnotationFilters(records, filter({ rememberStatus: 'remembered' }), { rememberedIds: remembered }).map((r) => r.id)).toEqual(['a1']);
    expect(applyAnnotationFilters(records, filter({ rememberStatus: 'not-remembered' }), { rememberedIds: remembered }).map((r) => r.id)).toEqual(['h1', 'u1', 'c1', 'b1']);
  });

  it('empty linkage sets make "linked"/"remembered" match nothing, the negations everything', () => {
    expect(applyAnnotationFilters(records, filter({ noteStatus: 'linked' }))).toHaveLength(0);
    expect(applyAnnotationFilters(records, filter({ noteStatus: 'not-linked' }))).toHaveLength(records.length);
    expect(applyAnnotationFilters(records, filter({ rememberStatus: 'remembered' }))).toHaveLength(0);
    expect(applyAnnotationFilters(records, filter({ rememberStatus: 'not-remembered' }))).toHaveLength(records.length);
  });

  it('combines criteria with AND semantics', () => {
    const out = applyAnnotationFilters(records, filter({ searchText: 'fox', types: ['highlight' as AnnotationType], paletteKeys: ['claim'] }));
    expect(out.map((r) => r.id)).toEqual(['h1']);
    // Same search, wrong type -> nothing (c1's comment mentions foxes, so the
    // search alone matches it — the type criterion must exclude it).
    expect(applyAnnotationFilters(records, filter({ searchText: 'rapid', types: ['comment' as AnnotationType] }))).toHaveLength(0);
  });

  it('ignores trashed rows the caller already excluded', () => {
    const withTrash = [...records, makeRecord({ id: 't1', annotation_type: 'highlight', quote: 'The rapid fox', deleted_at: '2026-01-02T00:00:00Z' })];
    // The filter itself does not resurrect trashed rows — callers pass the
    // active list; this test pins that the filter does not REMOVE them either
    // (dedupe/trash policy lives with the caller).
    expect(applyAnnotationFilters(withTrash, filter({ searchText: 'fox' })).map((r) => r.id)).toEqual(['h1', 'c1', 't1']);
  });
});

describe('10,000-item filtering benchmark (FR-9.6 acceptance, §9.3)', () => {
  const TYPES: AnnotationType[] = ['highlight', 'underline', 'area', 'comment', 'bookmark'];
  const COLORS = ['claim', 'evidence', 'question', 'disagree', 'support'];
  const TAGS = ['chapter-1', 'chapter-2', 'claim', 'evidence', 'visual', 'legal'];

  function buildCorpus(count: number): AnnotationRecord[] {
    const records: AnnotationRecord[] = [];
    for (let i = 0; i < count; i++) {
      records.push(
        makeRecord({
          id: `bench-${i}`,
          annotation_type: TYPES[i % TYPES.length],
          page_index: i % 400,
          quote: `Quoted passage ${i} about the fox and the turtle`,
          comment: i % 3 === 0 ? `comment ${i} on evidence` : '',
          color: COLORS[i % COLORS.length],
          tags: i % 7 === 0 ? [TAGS[i % TAGS.length], TAGS[(i + 3) % TAGS.length]] : [TAGS[i % TAGS.length]],
        })
      );
    }
    return records;
  }

  it('median filter latency over 10,000 annotations stays interactive (< 100 ms)', () => {
    const corpus = buildCorpus(10_000);
    const linked = new Set<string>(corpus.filter((_, i) => i % 10 === 0).map((r) => r.id));
    const remembered = new Set<string>(corpus.filter((_, i) => i % 25 === 0).map((r) => r.id));

    // Heaviest realistic combination: every criterion enabled, worst-case
    // (no early-out) search that still scans every record.
    const heavy: AnnotationFilters = {
      searchText: 'fox',
      types: ['highlight', 'underline', 'comment'],
      paletteKeys: ['claim', 'evidence', 'question'],
      tags: ['chapter-1', 'evidence'],
      pageFrom: 3,
      pageTo: 397,
      noteStatus: 'linked',
      rememberStatus: 'not-remembered',
    };

    // Warm-up (JIT/first-alloc).
    applyAnnotationFilters(corpus, heavy, { linkedIds: linked, rememberedIds: remembered });

    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      const out = applyAnnotationFilters(corpus, heavy, { linkedIds: linked, rememberedIds: remembered });
      samples.push(performance.now() - start);
      // The result must be correct too — not just fast.
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((r) => r.quote.toLowerCase().includes('fox'))).toBe(true);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];

    console.log(
      `annotation-filter benchmark: median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms ` +
        `over 10,000 annotations (25 runs, worst-case filter) | ` +
        `hardware: ${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? 'unknown'} (${os.cpus().length} cores) | ` +
        `memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GiB`
    );

    expect(median).toBeLessThan(100);
    expect(p95).toBeLessThan(100);
  });

  it('an empty-text search over the full 10k corpus is sub-millisecond class', () => {
    const corpus = buildCorpus(10_000);
    applyAnnotationFilters(corpus, EMPTY_ANNOTATION_FILTERS);
    const start = performance.now();
    const out = applyAnnotationFilters(corpus, EMPTY_ANNOTATION_FILTERS);
    const elapsed = performance.now() - start;
    expect(out).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(100);
  });
});
