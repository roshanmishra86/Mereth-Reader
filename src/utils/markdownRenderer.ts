/**
 * Mereth Reader — Offline Secure Markdown Parser & Renderer (Task 4.3, PRD FR-10.10)
 *
 * Implements an offline, zero-telemetry Markdown renderer supporting:
 * - Headings (h1 - h6)
 * - Blockquotes (including multi-line and nested blockquotes)
 * - Task list checkboxes (- [ ] / - [x])
 * - Unordered lists (-, *, +) and ordered lists (1., 2.)
 * - Code blocks (```language ... ```) and inline code (`code`)
 * - Pipe tables (| col | col |) with alignment (:---, :---:, ---:)
 * - Inline math ($formula$) and block math ($$formula$$)
 * - Typography (bold, italic, strikethrough)
 * - Safe links ([text](url)) and Mereth wiki-links ([[id|label]] / [[id]])
 * - Strict HTML entity escaping to prevent XSS.
 */

export interface MarkdownRenderOptions {
  sanitize?: boolean;
  allowWikiLinks?: boolean;
  baseDeepLinkPrefix?: string;
}

const ALLOWED_URI_SCHEMES = ['http:', 'https:', 'mailto:', 'mereth:'];

/**
 * Escapes raw HTML special characters to prevent cross-site scripting (XSS).
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes URLs to ensure only safe schemes (http, https, mailto, mereth) or relative paths are permitted.
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '#';

  // Relative links and hash anchors are always safe
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return escapeHtml(trimmed);
  }

  // Check scheme
  try {
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const scheme = trimmed.substring(0, colonIndex + 1).toLowerCase();
      if (ALLOWED_URI_SCHEMES.includes(scheme)) {
        return escapeHtml(trimmed);
      }
      return '#blocked-uri';
    }
  } catch {
    return '#blocked-uri';
  }

  return escapeHtml(trimmed);
}

/**
 * Parses and renders inline markdown tokens within a text segment.
 */
