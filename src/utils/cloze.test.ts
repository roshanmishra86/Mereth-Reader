import { describe, it, expect } from 'vitest';
import {
  validateClozeSyntax,
  parseClozeSegments,
  renderClozeCard,
  getActiveClozeNumber,
  getUniqueClozeIndices,
} from './cloze';

describe('cloze utility', () => {
  describe('validateClozeSyntax', () => {
    it('validates a standard cloze deletion', () => {
      const result = validateClozeSyntax('The {{c1::hippocampus}} is responsible for memory.');
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.clozes).toHaveLength(1);
      expect(result.clozes[0].clozeNumber).toBe(1);
      expect(result.clozes[0].answer).toBe('hippocampus');
      expect(result.primaryAnswer).toBe('hippocampus');
    });

    it('validates cloze with hint syntax', () => {
      const result = validateClozeSyntax('Water boils at {{c1::100 degrees Celsius::temperature}} at 1 atm.');
      expect(result.isValid).toBe(true);
      expect(result.clozes[0].answer).toBe('100 degrees Celsius');
      expect(result.clozes[0].hint).toBe('temperature');
    });

    it('handles multiple clozes in one passage', () => {
      const result = validateClozeSyntax('{{c1::Mitochondria}} produce {{c2::ATP}} via oxidative phosphorylation.');
      expect(result.isValid).toBe(true);
      expect(result.clozes).toHaveLength(2);
      expect(result.clozes[0].clozeNumber).toBe(1);
      expect(result.clozes[0].answer).toBe('Mitochondria');
      expect(result.clozes[1].clozeNumber).toBe(2);
      expect(result.clozes[1].answer).toBe('ATP');
      expect(result.primaryAnswer).toBe('Mitochondria; ATP');
    });

    it('detects unclosed braces', () => {
      const result = validateClozeSyntax('Broken {{c1::unclosed brace test.');
      expect(result.isValid).toBe(false);
      expect(result.issues.some((issue) => issue.includes('Mismatched cloze braces'))).toBe(true);
    });

    it('detects cloze missing the cNumber prefix', () => {
      const result = validateClozeSyntax('Invalid {{answer}} syntax.');
      expect(result.isValid).toBe(false);
      expect(result.issues.some((issue) => issue.includes('must specify an index'))).toBe(true);
    });

    it('detects empty cloze answer', () => {
      const result = validateClozeSyntax('Empty {{c1::}} test.');
      expect(result.isValid).toBe(false);
      expect(result.issues.some((issue) => issue.includes('empty answer'))).toBe(true);
    });

    it('rejects text without cloze deletions', () => {
      const result = validateClozeSyntax('Normal text with no deletions.');
      expect(result.isValid).toBe(false);
      expect(result.issues.some((issue) => issue.includes('require {{c1::hidden text}}'))).toBe(true);
    });
  });

  describe('parseClozeSegments', () => {
    it('breaks string into alternating text and cloze segments', () => {
      const raw = 'Prefix {{c1::secret}} middle {{c2::clue::hint}} suffix';
      const segments = parseClozeSegments(raw);

      expect(segments).toHaveLength(5);
      expect(segments[0]).toEqual({ type: 'text', content: 'Prefix ' });
      expect(segments[1]).toEqual({ type: 'cloze', content: '{{c1::secret}}', clozeIndex: 1, answer: 'secret', hint: undefined });
      expect(segments[2]).toEqual({ type: 'text', content: ' middle ' });
      expect(segments[3]).toEqual({ type: 'cloze', content: '{{c2::clue::hint}}', clozeIndex: 2, answer: 'clue', hint: 'hint' });
      expect(segments[4]).toEqual({ type: 'text', content: ' suffix' });
    });
  });

  describe('renderClozeCard and Concealment Integrity', () => {
    it('CONCEALMENT TEST: target answer NEVER appears in unrevealed output or HTML', () => {
      const secretAnswer = 'SUPER_SECRET_TOKEN_42';
      const raw = `The secret password is {{c1::${secretAnswer}}}. Do not reveal it early.`;

      const card = renderClozeCard(raw, 1, false);

      // 1. Plain text prompt check
      expect(card.plainTextPrompt).not.toContain(secretAnswer);
      expect(card.plainTextPrompt).toContain('[ ... ]');

      // 2. HTML output check
      expect(card.html).not.toContain(secretAnswer);
      expect(card.html).toContain('<span class="cloze-bracket" aria-label="Blank">[ ... ]</span>');

      // 3. Card metadata
      expect(card.answer).toBe(secretAnswer);
      expect(card.clozeNumber).toBe(1);
    });

    it('displays hint inside brackets when unrevealed', () => {
      const raw = 'Capital of France is {{c1::Paris::city in Europe}}.';
      const card = renderClozeCard(raw, 1, false);

      expect(card.plainTextPrompt).not.toContain('Paris');
      expect(card.plainTextPrompt).toContain('[ city in Europe ]');
      expect(card.html).toContain('[ city in Europe ]');
    });

    it('reveals target answer with distinctive highlight wrapper', () => {
      const raw = 'The formula for water is {{c1::H2O}}.';
      const card = renderClozeCard(raw, 1, true);

      expect(card.plainTextPrompt).toContain('H2O');
      expect(card.html).toContain('<span class="cloze-revealed" aria-label="Revealed answer: H2O">H2O</span>');
    });

    it('shows non-target cloze answers as readable surrounding context', () => {
      const raw = '{{c1::Erythrocytes}} carry {{c2::oxygen}} throughout the body.';

      // When testing c1: c2 should be readable as normal text, but c1 must be concealed
      const card1 = renderClozeCard(raw, 1, false);
      expect(card1.plainTextPrompt).not.toContain('Erythrocytes');
      expect(card1.plainTextPrompt).toContain('oxygen');
      expect(card1.html).toContain('<span class="cloze-bracket" aria-label="Blank">[ ... ]</span> carry oxygen');

      // When testing c2: c1 should be readable as normal text, but c2 must be concealed
      const card2 = renderClozeCard(raw, 2, false);
      expect(card2.plainTextPrompt).toContain('Erythrocytes');
      expect(card2.plainTextPrompt).not.toContain('oxygen');
      expect(card2.html).toContain('Erythrocytes carry <span class="cloze-bracket" aria-label="Blank">[ ... ]</span>');
    });

    it('properly escapes HTML to prevent XSS injection', () => {
      const raw = 'Code snippet: {{c1::<script>alert("hack")</script>}}.';
      const unrevealed = renderClozeCard(raw, 1, false);
      expect(unrevealed.html).not.toContain('<script>');

      const revealed = renderClozeCard(raw, 1, true);
      expect(revealed.html).toContain('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;');
      expect(revealed.html).not.toContain('<script>');
    });

    it('auto-resolves lowest cloze number when targetNumber is not specified or arbitrary (e.g. c2 only)', () => {
      const c2Only = 'Only cloze here is {{c2::isolated answer::hint text}}.';
      const defaultCard = renderClozeCard(c2Only);
      expect(defaultCard.clozeNumber).toBe(2);
      expect(defaultCard.answer).toBe('isolated answer');
      expect(defaultCard.plainTextPrompt).not.toContain('isolated answer');
      expect(defaultCard.plainTextPrompt).toContain('[ hint text ]');

      const revealedCard = renderClozeCard(c2Only, undefined, true);
      expect(revealedCard.clozeNumber).toBe(2);
      expect(revealedCard.plainTextPrompt).toContain('isolated answer');
    });

    it('combines multiple answers when blanks share the same cloze index', () => {
      const raw = '{{c1::Canberra}} is the capital of {{c1::Australia}}.';
      const unrevealed = renderClozeCard(raw, 1, false);

      expect(unrevealed.answer).toBe('Canberra; Australia');
      expect(unrevealed.clozeNumber).toBe(1);
      expect(unrevealed.plainTextPrompt).toBe('[ ... ] is the capital of [ ... ].');
      expect(unrevealed.plainTextPrompt).not.toContain('Canberra');
      expect(unrevealed.plainTextPrompt).not.toContain('Australia');
      expect(unrevealed.html).toContain('<span class="cloze-bracket" aria-label="Blank">[ ... ]</span> is the capital of <span class="cloze-bracket" aria-label="Blank">[ ... ]</span>.');

      const revealed = renderClozeCard(raw, 1, true);
      expect(revealed.answer).toBe('Canberra; Australia');
      expect(revealed.plainTextPrompt).toBe('Canberra is the capital of Australia.');
      expect(revealed.html).toContain('<span class="cloze-revealed" aria-label="Revealed answer: Canberra">Canberra</span>');
      expect(revealed.html).toContain('<span class="cloze-revealed" aria-label="Revealed answer: Australia">Australia</span>');
    });

    it('combines answers only for active cloze index in mixed multi-blank prompt', () => {
      const raw = '{{c1::Alpha}} and {{c2::Beta}} and {{c1::Gamma}}';
      const card1 = renderClozeCard(raw, 1, false);
      expect(card1.answer).toBe('Alpha; Gamma');
      expect(card1.plainTextPrompt).toBe('[ ... ] and Beta and [ ... ]');

      const card2 = renderClozeCard(raw, 2, false);
      expect(card2.answer).toBe('Beta');
      expect(card2.plainTextPrompt).toBe('Alpha and [ ... ] and Gamma');
    });
  });

  describe('getActiveClozeNumber', () => {
    it('returns lowest available cloze index when no explicit number given', () => {
      expect(getActiveClozeNumber('{{c3::third}} then {{c2::second}}')).toBe(2);
      expect(getActiveClozeNumber('{{c1::first}} then {{c2::second}}')).toBe(1);
    });

    it('returns explicit number if present in segments', () => {
      expect(getActiveClozeNumber('{{c1::one}} {{c2::two}}', 2)).toBe(2);
    });

    it('falls back to lowest cloze index if explicit number is not present in segments', () => {
      expect(getActiveClozeNumber('{{c2::two}} {{c3::three}}', 1)).toBe(2);
    });

    it('defaults to 1 if no clozes found', () => {
      expect(getActiveClozeNumber('no clozes here')).toBe(1);
    });
  });

  describe('getUniqueClozeIndices', () => {
    it('returns sorted unique cloze indices from text with multiple and duplicate clozes', () => {
      const raw = '{{c2::two}} and {{c1::one}} and {{c2::also two}} and {{c3::three}}';
      expect(getUniqueClozeIndices(raw)).toEqual([1, 2, 3]);
    });

    it('returns single index when all blanks share the same index', () => {
      const raw = '{{c1::Canberra}} is the capital of {{c1::Australia}}';
      expect(getUniqueClozeIndices(raw)).toEqual([1]);
    });

    it('returns empty array when text has no cloze deletions', () => {
      expect(getUniqueClozeIndices('Plain text with no cloze')).toEqual([]);
    });

    it('handles non-consecutive cloze indices in sorted order', () => {
      const raw = '{{c10::ten}} and {{c4::four}} and {{c1::one}}';
      expect(getUniqueClozeIndices(raw)).toEqual([1, 4, 10]);
    });
  });
});
