/**
 * Outline tree parsing, named destination resolution, and page label utilities
 * for Mereth Reader navigation (PRD FR-8.1).
 * Strict TypeScript without `any`.
 */

import { OutlineItem } from './pdfUtils';

export interface ParsedOutlineNode {
  id: string;
  title: string;
  destName?: string;
  pageNumber?: number;
  level: number;
  children: ParsedOutlineNode[];
}

/**
 * Resolves a named destination or URI string to a target page number.
 */
export function resolveNamedDestination(
  dest: string | unknown[] | null | undefined,
  namedDestinations: Record<string, number> = {}
): number | null {
  if (!dest) return null;

  if (typeof dest === 'string') {
    const cleanDest = dest.trim();

    // Check if directly a number
    const num = Number(cleanDest);
    if (!Number.isNaN(num) && num > 0) {
      return num;
    }

    // Check query fragment like #page=5
    const pageMatch = cleanDest.match(/#page=(\d+)/i);
    if (pageMatch) {
      return Number(pageMatch[1]);
    }

    // Check dictionary of named destinations
    if (namedDestinations[cleanDest] !== undefined) {
      return namedDestinations[cleanDest];
    }
  }

  // If array dest format [pageRef, { name: 'XYZ' }, ...]
  if (Array.isArray(dest)) {
    for (const item of dest) {
      if (typeof item === 'number' && item > 0) {
        return item;
      }
      if (typeof item === 'object' && item !== null && 'num' in item) {
        const pageObj = item as { num: number };
        if (typeof pageObj.num === 'number') {
          return pageObj.num + 1; // 0-indexed to 1-indexed
        }
      }
    }
  }

  return null;
}

/**
 * Recursively parses raw PDF outline structure into a clean hierarchical tree.
 */
export function parseOutlineTree(
  items: OutlineItem[],
  namedDestinations: Record<string, number> = {},
  parentPath = 'node'
): ParsedOutlineNode[] {
  if (!items || items.length === 0) return [];

  return items.map((item, idx) => {
    const nodeId = `${parentPath}-${idx}`;
    let pageNumber = item.pageNumber;

    if (!pageNumber && item.dest) {
      const resolved = resolveNamedDestination(item.dest, namedDestinations);
      if (resolved) {
        pageNumber = resolved;
      }
    }

    const children = item.items
      ? parseOutlineTree(item.items, namedDestinations, nodeId)
      : [];

    return {
      id: nodeId,
      title: item.title || 'Untitled section',
      destName: typeof item.dest === 'string' ? item.dest : undefined,
      pageNumber,
      level: parentPath.split('-').length - 1,
      children,
    };
  });
}

/**
 * Converts a physical 1-based page index to Roman numerals if configured.
 */
export function toRomanNumeral(num: number): string {
  if (num <= 0 || num > 3999) return String(num);
  const lookup: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let result = '';
  let n = num;
  for (const [val, roman] of lookup) {
    while (n >= val) {
      result += roman;
      n -= val;
    }
  }
  return result;
}

export interface PageLabelMapping {
  customLabel?: string;
  style?: 'arabic' | 'roman-lower' | 'roman-upper';
}

/**
 * Formats user-facing page label vs physical page number (PRD FR-8.1).
 * E.g. "iii (p. 3)" or "249 / 12".
 */
export function formatExtendedPageLabel(
  physicalPage: number,
  totalPages: number,
  customLabels?: Record<number, PageLabelMapping>
): { displayLabel: string; physicalInfo: string; fullBadge: string } {
  const validPage = Math.max(1, Math.min(physicalPage, totalPages || 1));
  const mapping = customLabels?.[validPage];

  let displayLabel = String(validPage);

  if (mapping) {
    if (mapping.customLabel) {
      displayLabel = mapping.customLabel;
    } else if (mapping.style === 'roman-lower') {
      displayLabel = toRomanNumeral(validPage);
    } else if (mapping.style === 'roman-upper') {
      displayLabel = toRomanNumeral(validPage).toUpperCase();
    }
  }

  const physicalInfo = `${validPage} / ${totalPages}`;
  const fullBadge = displayLabel !== String(validPage)
    ? `${displayLabel} (p. ${validPage})`
    : `${validPage} / ${totalPages}`;

  return {
    displayLabel,
    physicalInfo,
    fullBadge,
  };
}
