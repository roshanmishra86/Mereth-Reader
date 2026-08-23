export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses a hex color string (e.g. #fff, #ffffff, #201e1d) to RGB components.
 */
export function hexToRgb(hex: string): RgbColor {
  let cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (cleaned.length !== 6) {
    throw new Error(`Invalid hex color: '${hex}'`);
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Calculates sRGB channel luminance component according to WCAG 2.1.
 */
function channelLuminance(channel8Bit: number): number {
  const normalized = channel8Bit / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/**
 * Calculates the relative luminance of an RGB color (0.0 for darkest black to 1.0 for lightest white).
 */
export function calculateRelativeLuminance(color: RgbColor): number {
  const r = channelLuminance(color.r);
  const g = channelLuminance(color.g);
  const b = channelLuminance(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates WCAG 2.1 contrast ratio between two colors (ranging from 1:1 to 21:1).
 */
export function calculateContrastRatio(colorA: string | RgbColor, colorB: string | RgbColor): number {
  const rgbA = typeof colorA === 'string' ? hexToRgb(colorA) : colorA;
  const rgbB = typeof colorB === 'string' ? hexToRgb(colorB) : colorB;

  const lumA = calculateRelativeLuminance(rgbA);
  const lumB = calculateRelativeLuminance(rgbB);

  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

/**
 * Evaluates whether a foreground and background color pair meets WCAG 2.1 AA requirements.
 */
export function meetsWcagAA(
  foreground: string,
  background: string,
  options: { isLargeText?: boolean; isUiComponent?: boolean } = {}
): { meetsAA: boolean; ratio: number; requiredRatio: number } {
  const ratio = calculateContrastRatio(foreground, background);
  const requiredRatio = options.isLargeText || options.isUiComponent ? 3.0 : 4.5;
  return {
    meetsAA: ratio >= requiredRatio,
    ratio,
    requiredRatio,
  };
}
