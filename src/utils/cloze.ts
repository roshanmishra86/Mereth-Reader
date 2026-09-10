/**
 * Cloze deletion parsing and rendering utility for Mereth Reader.
 * Supports standard Anki-style {{c1::answer}} and {{c1::answer::hint}} syntax.
 *
 * Strict TypeScript: no `any` types.
 */

export interface ClozeSegment {
  type: 'text' | 'cloze';
  content: string;
  clozeIndex?: number;
  answer?: string;
  hint?: string;
}

export interface ParsedClozeItem {
  clozeNumber: number;
  answer: string;
  hint?: string;
  raw: string;
}

export interface ClozeValidationResult {
  isValid: boolean;
  issues: string[];
  clozes: ParsedClozeItem[];
  primaryAnswer: string;
}

export interface RenderedClozeCard {
  html: string;
  plainTextPrompt: string;
  answer: string;
  clozeNumber: number;
}

const CLOZE_REGEX = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]+?))?\}\}/g;

/**
 * Validates a text string for cloze syntax correctness.
 * Checks for at least one valid cloze, detects unclosed braces or empty answers,
 * and extracts the primary answer text.
 */
export function validateClozeSyntax(text: string): ClozeValidationResult {
  const issues: string[] = [];
  const clozes: ParsedClozeItem[] = [];

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      isValid: false,
      issues: ['Cloze question cannot be empty.'],
      clozes: [],
      primaryAnswer: '',
    };
  }

  // Check for malformed / unclosed cloze tags
  const openCount = (trimmed.match(/\{\{/g) || []).length;
  const closeCount = (trimmed.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    issues.push(`Mismatched cloze braces: found ${openCount} '{{' and ${closeCount} '}}'.`);
  }

  // Check for cloze tags missing the cNumber prefix (e.g. {{answer}})
  const malformedNoNumber = trimmed.match(/\{\{(?!c\d+::)[^}]+?\}\}/g);
  if (malformedNoNumber && malformedNoNumber.length > 0) {
    issues.push(`Cloze deletion must specify an index, e.g. {{c1::answer}}. Found: ${malformedNoNumber.join(', ')}`);
  }

  // Extract all valid cloze matches
  const regex = new RegExp(CLOZE_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(trimmed)) !== null) {
    const raw = match[0];
    const clozeNumber = Number.parseInt(match[1], 10);
    const answer = match[2]?.trim() ?? '';
    const hint = match[3]?.trim();

    if (!answer) {
      issues.push(`Cloze {{c${clozeNumber}::...}} has an empty answer.`);
    } else {
      clozes.push({
        clozeNumber,
        answer,
        hint: hint || undefined,
        raw,
      });
    }
  }

  if (clozes.length === 0 && issues.length === 0) {
    issues.push('Cloze deletion prompts require {{c1::hidden text}} syntax in question or passage.');
  }

  const primaryAnswer = clozes.length > 0
    ? clozes.map((c) => c.answer).join('; ')
    : '';

  return {
    isValid: issues.length === 0 && clozes.length > 0,
    issues,
    clozes,
    primaryAnswer,
  };
}

/**
 * Escapes characters for HTML output to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parses raw cloze text into structured text and cloze segments.
 */
export function parseClozeSegments(raw: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  const regex = new RegExp(CLOZE_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: raw.slice(lastIndex, match.index),
      });
    }

    const clozeIndex = Number.parseInt(match[1], 10);
    const answer = match[2]?.trim() ?? '';
    const hint = match[3]?.trim();

    segments.push({
      type: 'cloze',
      content: match[0],
      clozeIndex,
      answer,
      hint: hint || undefined,
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    segments.push({
      type: 'text',
      content: raw.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Parses raw cloze text and returns sorted unique cloze indices present in the prompt.
 * e.g. for "{{c1::A}} and {{c2::B}} and {{c1::C}}" -> [1, 2]
 */
export function getUniqueClozeIndices(raw: string): number[] {
  const segments = parseClozeSegments(raw);
  const indices = new Set<number>();
  for (const segment of segments) {
    if (segment.type === 'cloze' && typeof segment.clozeIndex === 'number' && !Number.isNaN(segment.clozeIndex)) {
      indices.add(segment.clozeIndex);
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Determines the active cloze index for a raw cloze question string.
 * If explicitNumber is provided and exists in the string, uses that.
 * Otherwise returns the lowest available cloze index (e.g. 2 for {{c2::...}}),
 * falling back to 1 if none found.
 */
export function getActiveClozeNumber(raw: string, explicitNumber?: number): number {
  const clozeIndices = getUniqueClozeIndices(raw);

  if (clozeIndices.length === 0) return 1;
  if (explicitNumber !== undefined && clozeIndices.includes(explicitNumber)) {
    return explicitNumber;
  }
  return clozeIndices[0];
}

/**
 * Renders a cloze prompt into safe HTML and plain text.
 * When isRevealed is false:
 *   - The active cloze deletion (resolved targetNumber) is replaced by `[ ... ]` or `[ hint ]`.
 *   - The answer text is completely omitted from the HTML and plainTextPrompt.
 *   - Inactive cloze deletions are rendered with their answer text so surrounding context is readable.
 * When isRevealed is true:
 *   - The active cloze deletion is wrapped in a `<span class="cloze-revealed">answer</span>`.
 */
export function renderClozeCard(
  raw: string,
  targetNumber?: number,
  isRevealed = false
): RenderedClozeCard {
  const resolvedTargetNumber = getActiveClozeNumber(raw, targetNumber);
  const segments = parseClozeSegments(raw);
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const targetAnswers: string[] = [];

  for (const segment of segments) {
    if (segment.type === 'text') {
      htmlParts.push(escapeHtml(segment.content));
      textParts.push(segment.content);
      continue;
    }

    const isTarget = (segment.clozeIndex ?? 1) === resolvedTargetNumber;
    const answer = segment.answer ?? '';
    const hint = segment.hint;

    if (isTarget) {
      targetAnswers.push(answer);
      if (!isRevealed) {
        const bracketLabel = hint ? `[ ${hint} ]` : '[ ... ]';
        htmlParts.push(`<span class="cloze-bracket" aria-label="Blank">${escapeHtml(bracketLabel)}</span>`);
        textParts.push(bracketLabel);
      } else {
        htmlParts.push(`<span class="cloze-revealed" aria-label="Revealed answer: ${escapeHtml(answer)}">${escapeHtml(answer)}</span>`);
        textParts.push(answer);
      }
    } else {
      // Inactive cloze: display normal answer content so the rest of the sentence makes sense
      htmlParts.push(escapeHtml(answer));
      textParts.push(answer);
    }
  }

  return {
    html: htmlParts.join(''),
    plainTextPrompt: textParts.join(''),
    answer: targetAnswers.join('; '),
    clozeNumber: resolvedTargetNumber,
  };
}
