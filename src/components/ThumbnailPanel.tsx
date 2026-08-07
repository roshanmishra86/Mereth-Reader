import { formatExtendedPageLabel, PageLabelMapping } from '../utils/navigationUtils';

interface ThumbnailPanelProps {
  totalPages: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
  customPageLabels?: Record<number, PageLabelMapping>;
}

export function ThumbnailPanel({
  totalPages,
  currentPage,
  onSelectPage,
  customPageLabels,
}: ThumbnailPanelProps) {
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="thumbnail-panel-container">
      <div className="thumbnail-grid" role="listbox" aria-label="Page thumbnails">
        {pageNumbers.map((page) => {
          const isActive = page === currentPage;
          const { displayLabel, physicalInfo } = formatExtendedPageLabel(
            page,
            totalPages,
            customPageLabels
          );

          return (
            <button
              key={page}
              className={`thumbnail-card ${isActive ? 'active' : ''}`}
              onClick={() => onSelectPage(page)}
              role="option"
              aria-selected={isActive}
              title={`Jump to page ${displayLabel} (${physicalInfo})`}
            >
              <div className="thumbnail-preview-frame">
                <div className="thumbnail-paper-mock">
                  <div className="thumb-line thumb-header" />
                  <div className="thumb-line thumb-title" />
                  <div className="thumb-line thumb-text" />
                  <div className="thumb-line thumb-text short" />
                  <div className="thumb-line thumb-text" />
                </div>
                <div className="thumbnail-page-number">{displayLabel}</div>
              </div>
              <span className="thumbnail-label">{physicalInfo}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
