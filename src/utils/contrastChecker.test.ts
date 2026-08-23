import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  calculateRelativeLuminance,
  calculateContrastRatio,
  meetsWcagAA,
} from './contrastChecker';

describe('Task 5.2 WCAG 2.1 AA Contrast Ratios and Theme Audit (PRD §17.4)', () => {
  it('calculates relative luminance and contrast ratio accurately', () => {
    // Pure black vs pure white is 21:1
    expect(calculateContrastRatio('#000000', '#ffffff')).toBe(21);
    expect(calculateContrastRatio('#ffffff', '#ffffff')).toBe(1);

    // Mid grays
    const ratio = calculateContrastRatio('#767676', '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('validates light theme chrome contrast meets WCAG AA for normal text (>= 4.5:1)', () => {
    // Light theme body text (#201e1d) on background (#f3f2f2)
    const bodyResult = meetsWcagAA('#201e1d', '#f3f2f2');
    expect(bodyResult.meetsAA).toBe(true);
    expect(bodyResult.ratio).toBeGreaterThanOrEqual(10.0);

    // Light theme muted text (#444141) on background (#f3f2f2)
    const mutedResult = meetsWcagAA('#444141', '#f3f2f2');
    expect(mutedResult.meetsAA).toBe(true);
    expect(mutedResult.ratio).toBeGreaterThanOrEqual(7.0);

    // Primary action button: white text (#ffffff) on accent (#ec3013)
    const buttonResult = meetsWcagAA('#ffffff', '#ec3013', { isUiComponent: true });
    expect(buttonResult.meetsAA).toBe(true);
    expect(buttonResult.ratio).toBeGreaterThanOrEqual(3.5);

    // Accent eyebrow text (#ae1800) on sidebar background (#eae9e9)
    const eyebrowResult = meetsWcagAA('#ae1800', '#eae9e9');
    expect(eyebrowResult.meetsAA).toBe(true);
    expect(eyebrowResult.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('validates dark theme chrome contrast meets WCAG AA (>= 4.5:1)', () => {
    // Dark theme text (#f3f2f2) on dark surface (#201e1d)
    const darkBodyResult = meetsWcagAA('#f3f2f2', '#201e1d');
    expect(darkBodyResult.meetsAA).toBe(true);
    expect(darkBodyResult.ratio).toBeGreaterThanOrEqual(10.0);

    // Dark theme secondary text (#d7d3d3) on (#201e1d)
    const darkSecResult = meetsWcagAA('#d7d3d3', '#201e1d');
    expect(darkSecResult.meetsAA).toBe(true);
    expect(darkSecResult.ratio).toBeGreaterThanOrEqual(7.0);
  });
});
