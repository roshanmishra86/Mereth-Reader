import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderInlineMarkdown,
  renderMarkdownToHtml,
  sanitizeUrl,
} from './markdownRenderer';

describe('markdownRenderer utility (Task 4.3)', () => {
  describe('HTML escaping and sanitization', () => {
    it('escapes special HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml("Foo & Bar 'Quote'")).toBe('Foo &amp; Bar &#39;Quote&#39;');
    });

    it('sanitizes unsafe URI schemes', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
      expect(sanitizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
      expect(sanitizeUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
      expect(sanitizeUrl('mereth://note/abc-123')).toBe('mereth://note/abc-123');
      expect(sanitizeUrl('/relative/path')).toBe('/relative/path');
      expect(sanitizeUrl('#anchor')).toBe('#anchor');

      expect(sanitizeUrl('javascript:alert(1)')).toBe('#blocked-uri');
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#blocked-uri');
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#blocked-uri');
    });
  });

  describe('Inline markdown rendering', () => {
    it('renders bold, italic, and strikethrough', () => {
      expect(renderInlineMarkdown('**bold text**')).toContain('<strong class="md-bold">bold text</strong>');
      expect(renderInlineMarkdown('*italic text*')).toContain('<em class="md-italic">italic text</em>');
      expect(renderInlineMarkdown('~~strikethrough~~')).toContain('<del class="md-del">strikethrough</del>');
      expect(renderInlineMarkdown('***bold and italic***')).toContain(
        '<strong class="md-bold"><em class="md-italic">bold and italic</em></strong>'
      );
    });

    it('renders inline code and escapes code content', () => {
      const html = renderInlineMarkdown('Run `npm run <test>` to test');
      expect(html).toContain('<code class="md-code-inline">npm run &lt;test&gt;</code>');
    });

    it('renders inline math without mangling math formulas', () => {
      const html = renderInlineMarkdown('The formula is $E = mc^2$ in physics.');
      expect(html).toContain('<span class="md-math-inline" data-math="E = mc^2">$E = mc^2$</span>');
    });

    it('renders wiki-links to mereth note deep links', () => {
      const html = renderInlineMarkdown('Refer to [[note-123|Core Findings]] for details.');
      expect(html).toContain(
        '<a href="mereth://note/note-123" class="wiki-link" data-note-id="note-123">Core Findings</a>'
      );

      const htmlSelf = renderInlineMarkdown('See [[concept-note-456]]');
      expect(htmlSelf).toContain(
        '<a href="mereth://note/concept-note-456" class="wiki-link" data-note-id="concept-note-456">concept-note-456</a>'
      );
    });

    it('renders standard links and prevents XSS', () => {
      const safeLink = renderInlineMarkdown('[Mereth Docs](https://mereth.org/docs)');
      expect(safeLink).toContain(
        '<a href="https://mereth.org/docs" class="md-link" target="_blank" rel="noopener noreferrer">Mereth Docs</a>'
      );

      const xssLink = renderInlineMarkdown('[Attack](javascript:stealTokens())');
      expect(xssLink).toContain('<a href="#blocked-uri"');
    });

    it('renders images with sanitized sources', () => {
      const img = renderInlineMarkdown('![Figure 1](/assets/fig1.png)');
      expect(img).toContain('<img src="/assets/fig1.png" alt="Figure 1" class="md-image" />');
    });
  });

  describe('Block markdown rendering', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdownToHtml('')).toBe('');
      expect(renderMarkdownToHtml('   \n  \n  ')).toBe('');
    });

    it('renders headings from h1 to h6', () => {
      const md = '# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<h1 class="md-h1">Heading 1</h1>');
      expect(html).toContain('<h2 class="md-h2">Heading 2</h2>');
      expect(html).toContain('<h3 class="md-h3">Heading 3</h3>');
      expect(html).toContain('<h4 class="md-h4">Heading 4</h4>');
      expect(html).toContain('<h5 class="md-h5">Heading 5</h5>');
      expect(html).toContain('<h6 class="md-h6">Heading 6</h6>');
    });

    it('renders blockquotes and nested blockquotes', () => {
      const md = '> First quote line\n> Second quote line';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<blockquote class="md-blockquote">');
      expect(html).toContain('First quote line');
      expect(html).toContain('Second quote line');
    });

    it('renders fenced code blocks with language indicators', () => {
      const md = '```typescript\nconst message: string = "Hello, world!";\nconsole.log(message);\n```';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<pre class="md-code-block" data-language="typescript"><code class="language-typescript">');
      expect(html).toContain('const message: string = &quot;Hello, world!&quot;;');
    });

    it('renders math blocks', () => {
      const md = '$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<div class="md-math-block"');
      expect(html).toContain('\\int_{0}^{\\infty}');
    });

    it('renders task lists with completed and pending states', () => {
      const md = '- [ ] Review literature\n- [x] Write summary\n* [ ] Plan experiment';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<ul class="md-task-list">');
      expect(html).toContain('<li class="md-task-item"><input type="checkbox" disabled class="md-task-checkbox" /> <span>Review literature</span></li>');
      expect(html).toContain('<li class="md-task-item completed"><input type="checkbox" disabled checked class="md-task-checkbox" /> <span>Write summary</span></li>');
      expect(html).toContain('<li class="md-task-item"><input type="checkbox" disabled class="md-task-checkbox" /> <span>Plan experiment</span></li>');
    });

    it('renders unordered and ordered lists', () => {
      const unorderedMd = '- Item Alpha\n* Item Beta\n+ Item Gamma';
      const uHtml = renderMarkdownToHtml(unorderedMd);
      expect(uHtml).toContain('<ul class="md-unordered-list">');
      expect(uHtml).toContain('<li class="md-list-item">Item Alpha</li>');
      expect(uHtml).toContain('<li class="md-list-item">Item Beta</li>');

      const orderedMd = '1. Step One\n2. Step Two\n3. Step Three';
      const oHtml = renderMarkdownToHtml(orderedMd);
      expect(oHtml).toContain('<ol class="md-ordered-list">');
      expect(oHtml).toContain('<li class="md-ordered-item">Step One</li>');
      expect(oHtml).toContain('<li class="md-ordered-item">Step Two</li>');
    });

    it('renders tables with header formatting and column alignments', () => {
      const md = '| Title | Role | Retention |\n| :--- | :---: | ---: |\n| Note 1 | Concept | 90% |\n| Note 2 | Source | 85% |';
      const html = renderMarkdownToHtml(md);
      expect(html).toContain('<table class="md-table">');
      expect(html).toContain('<th class="md-table-head" style="text-align: left;">Title</th>');
      expect(html).toContain('<th class="md-table-head" style="text-align: center;">Role</th>');
      expect(html).toContain('<th class="md-table-head" style="text-align: right;">Retention</th>');
      expect(html).toContain('<td class="md-table-cell" style="text-align: left;">Note 1</td>');
      expect(html).toContain('<td class="md-table-cell" style="text-align: center;">Concept</td>');
      expect(html).toContain('<td class="md-table-cell" style="text-align: right;">90%</td>');
    });

    it('renders horizontal rules', () => {
      expect(renderMarkdownToHtml('---')).toContain('<hr class="md-hr" />');
      expect(renderMarkdownToHtml('***')).toContain('<hr class="md-hr" />');
      expect(renderMarkdownToHtml('___')).toContain('<hr class="md-hr" />');
    });

    it('prevents script injection and XSS inside documents', () => {
      const maliciousMd = '# Note Title\n\n<script>alert("pwned")</script>\n\n<img src="x" onerror="alert(1)">\n\n[Click me](javascript:alert(1))';
      const html = renderMarkdownToHtml(maliciousMd);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
      expect(html).not.toContain('<img src="x"');
      expect(html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
      expect(html).toContain('href="#blocked-uri"');
    });
  });
});
