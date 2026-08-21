/**
 * Note template parsing, front-matter serialization, and citation generation (PRD R3, Tasks 4.0 / 4.3).
 *
 * Implements the decisions recorded in ADR R3.0:
 * - OQ-11: Structured YAML front matter and default templates for source, concept, scratch, and evidence blocks.
 * - OQ-12: Human-readable citations with deep links without external runtime CSL engine dependencies.
 */

export type NoteType = 'source' | 'concept' | 'scratch';
export type TemplateType = 'source' | 'concept' | 'scratch' | 'evidence_block';

export interface NoteFrontMatter {
  id?: string;
  title: string;
  type: NoteType;
  created_at?: string;
  updated_at?: string;
  document_id?: string;
  source_title?: string;
  source_author?: string;
  source_year?: number;
  doi?: string;
  tags: string[];
  provenance?: string;
}

export type TemplateVariableValue = string | number | string[] | undefined | null;
export type TemplateVariableMap = Record<string, TemplateVariableValue>;

export const DEFAULT_SOURCE_TEMPLATE = `---
title: "{{title}}"
type: "source"
document_id: "{{document_id}}"
source_title: "{{source_title}}"
source_author: "{{source_author}}"
source_year: {{source_year}}
doi: "{{doi}}"
tags: {{tags_json}}
---

# Source Note: {{title}}

**Reference:** {{citation_formatted}}
**Document:** [Open in Mereth Reader]({{mereth_document_url}})

## Summary & Core Claims
- 

## Evidence & Key Passages
{{evidence_blocks}}
`;

export const DEFAULT_CONCEPT_TEMPLATE = `---
title: "{{title}}"
type: "concept"
tags: {{tags_json}}
---

# {{title}}

## Core Thesis


## Supporting Evidence & Arguments


## Open Questions & Backlinks
- 
`;

export const DEFAULT_SCRATCH_TEMPLATE = `---
title: "{{title}}"
type: "scratch"
tags: []
---

# Scratch: {{title}}


`;

export const DEFAULT_EVIDENCE_BLOCK_TEMPLATE = `> {{quote}}
> — {{citation_formatted}} [Mereth Link]({{mereth_annotation_url}})

{{comment}}
`;

/**
 * Returns the default template string for a given template type.
 */
export function getDefaultTemplate(type: TemplateType): string {
  switch (type) {
    case 'source':
      return DEFAULT_SOURCE_TEMPLATE;
    case 'concept':
      return DEFAULT_CONCEPT_TEMPLATE;
    case 'scratch':
      return DEFAULT_SCRATCH_TEMPLATE;
    case 'evidence_block':
      return DEFAULT_EVIDENCE_BLOCK_TEMPLATE;
  }
}

/**
 * Renders a template string by replacing `{{key}}` placeholders with values from `vars`.
 * Handles array values by formatting as JSON if key ends with `_json`, or comma-separated list otherwise.
 */
export function renderTemplate(template: string, vars: TemplateVariableMap): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      return '';
    }
    if (Array.isArray(value)) {
      if (key.endsWith('_json')) {
        return JSON.stringify(value);
      }
      return value.join(', ');
    }
    return String(value);
  });
}

/**
 * Formats an academic / human-readable citation string (OQ-12).
 * Format: "Author (Year), p. X" or fallback to "Title, p. X".
 */
export function formatCitation(
  author?: string,
  year?: number | string,
  pageLabel?: string,
  fallbackTitle?: string
): string {
  const cleanAuthor = author?.trim();
  const cleanYear = year ? String(year).trim() : '';
  const cleanPage = pageLabel?.trim();
  const cleanTitle = fallbackTitle?.trim();

  let baseRef = '';
  if (cleanAuthor && cleanYear) {
    baseRef = `${cleanAuthor} (${cleanYear})`;
  } else if (cleanAuthor) {
    baseRef = cleanAuthor;
  } else if (cleanTitle) {
    baseRef = cleanYear ? `${cleanTitle} (${cleanYear})` : cleanTitle;
  } else {
    baseRef = 'Source document';
  }

  if (cleanPage) {
    return `${baseRef}, p. ${cleanPage}`;
  }
  return baseRef;
}

/**
 * Builds a valid `mereth://` URI deep link (PRD §14.2).
 */
