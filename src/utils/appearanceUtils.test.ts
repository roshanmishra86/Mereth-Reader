import { describe, it, expect } from 'vitest';
import {
  resolveTheme,
  getPageDimmingOpacity,
  getPageDimmingStyle,
  resolveTextScale,
  resolveReducedMotion,
  resolvePaneCollapseOrder,
  parseSettingsRows,
  serializeSettingValue,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './appearanceUtils';

describe('appearanceUtils', () => {
  describe('resolveTheme', () => {
    it('resolves explicit light and dark preferences', () => {
      expect(resolveTheme('light', false)).toBe('light');
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('dark', false)).toBe('dark');
      expect(resolveTheme('dark', true)).toBe('dark');
    });

    it('resolves system mode based on system preference', () => {
      expect(resolveTheme('system', true)).toBe('dark');
      expect(resolveTheme('system', false)).toBe('light');
    });

    it('handles uppercase or whitespace or unknown strings gracefully', () => {
      expect(resolveTheme(' DARK ', false)).toBe('dark');
      expect(resolveTheme('LIGHT', false)).toBe('light');
      expect(resolveTheme('unknown', true)).toBe('dark');
      expect(resolveTheme(null, false)).toBe('light');
    });
  });

  describe('getPageDimmingOpacity & getPageDimmingStyle', () => {
    it('returns exact numeric opacity for standard dimming levels', () => {
      expect(getPageDimmingOpacity('0%')).toBe(0.0);
      expect(getPageDimmingOpacity('20%')).toBe(0.2);
      expect(getPageDimmingOpacity('40%')).toBe(0.4);
      expect(getPageDimmingOpacity('60%')).toBe(0.6);
    });

    it('handles numeric inputs and clamps appropriately', () => {
      expect(getPageDimmingOpacity(0.4)).toBe(0.4);
      expect(getPageDimmingOpacity(40)).toBe(0.4);
      expect(getPageDimmingOpacity(90)).toBe(0.8); // Clamped at 0.8 max
      expect(getPageDimmingOpacity(-10)).toBe(0.0);
      expect(getPageDimmingOpacity(null)).toBe(0.0);
    });

    it('builds style object without page content color inversion (FR-8.6)', () => {
      const style = getPageDimmingStyle('40%');
      expect(style.opacity).toBe(0.4);
      expect(style.backgroundColor).toBe('#000000');
      expect(style.pointerEvents).toBe('none');
      expect(style.preservesColor).toBe(true);
    });
  });

  describe('resolveTextScale', () => {
    it('resolves standard preset text scale strings', () => {
      expect(resolveTextScale('80%')).toEqual({ scaleFactor: 0.8, percentage: 80, fontPercentString: '80%' });
      expect(resolveTextScale('100%')).toEqual({ scaleFactor: 1.0, percentage: 100, fontPercentString: '100%' });
      expect(resolveTextScale('120%')).toEqual({ scaleFactor: 1.2, percentage: 120, fontPercentString: '120%' });
      expect(resolveTextScale('150%')).toEqual({ scaleFactor: 1.5, percentage: 150, fontPercentString: '150%' });
    });

    it('handles numeric multipliers and enforces 80%-150% limits', () => {
      expect(resolveTextScale(0.85)).toEqual({ scaleFactor: 0.85, percentage: 85, fontPercentString: '85%' });
      expect(resolveTextScale(50)).toEqual({ scaleFactor: 0.8, percentage: 80, fontPercentString: '80%' });
      expect(resolveTextScale(200)).toEqual({ scaleFactor: 1.5, percentage: 150, fontPercentString: '150%' });
      expect(resolveTextScale(null)).toEqual({ scaleFactor: 1.0, percentage: 100, fontPercentString: '100%' });
    });
  });

  describe('resolveReducedMotion', () => {
    it('respects system preferences when set to system', () => {
      expect(resolveReducedMotion('system', true)).toBe(true);
      expect(resolveReducedMotion('system', false)).toBe(false);
    });

    it('overrides system preference when set to enabled or disabled', () => {
      expect(resolveReducedMotion('enabled', false)).toBe(true);
      expect(resolveReducedMotion('disabled', true)).toBe(false);
      expect(resolveReducedMotion(true, false)).toBe(true);
      expect(resolveReducedMotion(false, true)).toBe(false);
    });
  });

  describe('resolvePaneCollapseOrder', () => {
    it('keeps both panes open when container width is ample', () => {
      const res = resolvePaneCollapseOrder({
        containerWidth: 1200,
        leftRequested: true,
        rightRequested: true,
        leftWidth: 230,
        rightWidth: 284,
        minCanvasWidth: 350,
      });
      expect(res.leftPaneOpen).toBe(true);
      expect(res.rightPaneOpen).toBe(true);
      expect(res.collapseReason).toBeUndefined();
    });

    it('collapses right pane FIRST when container width is 800px (1024x640 constraint)', () => {
      // 230 + 284 + 350 = 864px required. 800px available.
      const res = resolvePaneCollapseOrder({
        containerWidth: 800,
        leftRequested: true,
        rightRequested: true,
        leftWidth: 230,
        rightWidth: 284,
        minCanvasWidth: 350,
      });
      // Right pane collapses first
      expect(res.rightPaneOpen).toBe(false);
      // Left pane remains open since 230 + 350 = 580px <= 800px
      expect(res.leftPaneOpen).toBe(true);
      expect(res.collapseReason).toContain('right pane collapsed first');
    });

    it('collapses left pane SECOND when container width is extremely narrow (500px)', () => {
      // 500px available. Left width 230 + canvas 350 = 580px > 500px
      const res = resolvePaneCollapseOrder({
        containerWidth: 500,
        leftRequested: true,
        rightRequested: true,
        leftWidth: 230,
        rightWidth: 284,
        minCanvasWidth: 350,
      });
      expect(res.rightPaneOpen).toBe(false);
      expect(res.leftPaneOpen).toBe(false);
      expect(res.collapseReason).toContain('left pane collapsed second');
    });

    it('collapses only requested single pane if container cannot fit it', () => {
      const res = resolvePaneCollapseOrder({
        containerWidth: 400,
        leftRequested: true,
        rightRequested: false,
        leftWidth: 230,
        minCanvasWidth: 350,
      });
      expect(res.leftPaneOpen).toBe(false);
      expect(res.rightPaneOpen).toBe(false);
    });
  });

  describe('parseSettingsRows & serializeSettingValue', () => {
    it('parses SQLite rows into typed AppearancePreferences object', () => {
      const rows = [
        { key: 'theme', value: 'dark' },
        { key: 'page_dimming', value: '40%' },
        { key: 'app_text_scale', value: '120%' },
        { key: 'reduced_motion', value: 'enabled' },
        { key: 'calm_chrome', value: 'true' },
      ];
      const parsed = parseSettingsRows(rows);
      expect(parsed).toEqual({
        theme: 'dark',
        pageDimming: '40%',
        appTextScale: '120%',
        reducedMotion: 'enabled',
        calmChrome: true,
      });
    });

    it('falls back to default preferences for missing or unknown keys', () => {
      const parsed = parseSettingsRows([{ key: 'theme', value: 'invalid' }]);
      expect(parsed).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    });

    it('serializes setting keys and values for SQLite storage', () => {
      expect(serializeSettingValue('theme', 'dark')).toEqual({ key: 'theme', value: 'dark' });
      expect(serializeSettingValue('pageDimming', '40%')).toEqual({ key: 'page_dimming', value: '40%' });
      expect(serializeSettingValue('appTextScale', '120%')).toEqual({ key: 'app_text_scale', value: '120%' });
      expect(serializeSettingValue('reducedMotion', 'enabled')).toEqual({ key: 'reduced_motion', value: 'enabled' });
      expect(serializeSettingValue('calmChrome', true)).toEqual({ key: 'calm_chrome', value: 'true' });
    });
  });
});
