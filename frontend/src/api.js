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

export async function fetchHistory() {
  const res = await request('/interactions/history');
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

// ── Social: user search & profile ───────────────────────────────────────────
export async function searchUsers(query) {
  const res = await request(`/users/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

export async function fetchUserProfile(userId) {
  const res = await request(`/users/${userId}/profile`);
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

// ── Social: taste matcher ────────────────────────────────────────────────────
export async function fetchTasteMatches(limit = 20) {
  const res = await request(`/users/taste-matches?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch taste matches');
  return res.json();
}

// ── Social: friends ──────────────────────────────────────────────────────────
export async function sendFriendRequest(targetId) {
  const res = await request('/friends/request', {
    method: 'POST',
    body: JSON.stringify({ targetId }),
  });
  return res.json();
}

export async function respondFriendRequest(friendshipId, status) {
  const res = await request('/friends/respond', {
    method: 'POST',
    body: JSON.stringify({ friendshipId, status }),
  });
  return res.json();
}

export async function fetchFriends() {
  const res = await request('/friends');
  if (!res.ok) throw new Error('Failed to fetch friends');
  return res.json();
}

export async function fetchPendingRequests() {
  const res = await request('/friends/pending');
  if (!res.ok) throw new Error('Failed to fetch pending requests');
  return res.json();
}

export async function removeFriend(friendshipId) {
  const res = await request(`/friends/${friendshipId}`, { method: 'DELETE' });
  return res.json();
}

// ── Social: sharing & inbox ──────────────────────────────────────────────────
// itemType is 'track' or 'artist'
export async function shareItem(receiverId, itemType, itemId, message = null) {
  const res = await request('/share', {
    method: 'POST',
    body: JSON.stringify({ receiverId, itemType, itemId, message }),
  });
  if (!res.ok) throw new Error('Failed to share');
  return res.json();
}

export async function fetchInbox() {
  const res = await request('/inbox');
  if (!res.ok) throw new Error('Failed to fetch inbox');
  return res.json();
}

export async function fetchUnseenCount() {
  try {
    const res = await request('/inbox/unseen-count');
    if (!res.ok) return { count: 0 };
    return res.json();
  } catch (err) {
    if (err.isUnauthorized) throw err; // let the session teardown propagate
    return { count: 0 };
  }
}

export async function markSeen(sharedItemId) {
  const res = await request(`/inbox/${sharedItemId}/seen`, { method: 'POST' });
  return res.json();
}
