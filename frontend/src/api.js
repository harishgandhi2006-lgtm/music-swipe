const BASE = '/api';

// ── Auth failure handling ────────────────────────────────────────────────────
// api.js can't reach React context, so AuthContext registers a callback here at
// mount. When the server rejects our token we clear it and let the app fall
// back to the login screen, rather than leaving every view silently empty.
let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'UnauthorizedError';
    this.isUnauthorized = true;
  }
}

function authHeaders() {
  const token = localStorage.getItem('ms_token');
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  // fallback for anonymous swiping (pre-login)
  h['x-user-id'] = localStorage.getItem('ms_anon_id') || 'default';
  return h;
}

/**
 * Single entry point for every API call, so the 401 check can't be forgotten
 * on a new endpoint.
 */
async function request(path, options = {}) {
  const hadToken = !!localStorage.getItem('ms_token');

  const res = await fetch(`${BASE}${path}`, { ...options, headers: authHeaders() });

  if (res.status === 401) {
    // Only tear down a session that actually existed. Anonymous callers hitting
    // an authenticated route shouldn't trigger a spurious "you were logged out".
    if (hadToken) {
      localStorage.removeItem('ms_token');
      localStorage.removeItem('ms_user');
      onUnauthorized?.();
    }
    throw new UnauthorizedError();
  }

  return res;
}

// ── Tracks ──────────────────────────────────────────────────────────────────
export async function fetchNextTrack() {
  const res = await request('/tracks/next');
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(`Failed to fetch track: ${res.status}`);
  return res.json();
}

// ── Interactions ─────────────────────────────────────────────────────────────
export async function postInteraction(track_id, action) {
  const res = await request('/interactions', {
    method: 'POST',
    body: JSON.stringify({ track_id, action }),
  });
  if (!res.ok) throw new Error(`Failed to post interaction: ${res.status}`);
  return res.json();
}

// Undo: removes the most recent matching interaction server-side, within a
// short grace window enforced by the backend. 404 means the window already
// closed (or there was nothing to remove) — callers treat that as a no-op.
export async function deleteInteraction(track_id) {
  const res = await request(`/interactions/${track_id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to undo: ${res.status}`);
  return res.status === 404 ? { ok: false } : res.json();
}

export async function fetchHistory() {
  const res = await request('/interactions/history');
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

// The permanent liked archive. Paginated because this grows without bound —
// unlike the session log, which the browser discards on its own.
export async function fetchLikedArchive(limit = 50, offset = 0) {
  const res = await request(`/interactions/liked?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error('Failed to fetch liked archive');
  return res.json();
}

// ── Profile ──────────────────────────────────────────────────────────────────
export async function fetchProfile() {
  const res = await request('/profile');
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

// ── Taste-weight preferences ─────────────────────────────────────────────────
export async function fetchPreferences() {
  const res = await request('/profile/preferences');
  if (!res.ok) throw new Error('Failed to fetch preferences');
  return res.json();
}

export async function updatePreferences(prefs) {
  const res = await request('/profile/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Failed to update preferences');
  return res.json();
}
