import crypto from 'node:crypto';

export interface PermittedVariance {
  font_rendering_px?: number;
  reading_order_tolerance?: string;
  unicode_normalization?: string;
  glyph_fallback?: boolean;
  bidi_reordering?: boolean;
  ocr_confidence_min?: number;
  frame_rate_min_fps?: number;
  annotation_flattening?: boolean;
  form_field_interactivity?: string;
  strict_parsing?: boolean;
  prompt_on_load?: boolean;
  memory_limit_mb?: number;
  reanchor_fuzzy_threshold?: number;
}

export interface CorpusEntry {
  id: string;
  filename: string;
  category: string;
  source_licence: string;
  sha256: string;
  page_count: number;
  expected_capability: string;
  failure_mode: string | null;
  permitted_variance: PermittedVariance | 'none';
  visual_check: boolean;
  text_check: boolean;
  selection_check: boolean;
  anchor_check: boolean;
  memory_check: boolean;
  security_check: boolean;
}

export const REQUIRED_CORPUS_CATEGORIES = [
  'simple_text',
  'multi_column',
  'equations_ligatures',
  'cjk_text',
  'rtl_text',
  'scanned_page',
  'large_vector',
  'embedded_annotations',
  'forms_links',
  'malformed_object',
  'password_encrypted',
  'large_book',
  'version_v1_original',
  'version_v2_changed',
  'hostile_javascript'
] as const;

export function computeBufferSha256(buffer: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function validateCorpusManifest(entries: CorpusEntry[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (entries.length !== 15) {
    errors.push(`Expected 15 entries in corpus manifest, found ${entries.length}`);
  }

  const categoryMap = new Set<string>();
  for (const entry of entries) {
    if (!entry.id) errors.push(`Entry missing id: ${JSON.stringify(entry)}`);
    if (!entry.filename) errors.push(`Entry missing filename: ${entry.id}`);
    if (!entry.sha256 || entry.sha256.length !== 64) errors.push(`Invalid sha256 hash for ${entry.id}`);
    if (typeof entry.page_count !== 'number' || entry.page_count <= 0) errors.push(`Invalid page_count for ${entry.id}`);
    categoryMap.add(entry.category);
  }

  for (const cat of REQUIRED_CORPUS_CATEGORIES) {
    if (!categoryMap.has(cat)) {
      errors.push(`Missing required corpus category: ${cat}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
