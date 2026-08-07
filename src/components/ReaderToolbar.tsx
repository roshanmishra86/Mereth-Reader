import React, { useState, useRef, useEffect } from 'react';
import { LayoutMode, RotationAngle, ZoomModeType } from '../utils/viewModeUtils';
import { SearchOptions, DetailedSearchMatch } from '../utils/searchUtils';
import { formatControlTooltip } from '../utils/shortcutUtils';
import { NavigationHistoryState } from '../utils/pdfUtils';
import { formatExtendedPageLabel, PageLabelMapping } from '../utils/navigationUtils';

interface ReaderToolbarProps {
  // Navigation & Page State
  currentPage: number;
  totalPages: number;
  historyState: NavigationHistoryState;
  onPageChange: (page: number) => void;
  onHistoryBack: () => void;
  onHistoryForward: () => void;
  customPageLabels?: Record<number, PageLabelMapping>;

  // View Modes & Zoom
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  zoomScale: number;
  zoomMode: ZoomModeType;
  onZoomChange: (action: 'in' | 'out' | 'reset' | 'fit-width' | 'fit-page' | 'set', value?: number) => void;
  rotation: RotationAngle;
  onRotateChange: (direction: 'cw' | 'ccw') => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  // Search State
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchOptions: SearchOptions;
  onSearchOptionsChange: (options: SearchOptions) => void;
  searchMatches: DetailedSearchMatch[];
  currentMatchIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;

  // Panes & Modes
  leftOpen: boolean;
  onToggleLeftOpen: () => void;
  rightOpen: boolean;
  onToggleRightOpen: () => void;
  readingOnly: boolean;
  onToggleReadingOnly: () => void;
  aiOn: boolean;
  onToggleAi: () => void;
  onOpenPdf: () => void;
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const [showSearchSnippetBox, setShowSearchSnippetBox] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const canGoBack = props.historyState.currentIndex > 0;
  const canGoForward = props.historyState.currentIndex < props.historyState.stack.length - 1;

  const backTooltip = formatControlTooltip(
    'History Back',
    'nav.history.back',
    !canGoBack ? 'No previous page in history stack' : undefined
  );

  const forwardTooltip = formatControlTooltip(
    'History Forward',
    'nav.history.forward',
    !canGoForward ? 'No next page in history stack' : undefined
  );

  const facingSupported = props.totalPages >= 2;
  const facingTooltip = formatControlTooltip(
    'Facing Pages View (Two-Up)',
    'view.facing',
    !facingSupported ? 'Facing pages view requires at least 2 pages in document' : undefined
  );

  const { displayLabel, fullBadge } = formatExtendedPageLabel(
    props.currentPage,
    props.totalPages,
    props.customPageLabels
  );

