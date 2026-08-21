import { describe, it, expect } from 'vitest';
import {
  NoteFrontMatter,
  getDefaultTemplate,
  renderTemplate,
  formatCitation,
  buildMerethDeepLink,
  formatEvidenceBlockMarkdown,
  parseNoteFrontMatter,
  serializeNoteWithFrontMatter,
} from './noteTemplates';

describe('Note Templates and Front Matter (Task 4.0 / ADR R3.0)', () => {
  describe('renderTemplate', () => {
    it('interpolates simple string and number variables', () => {
      const template = 'Hello {{name}}, you have {{count}} items in {{location}}.';
      const result = renderTemplate(template, {
        name: 'Alice',
        count: 42,
        location: 'Library',
      });
      expect(result).toBe('Hello Alice, you have 42 items in Library.');
    });

    it('handles missing variables gracefully with empty strings', () => {
      const template = 'Title: {{title}} ({{year}}) - {{missing}}';
      const result = renderTemplate(template, {
        title: 'Cognitive Science',
        year: 2024,
      });
      expect(result).toBe('Title: Cognitive Science (2024) - ');
    });

    it('formats array variables as JSON when key ends with _json', () => {
      const template = 'tags: {{tags_json}}';
      const result = renderTemplate(template, {
        tags_json: ['testing', 'retrieval', 'memory'],
      });
      expect(result).toBe('tags: ["testing","retrieval","memory"]');
    });

    it('formats array variables as comma-separated string when key does not end with _json', () => {
      const template = 'Tags: {{tags}}';
      const result = renderTemplate(template, {
        tags: ['apple', 'banana', 'orange'],
      });
      expect(result).toBe('Tags: apple, banana, orange');
    });
  });

  describe('getDefaultTemplate', () => {
    it('returns valid templates for all four template types', () => {
      const sourceTpl = getDefaultTemplate('source');
      expect(sourceTpl).toContain('type: "source"');
      expect(sourceTpl).toContain('{{evidence_blocks}}');

      const conceptTpl = getDefaultTemplate('concept');
      expect(conceptTpl).toContain('type: "concept"');
      expect(conceptTpl).toContain('## Core Thesis');

      const scratchTpl = getDefaultTemplate('scratch');
      expect(scratchTpl).toContain('type: "scratch"');

      const evidenceTpl = getDefaultTemplate('evidence_block');
      expect(evidenceTpl).toContain('> {{quote}}');
      expect(evidenceTpl).toContain('{{citation_formatted}}');
    });
  });

  describe('formatCitation (OQ-12)', () => {
    it('formats standard Author (Year), p. Page citation', () => {
      const cit = formatCitation('Karpicke & Roediger', 2008, '249');
      expect(cit).toBe('Karpicke & Roediger (2008), p. 249');
    });

    it('formats citation without page number if omitted', () => {
      const cit = formatCitation('Baddeley', '1992');
      expect(cit).toBe('Baddeley (1992)');
    });

    it('falls back to title when author is missing', () => {
      const cit = formatCitation(undefined, 2021, '12', 'The Brain Architecture');
      expect(cit).toBe('The Brain Architecture (2021), p. 12');
    });

    it('falls back to generic label when author, year, and title are missing', () => {
      const cit = formatCitation(undefined, undefined, '5');
      expect(cit).toBe('Source document, p. 5');
    });
  });

  describe('buildMerethDeepLink (PRD §14.2)', () => {
    it('constructs document deep links with page and annotation queries', () => {
      const uri = buildMerethDeepLink('document', 'doc-123', {
        page: 42,
        annotation: 'ann-789',
      });
      expect(uri).toBe('mereth://document/doc-123?page=42&annotation=ann-789');
    });

    it('constructs note deep links without query parameters', () => {
      const uri = buildMerethDeepLink('note', 'note-abc');
      expect(uri).toBe('mereth://note/note-abc');
    });

    it('constructs review deep links', () => {
      const uri = buildMerethDeepLink('review', 'prompt-xyz');
      expect(uri).toBe('mereth://review/prompt-xyz');
    });
  });

  describe('formatEvidenceBlockMarkdown', () => {
    it('creates formatted blockquote with citation, link, and comment', () => {
      const md = formatEvidenceBlockMarkdown({
        quote: 'Testing produces better delayed retention than repeated study.',
        author: 'Roediger & Karpicke',
        year: 2006,
        pageLabel: '249',
        annotationUrl: 'mereth://document/doc-1?page=249&annotation=ann-1',
        comment: 'Key finding to connect with spaced repetition note.',
      });

      expect(md).toContain('> Testing produces better delayed retention than repeated study.');
      expect(md).toContain('> — Roediger & Karpicke (2006), p. 249 [Mereth Link](mereth://document/doc-1?page=249&annotation=ann-1)');
      expect(md).toContain('Key finding to connect with spaced repetition note.');
    });

    it('handles multiline quotes correctly', () => {
      const md = formatEvidenceBlockMarkdown({
        quote: 'Line 1 of quote.\nLine 2 of quote.',
        author: 'Author A',
        year: 2020,
      });
      expect(md).toContain('> Line 1 of quote.\n> Line 2 of quote.');
    });
  });

  describe('parseNoteFrontMatter and serializeNoteWithFrontMatter', () => {
    it('parses front matter YAML and body cleanly', () => {
      const sample = `---
id: "note-123"
title: "Testing enhances learning"
type: "concept"
created_at: "2026-08-21T00:00:00Z"
updated_at: "2026-08-21T01:00:00Z"
source_author: "Roediger"
source_year: 2006
tags: ["memory", "learning"]
provenance: "user_authored"
---

# Testing enhances learning

Here is the body content of the concept note.
`;

      const parsed = parseNoteFrontMatter(sample);
      expect(parsed.frontMatter.id).toBe('note-123');
      expect(parsed.frontMatter.title).toBe('Testing enhances learning');
      expect(parsed.frontMatter.type).toBe('concept');
      expect(parsed.frontMatter.source_year).toBe(2006);
      expect(parsed.frontMatter.tags).toEqual(['memory', 'learning']);
      expect(parsed.frontMatter.provenance).toBe('user_authored');
      expect(parsed.body).toContain('# Testing enhances learning');
      expect(parsed.body).toContain('Here is the body content of the concept note.');
    });

    it('handles documents without front matter', () => {
      const plainMd = '# Just a markdown note without frontmatter\n\nSome text.';
      const parsed = parseNoteFrontMatter(plainMd);
      expect(parsed.frontMatter).toEqual({});
      expect(parsed.body).toBe(plainMd);
    });

    it('round-trips serialization and parsing', () => {
      const initialFrontMatter: NoteFrontMatter = {
        id: 'note-xyz',
        title: 'Retrieval practice is generative',
        type: 'concept',
        created_at: '2026-08-21T00:00:00Z',
        updated_at: '2026-08-21T02:00:00Z',
        document_id: 'doc-456',
        source_title: 'The Power of Testing',
        source_author: 'Karpicke',
        source_year: 2012,
        doi: '10.1037/a0026368',
        tags: ['retrieval', 'generation'],
        provenance: 'user_authored',
      };
      const initialBody = '## Main Points\n- Point 1\n- Point 2\n';

      const serialized = serializeNoteWithFrontMatter(initialFrontMatter, initialBody);
      const reparsed = parseNoteFrontMatter(serialized);

      expect(reparsed.frontMatter.id).toBe(initialFrontMatter.id);
      expect(reparsed.frontMatter.title).toBe(initialFrontMatter.title);
      expect(reparsed.frontMatter.type).toBe(initialFrontMatter.type);
      expect(reparsed.frontMatter.source_author).toBe(initialFrontMatter.source_author);
      expect(reparsed.frontMatter.source_year).toBe(initialFrontMatter.source_year);
      expect(reparsed.frontMatter.tags).toEqual(initialFrontMatter.tags);
      expect(reparsed.frontMatter.doi).toBe(initialFrontMatter.doi);
      expect(reparsed.body).toBe(initialBody);
    });
  });
});
