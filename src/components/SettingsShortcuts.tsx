import { useState } from 'react';
import { SHORTCUT_LIST, KeyboardShortcut } from '../utils/shortcutUtils';

export function SettingsShortcuts() {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', 'View', 'Navigation', 'Search', 'Panes & Mode', 'Annotations & Notes'];

  const filteredShortcuts = SHORTCUT_LIST.filter((sc: KeyboardShortcut) => {
    const matchesCat = selectedCategory === 'All' || sc.category === selectedCategory;
    const matchesSearch =
      sc.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      sc.keys.toLowerCase().includes(filterQuery.toLowerCase()) ||
      sc.description.toLowerCase().includes(filterQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="settings-shortcuts-view">
      <div className="shortcuts-header">
        <div>
          <span className="eyebrow">Discoverable Controls · FR-8.7</span>
          <h2>Keyboard Shortcuts Map</h2>
          <p>Full keyboard accessibility for view modes, navigation, search, panes, and reading actions.</p>
        </div>
      </div>

      <div className="shortcuts-filter-bar">
        <div className="category-pills">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`pill-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <input
          className="shortcuts-search-input"
          type="text"
          placeholder="Filter shortcuts (e.g. Ctrl+F, rotate, zoom)…"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      </div>

      <div className="shortcuts-table-wrapper">
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Shortcut Keys</th>
              <th>Category</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {filteredShortcuts.map((sc) => (
              <tr key={sc.id}>
                <td className="sc-name">
                  <strong>{sc.name}</strong>
                </td>
                <td className="sc-keys">
                  <kbd>{sc.keys}</kbd>
                </td>
                <td className="sc-category">
                  <span className="badge">{sc.category}</span>
                </td>
                <td className="sc-desc">{sc.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredShortcuts.length === 0 && (
          <div className="shortcuts-empty-state">No matching keyboard shortcuts found.</div>
        )}
      </div>
    </div>
  );
}
