// Layer 1 of history: what was swiped during *this* session.
//
// Deliberately never sent to the server. The permanent record already exists in
// the `interactions` table and is served by the liked archive, so persisting
// this too would create a second source of truth that can disagree with it.
// sessionStorage is the platform's own definition of "until the app is closed",
// which means the reset this feature calls for is handled by the browser rather
// than by expiry logic we would have to keep correct ourselves.

const KEY = 'ms_session_history';
const CAP = 100; // a review list for one sitting, not an archive

const listeners = new Set();

// useSyncExternalStore compares snapshots by identity, so it must be handed the
// same array until something actually changes — re-parsing storage on every
// read would return a fresh array each time and spin the render loop.
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = []; // unavailable or corrupt storage shouldn't take the app down
  }
  return cache;
}

function write(next) {
  cache = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or quota. The in-memory cache still serves this session, so
    // history keeps working — it just won't survive a refresh.
  }
  listeners.forEach(fn => fn());
}

export function recordSwipe(track, action) {
  if (!track?.id) return;

  const entry = {
    track_id: track.id,
    action,
    swiped_at: Date.now(),
    title: track.title,
    artist_name: track.artist_name,
    cover_url: track.cover_url,
    genre_name: track.genre_name,
    // Already a proxy path (/api/proxy/audio?trackId=…) rather than a signed
    // CDN URL, so it stays playable for as long as the entry is listed.
    previewUrl: track.preview_url,
  };

  // Newest first, one row per track: swiping the same song again moves it up
  // the list instead of appearing twice.
  write([entry, ...read().filter(e => e.track_id !== track.id)].slice(0, CAP));
}

export function clearSessionHistory() {
  write([]);
}

// Undo support: drop this session's record of a swipe. Does not touch the
// live deck — the pool has already moved past this track by the time an undo
// can happen, so this only ever affects the history list, not what's served.
export function removeSwipe(track_id) {
  write(read().filter(e => e.track_id !== track_id));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return read();
}
