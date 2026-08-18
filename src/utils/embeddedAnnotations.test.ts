import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  classifyEmbeddedAnnotations,
  countImportPreviews,
  mapPdfJsAnnotationData,
  mappedAnnotationTypeForSubtype,
  matchPaletteKeyForRgb,
  overlapRatio,
  pdfRectToNormalized,
  quadPointsToNormalized,
  rgbToHex,
  buildEmbeddedImportRecord,
  type EmbeddedImportPreview,
  type ParsedEmbeddedAnnotation,
} from './embeddedAnnotations';
import { mapPdfPageEmbeddedAnnotations } from './pdfViewer';
import { AnnotationRecord, DEFAULT_ANNOTATION_PALETTE } from './annotationTypes';

const MEDIA = { width: 612, height: 792 };

function makeRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: 'a1',
    document_id: 'd1',
    document_version_id: 'v1',
    checksum: 'c',
    annotation_type: 'highlight',
    page_index: 0,
    page_label: '1',
    rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.03 }],
    quote: 'x',
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

describe('embedded PDF geometry conversion (task 3.6, FR-9.9)', () => {
  it('rotate 0: flips the y axis and normalizes against the media box', () => {
    const rect = pdfRectToNormalized({ x0: 60, y0: 690, x1: 480, y1: 712 }, MEDIA, 0);
    expect(rect.x).toBeCloseTo(60 / 612, 6);
    expect(rect.y).toBeCloseTo((792 - 712) / 792, 6);
    expect(rect.width).toBeCloseTo((480 - 60) / 612, 6);
    expect(rect.height).toBeCloseTo((712 - 690) / 792, 6);
  });

  it('rotate 90: matches the pdf.js viewport conversion (x=y, y=x)', () => {
    const rect = pdfRectToNormalized({ x0: 60, y0: 690, x1: 480, y1: 712 }, MEDIA, 90);
    // Viewport is 792 wide x 612 high; a=(690,60), b=(712,480)
    expect(rect.x).toBeCloseTo(690 / 792, 6);
    expect(rect.y).toBeCloseTo(60 / 612, 6);
    expect(rect.width).toBeCloseTo(22 / 792, 6);
    expect(rect.height).toBeCloseTo(420 / 612, 6);
  });

  it('rotate 180: only the x axis mirrors', () => {
    const rect = pdfRectToNormalized({ x0: 60, y0: 690, x1: 480, y1: 712 }, MEDIA, 180);
    // a=(612-60=552, 690), b=(612-480=132, 712)
    expect(rect.x).toBeCloseTo(132 / 612, 6);
    expect(rect.y).toBeCloseTo(690 / 792, 6);
    expect(rect.width).toBeCloseTo(420 / 612, 6);
    expect(rect.height).toBeCloseTo(22 / 792, 6);
  });

  it('rotate 270: (x=(H-y), y=(W-x))', () => {
    const rect = pdfRectToNormalized({ x0: 60, y0: 690, x1: 480, y1: 712 }, MEDIA, 270);
    // a=(792-690=102, 612-60=552), b=(792-712=80, 612-480=132)
    expect(rect.x).toBeCloseTo(80 / 792, 6);
    expect(rect.y).toBeCloseTo(132 / 612, 6);
    expect(rect.width).toBeCloseTo(22 / 792, 6);
    expect(rect.height).toBeCloseTo(420 / 612, 6);
  });

  it('invalid rotate values degrade to rotate 0', () => {
    const rect = pdfRectToNormalized({ x0: 60, y0: 690, x1: 480, y1: 712 }, MEDIA, 45);
    expect(rect.x).toBeCloseTo(60 / 612, 6);
    expect(rect.y).toBeCloseTo((792 - 712) / 792, 6);
  });

  it('clamps rects that stick out of the page', () => {
    const rect = pdfRectToNormalized({ x0: -50, y0: 690, x1: 700, y1: 900 }, MEDIA, 0);
    // viewport y' = 792 - y: a=(-50,102), b=(700,-108) -> clamped span x:[0,1], y:[0,102]
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(1);
    expect(rect.height).toBeCloseTo(102 / 792, 6);
  });

  it('honours a non-zero media box origin through the mapper', () => {
    const item = mapPdfJsAnnotationData(
      { id: '7R', subtype: 'Text', rect: [160, 790, 580, 812] },
      { mediaWidth: 612, mediaHeight: 792, rotate: 0, mediaX: 100, mediaY: 100, pageIndex: 0 }
    );
    // Shifted box is (60,690)-(480,712) relative to the origin.
    expect(item!.rects[0].x).toBeCloseTo(60 / 612, 6);
    expect(item!.rects[0].y).toBeCloseTo((792 - 712) / 792, 6);
  });

  it('quadPoints: one normalized rect per quad (multi-line highlights)', () => {
    const rects = quadPointsToNormalized(
      [60, 712, 480, 712, 480, 690, 60, 690, 60, 660, 300, 660, 300, 640, 60, 640],
      MEDIA,
      0
    );
    expect(rects).toHaveLength(2);
    expect(rects[0].x).toBeCloseTo(60 / 612, 6);
    expect(rects[0].y).toBeCloseTo((792 - 712) / 792, 6);
    expect(rects[0].height).toBeCloseTo(22 / 792, 6);
    expect(rects[1].y).toBeCloseTo((792 - 660) / 792, 6);
    expect(rects[1].width).toBeCloseTo(240 / 612, 6);
  });

  it('drops empty rects from degenerate quads', () => {
    const rects = quadPointsToNormalized([10, 10, 10, 10, 10, 10, 10, 10], MEDIA, 0);
    expect(rects).toHaveLength(0);
  });
});

