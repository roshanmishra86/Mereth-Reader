import React from 'react';
import {
  AppearancePreferences,
  ThemeMode,
  PageDimmingLevel,
  AppTextScale,
  ReducedMotionMode,
} from '../utils/appearanceUtils';

interface SettingsAppearanceProps {
  preferences: AppearancePreferences;
  onUpdatePreference: <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => void;
}

export const SettingsAppearance: React.FC<SettingsAppearanceProps> = ({
  preferences,
  onUpdatePreference,
}) => {
  return (
    <div className="settings-appearance-view">
      <span className="eyebrow">FR-8.5 · FR-8.6 · §17.4</span>
      <h1>Appearance & Reading Comfort</h1>
      <p>
        Customize application theme, page dimming, text size, and motion preferences for comfortable, distraction-free reading.
      </p>

      <div className="destination-rule" />

      {/* 1. Application Theme */}
      <section className="setting-group">
        <h3>Application Theme (FR-8.6)</h3>
        <p className="dimmed">
          Controls application chrome (toolbar, sidebars, settings, and dialogs).
          <strong> PDF document page content is never inverted by default</strong> to preserve figures, illustrations, and color-coded materials.
        </p>

        <div className="radio-group">
          <label className={`radio-row ${preferences.theme === 'system' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value="system"
              checked={preferences.theme === 'system'}
              onChange={() => onUpdatePreference('theme', 'system')}
            />
            <span />
            <div>
              <b>System default</b>
              <small>Automatically match your operating system theme (Light or Dark).</small>
            </div>
          </label>

          <label className={`radio-row ${preferences.theme === 'light' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value="light"
              checked={preferences.theme === 'light'}
              onChange={() => onUpdatePreference('theme', 'light')}
            />
            <span />
            <div>
              <b>Light chrome</b>
              <small>Clean high-contrast light background for daytime reading.</small>
            </div>
          </label>

          <label className={`radio-row ${preferences.theme === 'dark' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={preferences.theme === 'dark'}
              onChange={() => onUpdatePreference('theme', 'dark')}
            />
            <span />
            <div>
              <b>Dark chrome</b>
              <small>Sleek low-glare dark application background for night reading.</small>
            </div>
          </label>
        </div>
      </section>

      {/* 2. Page Dimming Level */}
      <section className="setting-group">
        <h3>Document Page Dimming (FR-8.6)</h3>
        <p className="dimmed">
          Overlays a transparent darkening filter over the reading canvas to reduce glare while preserving exact document colors and figures.
        </p>

        <div className="dimming-presets">
          {(['0%', '20%', '40%', '60%'] as PageDimmingLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              className={`pill-btn ${preferences.pageDimming === level ? 'active' : ''}`}
              onClick={() => onUpdatePreference('pageDimming', level)}
            >
              {level === '0%' ? 'Off (0%)' : level}
            </button>
          ))}
        </div>
      </section>

      {/* 3. Independent Application Text Size */}
      <section className="setting-group">
        <h3>Application Text Size</h3>
        <p className="dimmed">
          Scale application interface and chrome text size independently of document PDF zoom scale.
        </p>

        <div className="text-scale-presets">
          {(['80%', '100%', '120%', '150%'] as AppTextScale[]).map((scale) => (
            <button
              key={scale}
              type="button"
              className={`pill-btn ${preferences.appTextScale === scale ? 'active' : ''}`}
              onClick={() => onUpdatePreference('appTextScale', scale)}
            >
              {scale === '100%' ? '100% (Default)' : scale}
            </button>
          ))}
        </div>
      </section>

      {/* 4. Reduced Motion Support */}
      <section className="setting-group">
        <h3>Reduced Motion (§17.4)</h3>
        <p className="dimmed">
          Respects OS <code>prefers-reduced-motion</code> or allows manually disabling UI animations and transitions.
        </p>

        <div className="radio-group">
          <label className={`radio-row ${preferences.reducedMotion === 'system' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="reducedMotion"
              value="system"
              checked={preferences.reducedMotion === 'system'}
              onChange={() => onUpdatePreference('reducedMotion', 'system')}
            />
            <span />
            <div>
              <b>System default</b>
              <small>Follow operating system accessibility animation settings.</small>
            </div>
          </label>

          <label className={`radio-row ${preferences.reducedMotion === 'enabled' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="reducedMotion"
              value="enabled"
              checked={preferences.reducedMotion === 'enabled'}
              onChange={() => onUpdatePreference('reducedMotion', 'enabled')}
            />
            <span />
            <div>
              <b>Always reduce motion</b>
              <small>Disable smooth UI transitions, slide animations, and pane motion across the reader.</small>
            </div>
          </label>

          <label className={`radio-row ${preferences.reducedMotion === 'disabled' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="reducedMotion"
              value="disabled"
              checked={preferences.reducedMotion === 'disabled'}
              onChange={() => onUpdatePreference('reducedMotion', 'disabled')}
            />
            <span />
            <div>
              <b>Enable UI transitions</b>
              <small>Allow subtle UI animations for pane resizing and modal opening.</small>
            </div>
          </label>
        </div>
      </section>

      {/* 5. Calm Chrome Mode */}
      <section className="setting-group">
        <h3>Calm Chrome (FR-8.5)</h3>
        <div className="setting-state">
          <div>
            <b>Reader Controls on Intent · {preferences.calmChrome ? 'Enabled' : 'Disabled'}</b>
            <p>
              When enabled, reader controls appear only on deliberate intent (keyboard shortcuts, explicit toolbar edge interaction, or pane toggles) rather than appearing whenever the pointer crosses the reading canvas.
            </p>
          </div>
          <button
            type="button"
            className={`wide-action ${preferences.calmChrome ? 'primary' : ''}`}
            onClick={() => onUpdatePreference('calmChrome', !preferences.calmChrome)}
          >
            {preferences.calmChrome ? 'Disable Calm Chrome' : 'Enable Calm Chrome'}
          </button>
        </div>
      </section>
    </div>
  );
};
