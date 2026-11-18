import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';

export const SEARCH_DEBOUNCE_MS = 150;

/** A path with the matched part in bold. Repository text is rendered as text, never as HTML. */
function Match({ path, start, end }) {
  return (
    <>
      {path.slice(0, start)}
      <strong>{path.slice(start, end)}</strong>
      {path.slice(end)}
    </>
  );
}

/**
 * The search bar over the canvas (spec 8.6): up to 20 matching file paths as the user types
 * (debounced 150 ms). Enter or a click selects the file and enters focus mode; Escape clears.
 */
export default function SearchBar() {
  const search = useWorkspaceStore((s) => s.search);
  const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery);
  const clearSearch = useWorkspaceStore((s) => s.clearSearch);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const [value, setValue] = useState('');
  const [active, setActive] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const type = (next) => {
    setValue(next);
    setActive(0);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearchQuery(next), SEARCH_DEBOUNCE_MS);
  };

  const clear = () => {
    clearTimeout(timer.current);
    setValue('');
    clearSearch();
  };

  const choose = (result) => {
    selectFile(result.id);
    clear();
  };

  const { results, query } = search;
  const open = query.trim() !== '';

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Escape clears the search; focus mode only exits on an Escape with nothing to clear.
      if (value !== '' || open) {
        event.preventDefault();
        clear();
      }
    } else if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      choose(results[Math.min(active, results.length - 1)]);
    }
  };

  return (
    <div className="gc-search nodrag nopan">
      <div className="gc-search-field">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label="Search files"
          aria-expanded={open}
          aria-controls="gc-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search files…"
          value={value}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul id="gc-search-results" role="listbox" className="gc-search-results">
          {results.length === 0 ? (
            <li className="gc-search-empty">No files match &apos;{query}&apos;</li>
          ) : (
            results.map((result, i) => (
              <li
                key={result.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                onMouseEnter={() => setActive(i)}
                // mousedown, so the pick lands before the input loses focus.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(result);
                }}
              >
                <Match {...result} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