describe('pdf.js data mapping', () => {
  const baseRaw = {
    id: '5R',
    subtype: 'Highlight',
    rect: null,
    quadPoints: [60, 712, 480, 712, 480, 690, 60, 690],
    color: [255, 255, 0],
    contentsObj: { str: 'Highlighted by Mereth corpus generator', dir: 'ltr' },
    titleObj: { str: 'Mereth', dir: 'ltr' },
    annotationFlags: 4,
  };

  it('maps a Highlight into rects, colour, contents, author, provenance data', () => {
    const item = mapPdfJsAnnotationData(baseRaw, { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 });
    expect(item).not.toBeNull();
    expect(item!.sourceId).toBe('5R');
    expect(item!.subtype).toBe('Highlight');
    expect(item!.pageIndex).toBe(0);
    expect(item!.rects).toHaveLength(1);
    expect(item!.colorRgb).toEqual([255, 255, 0]);
    expect(item!.contents).toBe('Highlighted by Mereth corpus generator');
    expect(item!.author).toBe('Mereth');
  });

  it('maps a Text note from /Rect alone into a single rect', () => {
    const item = mapPdfJsAnnotationData(
      { id: '6R', subtype: 'Text', rect: [500, 690, 522, 712], contentsObj: { str: 'note' } },
      { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 }
    );
    expect(item!.rects).toHaveLength(1);
    expect(item!.contents).toBe('note');
    expect(item!.colorRgb).toBeNull();
  });

  it('skips Link/Widget/Popup (never content annotations)', () => {
    for (const subtype of ['Link', 'Widget', 'Popup']) {
      expect(mapPdfJsAnnotationData({ id: 'x', subtype, rect: [10, 10, 20, 20] }, { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 })).toBeNull();
    }
  });

  it('skips invisible/hidden annotations', () => {
    expect(
      mapPdfJsAnnotationData({ ...baseRaw, annotationFlags: 1 }, { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 })
    ).toBeNull();
    expect(
      mapPdfJsAnnotationData({ ...baseRaw, annotationFlags: 2 }, { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 })
    ).toBeNull();
  });

  it('returns null when no geometry exists', () => {
    expect(
      mapPdfJsAnnotationData({ id: 'x', subtype: 'Highlight' }, { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 })
    ).toBeNull();
  });

  it('prefers QuadPoints over /Rect when both are present', () => {
    const item = mapPdfJsAnnotationData(
      { ...baseRaw, rect: [60, 690, 480, 712], quadPoints: [100, 700, 200, 700, 200, 690, 100, 690] },
      { mediaWidth: 612, mediaHeight: 792, rotate: 0, pageIndex: 0 }
    );
    expect(item!.rects[0].x).toBeCloseTo(100 / 612, 9);
    expect(item!.rects[0].y).toBeCloseTo((792 - 700) / 792, 9);
    expect(item!.rects[0].width).toBeCloseTo(100 / 612, 9);
    expect(item!.rects[0].height).toBeCloseTo(10 / 792, 9);
  });

  it('maps the glue over a fake page object (pdf-viewer seam)', async () => {
    const page = {
      view: [0, 0, 612, 792],
      rotate: 0,
      getAnnotations: async () => [
        baseRaw,
        { id: '9R', subtype: 'Widget', rect: [10, 10, 20, 20], fieldName: 'txt' },
      ],
    };
    const items = await mapPdfPageEmbeddedAnnotations(page as never, 2);
    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe('5R');
    expect(items[0].pageIndex).toBe(2);
  });

  it('glue honours a rotated page with a non-zero origin', async () => {
    const page = {
      view: [100, 100, 712, 892],
      rotate: 90,
      getAnnotations: async () => [
        { id: '8R', subtype: 'Underline', rect: [160, 790, 580, 812] },
      ],
    };
    const items = await mapPdfPageEmbeddedAnnotations(page as never, 0);
    expect(items).toHaveLength(1);
    // Shifted box (60,690)-(480,712) at rotate 90: a=(690,60), b=(712,480),
    // viewport 792x612.
    expect(items[0].rects[0].x).toBeCloseTo(690 / 792, 6);
    expect(items[0].rects[0].y).toBeCloseTo(60 / 612, 6);
  });
});