export function buildMerethDeepLink(
  kind: 'document' | 'note' | 'review',
  id: string,
  params?: { page?: string | number; annotation?: string }
): string {
  const base = `mereth://${kind}/${encodeURIComponent(id)}`;
  if (!params) {
    return base;
  }
  const searchParams = new URLSearchParams();
  if (params.page !== undefined && params.page !== null && params.page !== '') {
    searchParams.set('page', String(params.page));
  }
  if (params.annotation) {
    searchParams.set('annotation', params.annotation);
  }
  const qs = searchParams.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Formats a single evidence block into Markdown with citation and deep link.
 */
export function formatEvidenceBlockMarkdown(params: {
  quote: string;
  author?: string;
  year?: number | string;
  pageLabel?: string;
  fallbackTitle?: string;
  annotationUrl?: string;
  comment?: string;
}): string {
  const citation = formatCitation(params.author, params.year, params.pageLabel, params.fallbackTitle);
  const quoteLines = params.quote.trim().split('\n').map((line) => `> ${line}`).join('\n');
  const linkText = params.annotationUrl ? ` [Mereth Link](${params.annotationUrl})` : '';
  const attribution = `> — ${citation}${linkText}`;
  const commentText = params.comment?.trim() ? `\n\n${params.comment.trim()}` : '';

  return `${quoteLines}\n${attribution}${commentText}`;
}

/**
 * Parses front matter from a Markdown document string.
 * Extracts YAML between `---` boundaries and returns the parsed metadata and body.
 */
export function parseNoteFrontMatter(content: string): {
  frontMatter: Partial<NoteFrontMatter>;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontMatter: {}, body: content };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontMatter: {}, body: content };
  }

  const rawYaml = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trimStart();
  const frontMatter: Partial<NoteFrontMatter> = {};

  const lines = rawYaml.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let rawVal = line.slice(colonIndex + 1).trim();

    // Strip quotes if wrapped
    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      rawVal = rawVal.slice(1, -1);
    }

    if (key === 'tags') {
      try {
        if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
          const parsed = JSON.parse(rawVal) as unknown;
          if (Array.isArray(parsed)) {
            frontMatter.tags = parsed.map((item) => String(item));
          }
        } else if (rawVal) {
          frontMatter.tags = rawVal.split(',').map((t) => t.trim()).filter(Boolean);
        } else {
          frontMatter.tags = [];
        }
      } catch {
        frontMatter.tags = [];
      }
    } else if (key === 'source_year') {
      const parsedNum = parseInt(rawVal, 10);
      if (!Number.isNaN(parsedNum)) {
        frontMatter.source_year = parsedNum;
      }
    } else if (key === 'type') {
      if (rawVal === 'source' || rawVal === 'concept' || rawVal === 'scratch') {
        frontMatter.type = rawVal;
      }
    } else if (key === 'title') {
      frontMatter.title = rawVal;
    } else if (key === 'id') {
      frontMatter.id = rawVal;
    } else if (key === 'document_id') {
      frontMatter.document_id = rawVal;
    } else if (key === 'source_title') {
      frontMatter.source_title = rawVal;
    } else if (key === 'source_author') {
      frontMatter.source_author = rawVal;
    } else if (key === 'doi') {
      frontMatter.doi = rawVal;
    } else if (key === 'created_at') {
      frontMatter.created_at = rawVal;
    } else if (key === 'updated_at') {
      frontMatter.updated_at = rawVal;
    } else if (key === 'provenance') {
      frontMatter.provenance = rawVal;
    }
  }

  return { frontMatter, body };
}

/**
 * Serializes a note record with front matter into Markdown text.
 */
export function serializeNoteWithFrontMatter(frontMatter: NoteFrontMatter, body: string): string {
  const lines: string[] = ['---'];
  if (frontMatter.id) lines.push(`id: "${frontMatter.id}"`);
  lines.push(`title: "${frontMatter.title.replace(/"/g, '\\"')}"`);
  lines.push(`type: "${frontMatter.type}"`);
  if (frontMatter.created_at) lines.push(`created_at: "${frontMatter.created_at}"`);
  if (frontMatter.updated_at) lines.push(`updated_at: "${frontMatter.updated_at}"`);
  if (frontMatter.document_id) lines.push(`document_id: "${frontMatter.document_id}"`);
  if (frontMatter.source_title) lines.push(`source_title: "${frontMatter.source_title.replace(/"/g, '\\"')}"`);
  if (frontMatter.source_author) lines.push(`source_author: "${frontMatter.source_author.replace(/"/g, '\\"')}"`);
  if (frontMatter.source_year !== undefined) lines.push(`source_year: ${frontMatter.source_year}`);
  if (frontMatter.doi) lines.push(`doi: "${frontMatter.doi}"`);
  lines.push(`tags: ${JSON.stringify(frontMatter.tags ?? [])}`);
  if (frontMatter.provenance) lines.push(`provenance: "${frontMatter.provenance}"`);
  lines.push('---');
  lines.push('');

  return `${lines.join('\n')}${body.trimStart()}`;
}