  // Handle keyboard shortcuts directly inside search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        props.onPrevMatch();
      } else {
        props.onNextMatch();
      }
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) {
        props.onPrevMatch();
      } else {
        props.onNextMatch();
      }
    } else if (e.key === 'Escape') {
      setShowSearchSnippetBox(false);
    }
  };

  useEffect(() => {
    if (props.searchQuery.trim().length > 0) {
      setShowSearchSnippetBox(true);
    } else {
      setShowSearchSnippetBox(false);
    }
  }, [props.searchQuery]);

  const activeMatch = props.searchMatches[props.currentMatchIndex];

  return (
    <div className="reader-toolbar" role="toolbar" aria-label="Reader Controls Toolbar">
      {/* Left Pane Toggle */}
      <button
        className={`outline-button ${props.leftOpen ? 'active' : ''}`}
        onClick={props.onToggleLeftOpen}
        title={formatControlTooltip('Toggle Outline Sidebar', 'pane.left.toggle')}
      >
        <span className="glyph">☰</span> Outline
      </button>

      <div className="toolbar-rule" />

      {/* Navigation History */}
      <div className="nav-history-group">
        <button
          className="outline-button"
          onClick={props.onHistoryBack}
          disabled={!canGoBack}
          title={backTooltip}
        >
          ‹
        </button>
        <button
          className="outline-button"
          onClick={props.onHistoryForward}
          disabled={!canGoForward}
          title={forwardTooltip}
        >
          ›
        </button>
      </div>

      <div className="toolbar-rule" />

      {/* Page Navigation Box */}
      <span className="page-control" title="Current page and page label">
        <input
          type="number"
          min={1}
          max={props.totalPages}
          value={props.currentPage}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (!Number.isNaN(val) && val >= 1 && val <= props.totalPages) {
              props.onPageChange(val);
            }
          }}
          aria-label="Target page number"
          style={{
            width: '2.8rem',
            textAlign: 'center',
            background: 'transparent',
            border: '1px solid var(--border-color, #ccc)',
            borderRadius: '4px',
            color: 'inherit',
          }}
        />
        <small>/ {props.totalPages} · {displayLabel !== String(props.currentPage) ? `(${fullBadge})` : `p. ${props.currentPage}`}</small>
      </span>

      <div className="toolbar-rule" />

      {/* View Mode Layout Selector */}
      <div className="layout-mode-group">
        <button
          className={`outline-button ${props.layoutMode === 'single' ? 'active' : ''}`}
          onClick={() => props.onLayoutModeChange('single')}
          title={formatControlTooltip('Single Page View', 'view.single')}
        >
          Single
        </button>
        <button
          className={`outline-button ${props.layoutMode === 'continuous' ? 'active' : ''}`}
          onClick={() => props.onLayoutModeChange('continuous')}
          title={formatControlTooltip('Continuous View', 'view.continuous')}
        >
          Scroll
        </button>
        <button
          className={`outline-button ${props.layoutMode === 'facing' ? 'active' : ''}`}
          onClick={() => facingSupported && props.onLayoutModeChange('facing')}
          disabled={!facingSupported}
          title={facingTooltip}
        >
          Facing
        </button>
      </div>

      <div className="toolbar-rule" />

      {/* Rotate View Controls */}
      <button
        className="outline-button"
        onClick={() => props.onRotateChange('cw')}
        title={formatControlTooltip('Rotate 90° Clockwise', 'view.rotate.cw')}
      >
        ↻ {props.rotation !== 0 && `${props.rotation}°`}
      </button>

      <div className="toolbar-rule" />

      {/* Zoom Controls */}
      <div className="zoom-control-group">
        <button
          className="outline-button"
          onClick={() => props.onZoomChange('out')}
          disabled={props.zoomScale <= 0.25}
          title={formatControlTooltip('Zoom Out', 'view.zoom.out')}
        >
          -
        </button>
        <select
          className="zoom-select"
          value={props.zoomMode === 'custom' ? Math.round(props.zoomScale * 100) : props.zoomMode}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'fit-width') {
              props.onZoomChange('fit-width');
            } else if (val === 'fit-page') {
              props.onZoomChange('fit-page');
            } else {
              props.onZoomChange('set', Number(val) / 100);
            }
          }}
          aria-label="Zoom scale preset"
        >
          <option value={25}>25%</option>
          <option value={50}>50%</option>
          <option value={75}>75%</option>
          <option value={100}>100%</option>
          <option value={125}>125%</option>
          <option value={150}>150%</option>
          <option value={200}>200%</option>
          <option value={300}>300%</option>
          <option value={400}>400%</option>
          <option value={500}>500%</option>
          <option value="fit-width">Fit Width</option>
          <option value="fit-page">Fit Page</option>
        </select>
        <button
          className="outline-button"
          onClick={() => props.onZoomChange('in')}
          disabled={props.zoomScale >= 5.0}
          title={formatControlTooltip('Zoom In', 'view.zoom.in')}
        >
          +
        </button>
        <button
          className={`outline-button ${props.zoomMode === 'fit-width' ? 'active' : ''}`}
          onClick={() => props.onZoomChange('fit-width')}
          title={formatControlTooltip('Fit Page Width', 'view.zoom.fitWidth')}
        >
          Fit Width
        </button>
        <button
          className={`outline-button ${props.zoomMode === 'fit-page' ? 'active' : ''}`}
          onClick={() => props.onZoomChange('fit-page')}
          title={formatControlTooltip('Fit Entire Page', 'view.zoom.fitPage')}
        >
          Fit Page
        </button>
      </div>

      <div className="toolbar-rule" />

      {/* Advanced Full-Text Reader Search Box */}
      <div className="search-control-container" style={{ position: 'relative' }}>
        <label className="search-control" title={formatControlTooltip('Search document text layer (NO AI)', 'search.focus')}>
          <span className="glyph">⌕</span>
          <input
            ref={searchInputRef}
            aria-label="Search document text"
            placeholder="Search text…"
            value={props.searchQuery}
            onChange={(e) => props.onSearchQueryChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />

          {/* Search Depth Toggles */}
          <div className="search-toggle-options">
            <button
              className={`search-toggle-btn ${props.searchOptions.caseSensitive ? 'active' : ''}`}
              onClick={() =>
                props.onSearchOptionsChange({
                  ...props.searchOptions,
                  caseSensitive: !props.searchOptions.caseSensitive,
                })
              }
              title="Case-Sensitive Match (Aa)"
            >
              Aa
            </button>
            <button
              className={`search-toggle-btn ${props.searchOptions.wholeWord ? 'active' : ''}`}
              onClick={() =>
                props.onSearchOptionsChange({
                  ...props.searchOptions,
                  wholeWord: !props.searchOptions.wholeWord,
                })
              }
              title="Whole Word Only (\b)"
            >
              W
            </button>
            <button
              className={`search-toggle-btn ${props.searchOptions.diacriticTolerant ? 'active' : ''}`}
              onClick={() =>
                props.onSearchOptionsChange({
                  ...props.searchOptions,
                  diacriticTolerant: !props.searchOptions.diacriticTolerant,
                })
              }
              title="Diacritic-Tolerant Search (e / é / æ)"
            >
              é
            </button>
          </div>

          <b>
            {props.searchMatches.length > 0
              ? `${props.currentMatchIndex + 1} / ${props.searchMatches.length}`
              : props.searchQuery.trim() ? '0 matches' : ''}
          </b>

          <button
            className="search-nav-btn"
            onClick={props.onPrevMatch}
            disabled={props.searchMatches.length === 0}
            title={formatControlTooltip('Previous match', 'search.prev')}
          >
            ▲
          </button>
          <button
            className="search-nav-btn"
            onClick={props.onNextMatch}
            disabled={props.searchMatches.length === 0}
            title={formatControlTooltip('Next match', 'search.next')}
          >
            ▼
          </button>
        </label>

        {/* Snippet Preview Popup */}
        {showSearchSnippetBox && activeMatch && (
          <div className="search-snippet-preview-card">
            <div className="snippet-card-header">
              <span>Match {props.currentMatchIndex + 1} of {props.searchMatches.length} · Page {activeMatch.pageNumber}</span>
              <button onClick={() => setShowSearchSnippetBox(false)}>×</button>
            </div>
            <div className="snippet-card-body">
              {activeMatch.snippet.slice(0, activeMatch.snippetMatchRange.start)}
              <mark className="snippet-highlight">
                {activeMatch.snippet.slice(
                  activeMatch.snippetMatchRange.start,
                  activeMatch.snippetMatchRange.end
                )}
              </mark>
              {activeMatch.snippet.slice(activeMatch.snippetMatchRange.end)}
            </div>
          </div>
        )}
      </div>

      <div className="toolbar-spacer" />

      <button
        className="outline-button"
        onClick={props.onOpenPdf}
        title="Open another PDF"
      >
        Open PDF
      </button>

      {/* Presentation / Fullscreen Button */}
      <button
        className={`outline-button ${props.isFullscreen ? 'active' : ''}`}
        onClick={props.onToggleFullscreen}
        title={formatControlTooltip('Presentation / Fullscreen mode', 'mode.readingOnly')}
      >
        {props.isFullscreen ? 'Exit Presentation' : 'Presentation'}
      </button>

      {/* Reading Only Toggle */}
      <button
        className="outline-button"
        onClick={props.onToggleReadingOnly}
        title={formatControlTooltip('Reading Only Mode', 'mode.readingOnly')}
      >
        Reading only
      </button>

      {/* Side Pane Toggle */}
      <button
        className={`outline-button ${props.rightOpen ? 'active' : ''}`}
        onClick={props.onToggleRightOpen}
        title={formatControlTooltip('Toggle Annotations Side Pane', 'pane.right.toggle')}
      >
        <span className="glyph">▯</span> Side pane
      </button>

      {/* Local AI Toggle */}
      <button
        className={props.aiOn ? 'ai-toggle on' : 'ai-toggle'}
        onClick={props.onToggleAi}
        title="Local AI status toggle"
      >
        <i /> Local AI · {props.aiOn ? 'On' : 'Off'}
      </button>
    </div>
  );
}