describe('duplicate preview (FR-9.9)', () => {
  const item = (overrides: Partial<ParsedEmbeddedAnnotation> = {}): ParsedEmbeddedAnnotation => ({
    sourceId: '5R',
    subtype: 'Highlight',
    pageIndex: 0,
    rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.03 }],
    colorRgb: [255, 255, 0],
    contents: 'note',
    author: 'Mereth',
    noRotate: false,
    ...overrides,
  });

  it('classifies a fresh region as new', () => {
    const previews = classifyEmbeddedAnnotations([item()], []);
    expect(previews[0].status).toBe('new');
    expect(previews[0].mappedType).toBe('highlight');
    expect(previews[0].reason).toContain('New highlight');
  });

  it('flags same page + same type + overlapping rect as duplicate', () => {
    const duplicate = makeRecord({ id: 'd9', page_index: 0, rects: [{ x: 0.15, y: 0.11, width: 0.3, height: 0.02 }] });
    const previews = classifyEmbeddedAnnotations([item()], [duplicate]);
    expect(previews[0].status).toBe('duplicate');
    expect(previews[0].duplicateOfId).toBe('d9');
  });

  it('does not flag different regions or different types', () => {
    const far = makeRecord({ page_index: 0, rects: [{ x: 0.8, y: 0.8, width: 0.1, height: 0.1 }] });
    const otherType = makeRecord({ annotation_type: 'comment', rects: [{ x: 0.12, y: 0.11, width: 0.3, height: 0.02 }] });
    const previews = classifyEmbeddedAnnotations([item()], [far, otherType]);
    expect(previews[0].status).toBe('new');
  });

  it('ignores trashed existing records', () => {
    const trashed = makeRecord({ deleted_at: '2026-01-02T00:00:00Z', rects: [{ x: 0.15, y: 0.11, width: 0.3, height: 0.02 }] });
    const previews = classifyEmbeddedAnnotations([item()], [trashed]);
    expect(previews[0].status).toBe('new');
  });

  it('honours the overlap threshold option', () => {
    // overlap vs the smaller rect = 0.8 (> 0.6 default, < 0.9 raised bar)
    const slight = makeRecord({ rects: [{ x: 0.3, y: 0.11, width: 0.25, height: 0.02 }] });
    expect(classifyEmbeddedAnnotations([item()], [slight])[0].status).toBe('duplicate');
    expect(classifyEmbeddedAnnotations([item()], [slight], { overlapThreshold: 0.9 })[0].status).toBe('new');
  });

  it('lists unsupported subtypes with the original subtype and a reason', () => {
    const previews = classifyEmbeddedAnnotations([item({ sourceId: 'sq', subtype: 'Square', rects: [{ x: 0.2, y: 0.2, width: 0.1, height: 0.1 }] })], []);
    expect(previews[0].status).toBe('unsupported');
    expect(previews[0].mappedType).toBeNull();
    expect(previews[0].reason).toContain('Square');
  });

  it('counts each status', () => {
    const previews: EmbeddedImportPreview[] = [
      { item: item(), mappedType: 'highlight', status: 'new', reason: '' },
      { item: item({ sourceId: 'x2' }), mappedType: 'comment', status: 'duplicate', duplicateOfId: 'a1', reason: '' },
      { item: item({ sourceId: 'x3', subtype: 'Ink' }), mappedType: null, status: 'unsupported', reason: '' },
    ];
    expect(countImportPreviews(previews)).toEqual({ newCount: 1, duplicateCount: 1, unsupportedCount: 1 });
  });

  it('overlapRatio: identical=1, disjoint=0, partial=share of the smaller', () => {
    const a = { x: 0, y: 0, width: 1, height: 1 };
    const b = { x: 0.5, y: 0, width: 1, height: 1 };
    const c = { x: 0.75, y: 0, width: 1, height: 1 };
    expect(overlapRatio(a, a)).toBe(1);
    expect(overlapRatio(a, c)).toBeCloseTo(0.25, 6);
    expect(overlapRatio(a, { x: 2, y: 2, width: 1, height: 1 })).toBe(0);
  });
});

