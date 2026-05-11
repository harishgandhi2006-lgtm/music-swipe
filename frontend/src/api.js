import { getUserId } from './userId.js';

const BASE = '/api';

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-user-id': getUserId(),
  };
}

export async function fetchNextTrack(filter = null) {
  const params = new URLSearchParams();
  if (filter) {
    params.set('filter_type', filter.type);
    if (filter.id)   params.set('filter_id',   filter.id);
    if (filter.name) params.set('filter_name', filter.name);
  }
  const qs  = params.toString();
  const res = await fetch(`${BASE}/tracks/next${qs ? '?' + qs : ''}`, { headers: headers() });
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(`Failed to fetch track: ${res.status}`);
  return res.json();
}

export async function searchMusic(query) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`, { headers: headers() });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export async function postInteraction(track_id, action) {
  const res = await fetch(`${BASE}/interactions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ track_id, action }),
  });
  if (!res.ok) throw new Error(`Failed to post interaction: ${res.status}`);
  return res.json();
}

export async function fetchHistory() {
  const res = await fetch(`${BASE}/interactions/history`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

export async function fetchGenreScores() {
  const res = await fetch(`${BASE}/interactions/genres`, { headers: headers() });
  if (!res.ok) throw new Error(`Failed to fetch genre scores: ${res.status}`);
  return res.json();
}

export async function postUndo() {
  const res = await fetch(`${BASE}/interactions/undo`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Failed to undo: ${res.status}`);
  return res.json();
}
