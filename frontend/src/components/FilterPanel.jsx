import { useEffect, useRef, useState } from 'react';
import { searchMusic } from '../api.js';

export default function FilterPanel({ activeFilter, onFilterSelect, onClearFilter }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchMusic(query.trim()));
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  function select(filter) {
    onFilterSelect(filter);
    setQuery('');
    setResults(null);
  }

  const hasResults = results && (
    results.genres.length > 0 || results.artists.length > 0 || results.tracks.length > 0
  );

  // ── Active filter chip ────────────────────────────────────────────────────
  if (activeFilter) {
    const icon = activeFilter.type === 'genre' ? '🎵'
      : activeFilter.type === 'artist' ? '🎤' : '🎧';
    return (
      <div className="px-4 py-1 flex items-center gap-2">
        <span className="text-white/40 text-xs">Filtering by</span>
        <div className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-full pl-3 pr-2 py-1">
          <span className="text-sm">{icon}</span>
          <span className="text-white text-sm font-medium">{activeFilter.label}</span>
          <button
            onClick={onClearFilter}
            className="ml-1 text-white/50 hover:text-white text-lg leading-none"
            aria-label="Clear filter"
          >×</button>
        </div>
      </div>
    );
  }

  // ── Search input + dropdown ───────────────────────────────────────────────
  return (
    <div className="px-4 relative">
      <div className="relative">
        <input
          ref={inputRef}
          className="w-full bg-white/10 text-white placeholder-white/40 rounded-xl px-4 py-2.5 text-sm outline-none focus:bg-white/15 transition-colors"
          placeholder="Genre, artist, or song to find similar…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        )}
      </div>

      {results && (
        <div className="absolute left-4 right-4 top-full mt-1 bg-neutral-900 border border-white/10 rounded-2xl overflow-hidden z-50 shadow-2xl">
          {hasResults ? (
            <>
              {results.genres.length > 0 && (
                <section>
                  <p className="text-white/40 text-xs uppercase tracking-wider px-4 pt-3 pb-1">Genres</p>
                  {results.genres.map(g => (
                    <button
                      key={g.name}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/10 text-white text-sm flex items-center gap-3 transition-colors"
                      onClick={() => select({ type: 'genre', name: g.name, label: g.name })}
                    >
                      <span className="text-base">🎵</span> {g.name}
                    </button>
                  ))}
                </section>
              )}

              {results.artists.length > 0 && (
                <section>
                  <p className="text-white/40 text-xs uppercase tracking-wider px-4 pt-3 pb-1">Artists</p>
                  {results.artists.map(a => (
                    <button
                      key={a.id}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/10 text-white text-sm flex items-center gap-3 transition-colors"
                      onClick={() => select({ type: 'artist', id: a.id, name: a.name, label: a.name })}
                    >
                      {a.picture
                        ? <img src={a.picture} className="w-7 h-7 rounded-full object-cover flex-shrink-0" alt="" />
                        : <span className="text-base">🎤</span>}
                      {a.name}
                    </button>
                  ))}
                </section>
              )}

              {results.tracks.length > 0 && (
                <section>
                  <p className="text-white/40 text-xs uppercase tracking-wider px-4 pt-3 pb-1">Similar to song</p>
                  {results.tracks.map(t => (
                    <button
                      key={t.id}
                      className="w-full text-left px-4 py-2.5 hover:bg-white/10 text-white text-sm flex items-center gap-3 transition-colors"
                      onClick={() => select({ type: 'song', id: t.id, label: `${t.title} · ${t.artist_name}` })}
                    >
                      {t.cover_url
                        ? <img src={t.cover_url} className="w-7 h-7 rounded object-cover flex-shrink-0" alt="" />
                        : <span className="text-base">🎧</span>}
                      <span className="truncate">
                        {t.title} <span className="text-white/50">· {t.artist_name}</span>
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </>
          ) : (
            <p className="text-white/40 text-sm px-4 py-5 text-center">No results for "{query}"</p>
          )}
        </div>
      )}
    </div>
  );
}
