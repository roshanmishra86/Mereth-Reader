/**
 * Task 3.5 — configurable semantic palette (PRD FR-9.3).
 *
 * The palette carries colour AND user label for every annotation key. It is
 * stored as one JSON setting (`annotation_palette`) through the existing
 * settings IPC; parse/validate are pure and unit-tested so a hand-edited or
 * corrupt setting value degrades to the shipped defaults instead of breaking
 * the UI.
 */

import { DEFAULT_ANNOTATION_PALETTE, PaletteEntry } from './annotationTypes';

export const ANNOTATION_PALETTE_SETTING_KEY = 'annotation_palette';

/** Bounds for a user-configured palette. */
export const MAX_PALETTE_ENTRIES = 12;
export const MIN_PALETTE_ENTRIES = 2;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isValidPaletteEntry(entry: unknown): entry is PaletteEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.key === 'string' &&
    KEY_RE.test(e.key) &&
    typeof e.color === 'string' &&
    HEX_COLOR_RE.test(e.color) &&
    typeof e.label === 'string' &&
    e.label.trim().length > 0 &&
    e.label.length <= 48
  );
}

/**
 * Validates a whole palette: bound size, unique keys, unique colours, every
 * entry individually valid.
 */
export function isValidPalette(value: unknown): value is PaletteEntry[] {
  if (!Array.isArray(value)) return false;
  if (value.length < MIN_PALETTE_ENTRIES || value.length > MAX_PALETTE_ENTRIES) return false;
  const keys = new Set<string>();
  const colors = new Set<string>();
  for (const entry of value) {
    if (!isValidPaletteEntry(entry)) return false;
    if (keys.has(entry.key) || colors.has(entry.color)) return false;
    keys.add(entry.key);
    colors.add(entry.color);
  }
  return true;
}

/** Serializes a valid palette to the stored setting value. */
export function serializePalette(palette: PaletteEntry[]): string {
  if (!isValidPalette(palette)) {
    throw new Error('Refusing to serialize an invalid palette');
  }
  return JSON.stringify(palette);
}

/**
 * Parses the stored setting value. Corrupt, invalid, or absent values fall
 * back to the shipped defaults — a bad setting must never break annotation
 * creation or rendering.
 */
export function parsePalette(raw: string | null | undefined): PaletteEntry[] {
  if (!raw) return DEFAULT_ANNOTATION_PALETTE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidPalette(parsed) ? parsed : DEFAULT_ANNOTATION_PALETTE;
  } catch {
    return DEFAULT_ANNOTATION_PALETTE;
  }
}

/** Resolves a palette key to an entry, or undefined (callers fall back). */
export function paletteEntryForKey(
  key: string,
  palette: PaletteEntry[]
): PaletteEntry | undefined {
  return palette.find((entry) => entry.key === key);
}
