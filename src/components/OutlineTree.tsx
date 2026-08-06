import React, { useState } from 'react';
import { ParsedOutlineNode } from '../utils/navigationUtils';
import { EmptyState } from './EmptyState';

interface OutlineTreeProps {
  nodes: ParsedOutlineNode[];
  currentPage: number;
  onSelectPage: (page: number) => void;
}

export function OutlineTree({ nodes, currentPage, onSelectPage }: OutlineTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(() => {
    // Expand root items by default
    const initial: Record<string, boolean> = {};
    nodes.forEach((n) => {
      initial[n.id] = true;
    });
    return initial;
  });

  const [filterQuery, setFilterQuery] = useState('');

  const toggleExpand = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const matchesFilter = (node: ParsedOutlineNode, q: string): boolean => {
    if (!q) return true;
    const normQ = q.toLowerCase();
    if (node.title.toLowerCase().includes(normQ)) return true;
    if (node.children && node.children.some((child) => matchesFilter(child, q))) return true;
    return false;
  };

  const renderNode = (node: ParsedOutlineNode) => {
    if (!matchesFilter(node, filterQuery)) return null;

    const hasChildren = node.children && node.children.length > 0;
    // While a filter is active, force-expand any node that itself matches (or
    // has a matching descendant) so the matching descendant is actually
    // revealed instead of being hidden under a collapsed ancestor.
    const isExpanded = filterQuery
      ? matchesFilter(node, filterQuery)
      : (expandedNodes[node.id] ?? true);
    const isActive = node.pageNumber === currentPage;

    const handleRowActivate = () => {
      if (node.pageNumber) {
        onSelectPage(node.pageNumber);
      }
    };

    return (
      <div key={node.id} className="outline-tree-item" style={{ paddingLeft: `${node.level * 12}px` }}>
        <div
          className={`outline-row ${isActive ? 'active' : ''}`}
          onClick={handleRowActivate}
          onKeyDown={(e) => {
            // FR-8.7: outline-to-page navigation must be reachable by keyboard.
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
              e.preventDefault();
              handleRowActivate();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={node.pageNumber ? `${node.title} — jump to page ${node.pageNumber}` : node.title}
          title={node.pageNumber ? `Jump to ${node.title} (Page ${node.pageNumber})` : node.title}
        >
          {hasChildren ? (
            <button
              className="outline-chevron"
              onClick={(e) => toggleExpand(node.id, e)}
              aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="outline-chevron-spacer" />
          )}

          <span className="outline-title">{node.title}</span>

          {node.pageNumber && (
            <span className="outline-page-badge">{node.pageNumber}</span>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div className="outline-children">
            {node.children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="outline-tree-container">
      <div className="outline-search-box">
        <span className="outline-search-icon">⌕</span>
        <input
          type="text"
          placeholder="Filter outline…"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          aria-label="Filter outline sections"
        />
        {filterQuery && (
          <button className="outline-search-clear" onClick={() => setFilterQuery('')}>
            ×
          </button>
        )}
      </div>

      <nav className="outline-tree-list" aria-label="Document outline tree">
        {nodes.length === 0 ? (
          <EmptyState
            viewType="outline"
            customTitle="No document outline"
            customDescription="This PDF does not contain a table of contents or bookmarks structure."
          />
        ) : (
          (() => {
            const rendered = nodes.map((node) => renderNode(node)).filter(Boolean);
            if (rendered.length === 0 && filterQuery) {
              return (
                <EmptyState
                  viewType="search"
                  context={{ searchQuery: filterQuery }}
                  customTitle="No matching outline items"
                  customDescription={`No section titles matched "${filterQuery}".`}
                  onPrimaryAction={() => setFilterQuery('')}
                />
              );
            }
            return rendered;
          })()
        )}
      </nav>
    </div>
  );
}