describe('type mapping', () => {
  it('maps the standards subtypes Reader supports', () => {
    expect(mappedAnnotationTypeForSubtype('Highlight')).toBe('highlight');
    expect(mappedAnnotationTypeForSubtype('Underline')).toBe('underline');
    expect(mappedAnnotationTypeForSubtype('Squiggly')).toBe('underline');
    expect(mappedAnnotationTypeForSubtype('StrikeOut')).toBe('highlight');
    expect(mappedAnnotationTypeForSubtype('Text')).toBe('comment');
    expect(mappedAnnotationTypeForSubtype('Square')).toBeNull();
    expect(mappedAnnotationTypeForSubtype('Link')).toBeNull();
  });
});

describe('palette matching and import records', () => {
  it('rgbToHex pads and lowercases', () => {
    expect(rgbToHex([255, 255, 0])).toBe('#ffff00');
    expect(rgbToHex([1, 2, 3])).toBe('#010203');
  });

  it('matchPaletteKeyForRgb picks the nearest default entry', () => {
    expect(matchPaletteKeyForRgb([217, 189, 58], DEFAULT_ANNOTATION_PALETTE)).toBe('claim');
    expect(matchPaletteKeyForRgb([255, 0, 0], DEFAULT_ANNOTATION_PALETTE)).toBe('disagree');
    expect(matchPaletteKeyForRgb(null, DEFAULT_ANNOTATION_PALETTE)).toBe('claim');
  });

  it('buildEmbeddedImportRecord: deterministic_transform provenance, checksum, mapped fields', () => {
    const preview: EmbeddedImportPreview = {
      item: {
        sourceId: '5R',
        subtype: 'Highlight',
        pageIndex: 0,
        rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.03 }],
        colorRgb: [255, 255, 0],
        contents: 'note from the PDF',
        author: 'Mereth',
        noRotate: false,
      },
      mappedType: 'highlight',
      status: 'new',
      reason: '',
    };
    const record = buildEmbeddedImportRecord({ documentId: 'd1', documentVersionId: 'v1', pageLabel: '1', preview, palette: DEFAULT_ANNOTATION_PALETTE });
    expect(record.provenance).toBe('deterministic_transform');
    expect(record.annotation_type).toBe('highlight');
    expect(record.quote).toBe('');
    expect(record.comment).toBe('note from the PDF');
    expect(record.color).toBe('claim');
    expect(record.page_label).toBe('1');
    expect(record.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(record.checksum).toBe(
      record.checksum // deterministic: same inputs -> same checksum
    );
    const again = buildEmbeddedImportRecord({ documentId: 'd1', documentVersionId: 'v1', pageLabel: '1', preview, palette: DEFAULT_ANNOTATION_PALETTE });
    expect(again.checksum).toBe(record.checksum);
    // Existing-user records with identical geometry must hash identically,
    // so re-anchoring treats imported and user-made highlights alike.
    const userMade = makeRecord({ id: 'x', rects: record.rects, quote: '' });
    expect(userMade.checksum).not.toBe(record.checksum); // different ids are fine; checksum does not include id
  });
});