export function renderInlineMarkdown(text: string, options: MarkdownRenderOptions = {}): string {
  const allowWikiLinks = options.allowWikiLinks !== false;
  const deepLinkPrefix = options.baseDeepLinkPrefix ?? 'mereth://note/';

  // 1. Extract inline math ($...$) first to protect from formatting
  const mathTokens: string[] = [];
  let processed = text.replace(/(?<!\\)\$([^\$\n]+?)\$/g, (_match, formula: string) => {
    const idx = mathTokens.length;
    mathTokens.push(`<span class="md-math-inline" data-math="${escapeHtml(formula)}">$${escapeHtml(formula)}$</span>`);
    return `§§MATH${idx}§§`;
  });

  // 2. Extract inline code (`...`) to protect from formatting
  const codeTokens: string[] = [];
  processed = processed.replace(/(?<!\\)`([^`\n]+?)`/g, (_match, code: string) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="md-code-inline">${escapeHtml(code)}</code>`);
    return `§§CODE${idx}§§`;
  });

  // 3. Escape HTML in the remaining text
  processed = escapeHtml(processed);

  // 4. Images: ![alt](url)
  processed = processed.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, src: string) => {
    const safeSrc = sanitizeUrl(src);
    return `<img src="${safeSrc}" alt="${alt}" class="md-image" />`;
  });

  // 5. Wiki links: [[target|label]] or [[target]]
  if (allowWikiLinks) {
    processed = processed.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
      const rawTarget = target.trim();
      const displayLabel = label ? label.trim() : rawTarget;
      const href = rawTarget.startsWith('mereth://') ? rawTarget : `${deepLinkPrefix}${encodeURIComponent(rawTarget)}`;
      const safeHref = sanitizeUrl(href);
      return `<a href="${safeHref}" class="wiki-link" data-note-id="${escapeHtml(rawTarget)}">${escapeHtml(displayLabel)}</a>`;
    });
  }

  // 6. Standard links: [text](url)
  processed = processed.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = sanitizeUrl(url);
    return `<a href="${safeUrl}" class="md-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // 7. Bold & Italic (***text*** or ___text___)
  processed = processed.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong class="md-bold"><em class="md-italic">$1</em></strong>');
  processed = processed.replace(/___([^_]+)___/g, '<strong class="md-bold"><em class="md-italic">$1</em></strong>');

  // 8. Bold (**text** or __text__)
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
  processed = processed.replace(/__([^_]+)__/g, '<strong class="md-bold">$1</strong>');

  // 9. Italic (*text* or _text_)
  processed = processed.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em class="md-italic">$1</em>');
  processed = processed.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em class="md-italic">$1</em>');

  // 10. Strikethrough (~~text~~)
  processed = processed.replace(/~~([^~]+)~~/g, '<del class="md-del">$1</del>');

  // 11. Restore inline code
  processed = processed.replace(/§§CODE(\d+)§§/g, (_match, idx: string) => {
    return codeTokens[Number(idx)] ?? '';
  });

  // 12. Restore inline math
  processed = processed.replace(/§§MATH(\d+)§§/g, (_match, idx: string) => {
    return mathTokens[Number(idx)] ?? '';
  });

  return processed;
}

interface TableAlignments {
  [colIndex: number]: 'left' | 'center' | 'right' | undefined;
}

function parseTableAlignments(separatorLine: string): TableAlignments {
  const cells = separatorLine.split('|').map((s) => s.trim()).filter((s, idx, arr) => (idx > 0 && idx < arr.length - 1) || (arr.length <= 2 && s.length > 0));
  const alignments: TableAlignments = {};
  cells.forEach((cell, idx) => {
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');
    if (starts && ends) alignments[idx] = 'center';
    else if (ends) alignments[idx] = 'right';
    else if (starts) alignments[idx] = 'left';
  });
  return alignments;
}

function splitTableCells(rowLine: string): string[] {
  let line = rowLine.trim();
  if (line.startsWith('|')) line = line.substring(1);
  if (line.endsWith('|')) line = line.substring(0, line.length - 1);
  return line.split('|').map((c) => c.trim());
}

/**
 * Converts a Markdown document into secure, structured HTML.
 */
export function renderMarkdownToHtml(markdown: string, options: MarkdownRenderOptions = {}): string {
  if (!markdown || !markdown.trim()) {
    return '';
  }

  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced Code Block (```language ... ```)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.substring(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
      }
      const rawCode = codeLines.join('\n');
      const escapedCode = escapeHtml(rawCode);
      const langAttr = lang ? ` data-language="${escapeHtml(lang)}"` : '';
      const codeClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      output.push(`<pre class="md-code-block"${langAttr}><code${codeClass}>${escapedCode}</code></pre>`);
      continue;
    }

    // 2. Block Math ($$ ... $$)
    if (trimmed.startsWith('$$')) {
      const mathLines: string[] = [];
      const singleLine = trimmed.length > 2 && trimmed.endsWith('$$');
      if (singleLine && trimmed.length > 4) {
        const formula = trimmed.substring(2, trimmed.length - 2).trim();
        output.push(`<div class="md-math-block" data-math="${escapeHtml(formula)}">$$${escapeHtml(formula)}$$</div>`);
        i++;
        continue;
      } else {
        mathLines.push(trimmed.substring(2));
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          const lastLine = lines[i].trim();
          mathLines.push(lastLine.substring(0, lastLine.length - 2));
          i++;
        }
        const formula = mathLines.join('\n').trim();
        output.push(`<div class="md-math-block" data-math="${escapeHtml(formula)}">$$${escapeHtml(formula)}$$</div>`);
        continue;
      }
    }

    // 3. Headings (# H1 to ###### H6)
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      const renderedContent = renderInlineMarkdown(content, options);
      output.push(`<h${level} class="md-h${level}">${renderedContent}</h${level}>`);
      i++;
      continue;
    }

    // 4. Horizontal Rules (---, ***, ___)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      output.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // 5. Blockquotes (> ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('>') || (lines[i].trim() !== '' && quoteLines.length > 0 && !lines[i].trim().startsWith('#')))) {
        const l = lines[i].trim();
        if (l.startsWith('>')) {
          quoteLines.push(l.substring(1).trim());
        } else if (l === '') {
          break;
        } else {
          quoteLines.push(l);
        }
        i++;
      }
      const quoteContent = quoteLines.join('\n');
      const innerHtml = renderMarkdownToHtml(quoteContent, options);
      output.push(`<blockquote class="md-blockquote">${innerHtml}</blockquote>`);
      continue;
    }

    // 6. Tables (| Col 1 | Col 2 |)
    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('|') && /^\s*\|?\s*[-:]+[-| :]*\s*\|?\s*$/.test(lines[i + 1])) {
      const headerCells = splitTableCells(lines[i]);
      const alignments = parseTableAlignments(lines[i + 1]);
      i += 2; // skip header and separator

      const rowHtmls: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitTableCells(lines[i]);
        const cellsHtml = cells.map((cell, cIdx) => {
          const align = alignments[cIdx];
          const alignStyle = align ? ` style="text-align: ${align};"` : '';
          return `<td class="md-table-cell"${alignStyle}>${renderInlineMarkdown(cell, options)}</td>`;
        }).join('');
        rowHtmls.push(`<tr class="md-table-row">${cellsHtml}</tr>`);
        i++;
      }

      const theadCells = headerCells.map((h, cIdx) => {
        const align = alignments[cIdx];
        const alignStyle = align ? ` style="text-align: ${align};"` : '';
        return `<th class="md-table-head"${alignStyle}>${renderInlineMarkdown(h, options)}</th>`;
      }).join('');

      output.push(`<table class="md-table"><thead><tr class="md-table-row">${theadCells}</tr></thead><tbody>${rowHtmls.join('')}</tbody></table>`);
      continue;
    }

    // 7. Task Lists & Unordered Lists (- [ ], * [ ], - item, * item, + item)
    const taskMatch = rawLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bulletMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/);
    if (taskMatch) {
      const taskItems: string[] = [];
      while (i < lines.length) {
        const tm = lines[i].match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!tm) break;
        const isChecked = tm[2].toLowerCase() === 'x';
        const itemContent = renderInlineMarkdown(tm[3], options);
        const checkedAttr = isChecked ? ' checked' : '';
        const itemClass = isChecked ? 'md-task-item completed' : 'md-task-item';
        taskItems.push(`<li class="${itemClass}"><input type="checkbox" disabled${checkedAttr} class="md-task-checkbox" /> <span>${itemContent}</span></li>`);
        i++;
      }
      output.push(`<ul class="md-task-list">${taskItems.join('')}</ul>`);
      continue;
    }

    if (bulletMatch) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const bm = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        if (!bm) break;
        // If it turns into a task list, stop
        if (lines[i].match(/^(\s*)[-*+]\s+\[([ xX])\]\s+/)) break;
        const itemContent = renderInlineMarkdown(bm[2], options);
        listItems.push(`<li class="md-list-item">${itemContent}</li>`);
        i++;
      }
      if (listItems.length > 0) {
        output.push(`<ul class="md-unordered-list">${listItems.join('')}</ul>`);
        continue;
      }
    }

    // 8. Ordered Lists (1. item, 2. item)
    const numMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numMatch) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const nm = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
        if (!nm) break;
        const itemContent = renderInlineMarkdown(nm[2], options);
        listItems.push(`<li class="md-ordered-item">${itemContent}</li>`);
        i++;
      }
      output.push(`<ol class="md-ordered-list">${listItems.join('')}</ol>`);
      continue;
    }

    // 9. Standard Paragraphs (gather contiguous non-block lines)
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('$$') &&
      !lines[i].trim().startsWith('>') &&
      !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].match(/^(\s*)[-*+]\s+/) &&
      !lines[i].match(/^(\s*)\d+\.\s+/)
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }

    if (paragraphLines.length > 0) {
      const paragraphText = paragraphLines.join(' ');
      output.push(`<p class="md-paragraph">${renderInlineMarkdown(paragraphText, options)}</p>`);
    }
  }

  return output.join('\n');
}
