import { describe, it, expect } from 'vitest';
import {
  buildPageGeometry,
  computeAnnotationVersionStatus,
  measurePdfPageGeometry,
  selectReanchorActions,
  StoredAnnotation,
} from './versionAnchoring';
import { calculateAnnotationChecksum } from './annotationOverlay';

const V1 = 'version-1';
const V2 = 'version-2';

function highlight(overrides: Partial<StoredAnnotation>): StoredAnnotation {
  return {
    id: 'ann-1',
    document_version_id: V1,
    annotation_type: 'highlight',
    page_index: 2, // zero-based page 3
    rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
    quote: 'the plaintiff moves for summary judgment',
    prefix_text: 'Here, ',
    suffix_text: ' on the merits.',
    ...overrides,
  };
}

describe('3.3 buildPageGeometry', () => {
  it('keeps valid ordered entries', () => {
    const out = buildPageGeometry(
      [
        { page: 1, width: 612, height: 792 },
        { page: 2, width: 612, height: 792 },
      ],
      3
    );
    expect(out).toEqual([
      { page: 1, width: 612, height: 792 },
      { page: 2, width: 612, height: 792 },
    ]);
  });

  it('drops invalid, out-of-range, and duplicate entries (first wins)', () => {
    const out = buildPageGeometry(
      [
        { page: 0, width: 612, height: 792 },      // page below 1
        { page: 4, width: 612, height: 792 },      // beyond page count
        { page: 1, width: NaN, height: 792 },      // NaN
        { page: 1, width: -5, height: 792 },       // negative
        { page: 2, width: 612, height: 0 },        // zero height
        { page: 2, width: 612, height: 792 },      // duplicate page (first wins)
        { page: 2.5, width: 612, height: 792 },    // non-integer page
        { page: 3, width: 300, height: 400 },
      ],
      3
    );
    expect(out).toEqual([
      { page: 2, width: 612, height: 792 },
      { page: 3, width: 300, height: 400 },
    ]);
  });
});

describe('3.3 measurePdfPageGeometry', () => {
  it('measures every page via the provider and skips unavailable sizes', async () => {
    const calls: number[] = [];
    const sizes = await measurePdfPageGeometry(4, async (page) => {
      calls.push(page);
      if (page === 3) return null; // page 3 measurement unavailable
      return { width: 100 * page, height: 200 * page };
    });
    expect(calls).toEqual([1, 2, 3, 4]);
    expect(sizes).toEqual([
      { page: 1, width: 100, height: 200 },
      { page: 2, width: 200, height: 400 },
      { page: 4, width: 400, height: 800 },
    ]);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    const sizes = await measurePdfPageGeometry(10, async (page) => {
      if (page === 3) controller.abort();
      return { width: 100, height: 200 };
    }, { signal: controller.signal });
    expect(sizes.length).toBeLessThan(10);
    // The page whose measurement was in flight when the signal fired still
    // lands in the result; everything after it is skipped.
    expect(sizes.every((s) => s.page >= 1 && s.page <= 3)).toBe(true);
  });
});

describe('3.3 selectReanchorActions', () => {
  const pageTexts = new Map<number, string>([
    [3, 'Here, the plaintiff moves for summary judgment on the merits.'],
    [5, 'Unrelated text on page six.'],
  ]);

  it('re-anchors quote-matched text annotations with a recomputed checksum', () => {
    const plan = selectReanchorActions({
      annotations: [highlight({})],
      newVersionId: V2,
      pageTextByNumber: pageTexts,
    });

    expect(plan.detached).toEqual([]);
    expect(plan.reanchor).toHaveLength(1);
    const action = plan.reanchor[0];
    expect(action.annotationId).toBe('ann-1');
    expect(action.newVersionId).toBe(V2);

    // The checksum must be the R0.4 checksum bound to the NEW version id.
    const expectedChecksum = calculateAnnotationChecksum(
      V2,
      2,
      'highlight',
      { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
      {
        prefix: 'Here, ',
        exactQuote: 'the plaintiff moves for summary judgment',
        suffix: ' on the merits.',
      }
    );
    expect(action.newChecksum).toBe(expectedChecksum);
    // And it must differ from the old-version binding.
    const v1Checksum = calculateAnnotationChecksum(
      V1,
      2,
      'highlight',
      { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
      {
        prefix: 'Here, ',
        exactQuote: 'the plaintiff moves for summary judgment',
        suffix: ' on the merits.',
      }
    );
    expect(action.newChecksum).not.toBe(v1Checksum);
  });

  it('treats underlines exactly like highlights', () => {
    const plan = selectReanchorActions({
      annotations: [highlight({ id: 'ann-underline', annotation_type: 'underline' })],
      newVersionId: V2,
      pageTextByNumber: pageTexts,
    });
    expect(plan.reanchor.map((a) => a.annotationId)).toEqual(['ann-underline']);
    expect(plan.detached).toEqual([]);
  });

  it('detaches text annotations whose quote no longer exists in the new version', () => {
    const plan = selectReanchorActions({
      annotations: [highlight({ id: 'ann-gone', quote: 'A sentence that vanished' })],
      newVersionId: V2,
      pageTextByNumber: pageTexts,
    });
    expect(plan.reanchor).toEqual([]);
    expect(plan.detached).toEqual(['ann-gone']);
  });

  it('detaches text annotations on pages not yet extracted (conservative)', () => {
    const plan = selectReanchorActions({
      annotations: [highlight({ id: 'ann-unextracted', page_index: 9 })],
      newVersionId: V2,
      pageTextByNumber: pageTexts,
    });
    expect(plan.reanchor).toEqual([]);
    expect(plan.detached).toEqual(['ann-unextracted']);
  });

  it('detaches non-text annotation types regardless of page text', () => {
    const annotations: StoredAnnotation[] = [
      highlight({ id: 'ann-bookmark', annotation_type: 'bookmark', quote: '' }),
      highlight({ id: 'ann-comment', annotation_type: 'comment', quote: '' }),
      highlight({ id: 'ann-area', annotation_type: 'area', quote: '' }),
    ];
    const plan = selectReanchorActions({ annotations, newVersionId: V2, pageTextByNumber: pageTexts });
    expect(plan.reanchor).toEqual([]);
    expect(plan.detached).toEqual(['ann-bookmark', 'ann-comment', 'ann-area']);
  });

  it('skips annotations already on the target version', () => {
    const plan = selectReanchorActions({
      annotations: [highlight({ id: 'ann-current', document_version_id: V2 })],
      newVersionId: V2,
      pageTextByNumber: pageTexts,
    });
    expect(plan.reanchor).toEqual([]);
    expect(plan.detached).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const annotations = [highlight({})];
    const before = JSON.stringify(annotations);
    selectReanchorActions({ annotations, newVersionId: V2, pageTextByNumber: pageTexts });
    expect(JSON.stringify(annotations)).toBe(before);
  });
});

describe('3.3 computeAnnotationVersionStatus', () => {
  it('is active only when the version ids match', () => {
    expect(computeAnnotationVersionStatus(V1, V1)).toBe('active');
    expect(computeAnnotationVersionStatus(V1, V2)).toBe('detached');
    expect(computeAnnotationVersionStatus(V1, null)).toBe('detached');
    expect(computeAnnotationVersionStatus(V1, undefined)).toBe('detached');
  });
});