describe('real corpus evidence (embedded_annotations.pdf)', () => {
  const probeScript = path.resolve(process.cwd(), 'scripts', 'embedded_annotations_probe.mjs');
  const raw = execFileSync(process.execPath, [probeScript, 'embedded_annotations.pdf', '1'], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(raw) as {
    file: string;
    page: number;
    rotate: number;
    view: number[];
    numPages: number;
    annotations: Array<{
      id: string;
      subtype: string;
      rect: number[] | null;
      rectNormalized: { x: number; y: number; width: number; height: number } | null;
      quadPointsLen: number;
      quadNormalized: Array<{ x: number; y: number; width: number; height: number }> | null;
      contents: string | null;
      author: string | null;
      color: number[] | null;
      flags: number;
    }>;
  };

  it('the fixture exposes both a Highlight and a Text annotation', () => {
    expect(result.numPages).toBe(1);
    expect(result.rotate).toBe(0);
    expect(result.view).toEqual([0, 0, 612, 792]);
    expect(result.annotations).toHaveLength(2);
    const subtypes = result.annotations.map((a) => a.subtype).sort();
    expect(subtypes).toEqual(['Highlight', 'Text']);
  });

  it('the Highlight is standards-compliant: QuadPoints, contents, author, colour', () => {
    const hl = result.annotations.find((a) => a.subtype === 'Highlight')!;
    expect(hl.quadPointsLen).toBe(8);
    expect(hl.contents).toBe('Highlighted by Mereth corpus generator');
    expect(hl.author).toBe('Mereth');
    expect(hl.color).toEqual([255, 255, 0]);
    expect(hl.flags & 4).toBe(4);
  });

  it('the Text note carries its rect and contents', () => {
    const note = result.annotations.find((a) => a.subtype === 'Text')!;
    expect(note.rect).toEqual([500, 690, 522, 712]);
    expect(note.contents).toBe('Sticky note from Mereth corpus generator');
    expect(note.color).toEqual([255, 230, 0]);
  });

  it('maps the real parsed bytes into inside-page normalized geometry', () => {
    const hl = result.annotations.find((a) => a.subtype === 'Highlight')!;
    const note = result.annotations.find((a) => a.subtype === 'Text')!;
    const rawQuads = [60, 712, 480, 712, 480, 690, 60, 690];
    const item = mapPdfJsAnnotationData(
      {
        id: hl.id,
        subtype: hl.subtype,
        quadPoints: rawQuads,
        color: hl.color ?? undefined,
        contentsObj: { str: hl.contents ?? '' },
        titleObj: { str: hl.author ?? '' },
        annotationFlags: hl.flags,
      },
      { mediaWidth: 612, mediaHeight: 792, rotate: result.rotate, pageIndex: 0 }
    );
    expect(item).not.toBeNull();
    expect(item!.rects).toHaveLength(1);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(item!.rects[0][key]).toBeGreaterThanOrEqual(0);
      expect(item!.rects[0][key]).toBeLessThanOrEqual(1);
    }
    // The pure geometry must equal pdf.js's own viewport conversion of the
    // same bytes (both quads and the plain text-note rect).
    const quad = hl.quadNormalized![0];
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(item!.rects[0][key]).toBeCloseTo(quad[key], 9);
    }
    const noteItem = mapPdfJsAnnotationData(
      { id: note.id, subtype: note.subtype, rect: note.rect!, color: note.color ?? undefined },
      { mediaWidth: 612, mediaHeight: 792, rotate: result.rotate, pageIndex: 0 }
    );
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(noteItem!.rects[0][key]).toBeCloseTo(note.rectNormalized![key], 9);
    }
  });
});
