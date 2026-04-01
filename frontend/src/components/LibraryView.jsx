import { useMemo, useState } from 'react';

function bucketLabel(item, mode) {
  if (mode === 'genre') return item.genre_name?.trim() || 'Unknown genre';
  return item.artist_name?.trim() || 'Unknown artist';
}

function groupItems(items, mode) {
  const map = new Map();
  for (const item of items) {
    const key = bucketLabel(item, mode);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default function LibraryView({ history, mode }) {
  const [openKey, setOpenKey] = useState(null);

  const likes = useMemo(() => history.filter((h) => h.action === 'like'), [history]);

  const groupedLikes = useMemo(() => {
    if (mode !== 'liked') return [];
    return groupItems(likes, 'genre');
  }, [likes, mode]);

  const groupedByArtist = useMemo(() => {
    if (mode !== 'liked') return [];
    return groupItems(likes, 'artist');
  }, [likes, mode]);

  const [likedTab, setLikedTab] = useState('genre');
  const sections = likedTab === 'genre' ? groupedLikes : groupedByArtist;

  if (mode === 'history') {
    return (
      <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
        {history.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No swipes yet.</p>
        ) : (
          history.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 border border-white/10"
            >
              {row.cover_url ? (
                <img
                  src={row.cover_url}
                  alt=""
                  className="w-14 h-14 rounded-xl object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-white/10 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white font-medium text-sm truncate">{row.title || 'Track'}</p>
                <p className="text-white/50 text-xs truncate">{row.artist_name}</p>
                <span
                  className={
                    row.action === 'like'
                      ? 'text-green-400/90 text-[10px] font-semibold uppercase tracking-wide'
                      : 'text-red-400/90 text-[10px] font-semibold uppercase tracking-wide'
                  }
                >
                  {row.action === 'like' ? 'Liked' : 'Passed'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex rounded-xl bg-white/10 p-0.5 shrink-0">
        <button
          type="button"
          onClick={() => setLikedTab('genre')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
            likedTab === 'genre' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          By genre
        </button>
        <button
          type="button"
          onClick={() => setLikedTab('artist')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
            likedTab === 'artist' ? 'bg-white/20 text-white' : 'text-white/50'
          }`}
        >
          By artist
        </button>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 pr-1 space-y-2">
        {likes.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No likes yet. Swipe right on songs you love.</p>
        ) : (
          sections.map(([label, rows]) => (
            <div key={label} className="rounded-2xl border border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenKey((k) => (k === label ? null : label))}
                className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 transition text-left"
              >
                <span className="text-white font-medium text-sm">{label}</span>
                <span className="text-white/40 text-xs">{rows.length}</span>
              </button>
              {openKey === label && (
                <ul className="border-t border-white/10 divide-y divide-white/5">
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                      {row.cover_url ? (
                        <img
                          src={row.cover_url}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-white/10 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-white/90 text-sm truncate">{row.title}</p>
                        <p className="text-white/40 text-xs truncate">{row.artist_name}</p>
                      </div>
                      {row.preview_url && (
                        <audio
                          controls
                          src={row.preview_url}
                          className="h-8 max-w-[120px] [&::-webkit-media-controls-panel]:bg-white/10"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
