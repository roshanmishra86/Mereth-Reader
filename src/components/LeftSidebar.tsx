import { useState } from 'react';
import { OutlineTree } from './OutlineTree';
import { ThumbnailPanel } from './ThumbnailPanel';
import { ParsedOutlineNode, PageLabelMapping } from '../utils/navigationUtils';
import { Icon } from './icons';

interface LeftSidebarProps {
  outlineNodes: ParsedOutlineNode[];
  totalPages: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
  customPageLabels?: Record<number, PageLabelMapping>;
  width?: number;
}

export function LeftSidebar({
  outlineNodes,
  totalPages,
  currentPage,
  onSelectPage,
  customPageLabels,
  width,
}: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState<'outline' | 'thumbnails'>('outline');

  return (
    <aside className="left-sidebar-pane" style={width ? { width: `${width}px` } : undefined}>
      <div className="sidebar-tab-header">
        <button
          className={`sidebar-tab-btn ${activeTab === 'outline' ? 'active' : ''}`}
          onClick={() => setActiveTab('outline')}
          title="Document outline tree (Ctrl+Shift+L)"
        >
          <Icon name="list" /> Outline
        </button>
        <button
          className={`sidebar-tab-btn ${activeTab === 'thumbnails' ? 'active' : ''}`}
          onClick={() => setActiveTab('thumbnails')}
          title="Page thumbnails panel"
        >
          <Icon name="library" /> Thumbnails ({totalPages})
        </button>
      </div>

      <div className="sidebar-content-body">
        {activeTab === 'outline' ? (
          <OutlineTree
            nodes={outlineNodes}
            currentPage={currentPage}
            onSelectPage={onSelectPage}
          />
        ) : (
          <ThumbnailPanel
            totalPages={totalPages}
            currentPage={currentPage}
            onSelectPage={onSelectPage}
            customPageLabels={customPageLabels}
          />
        )}
      </div>
    </aside>
  );
}
