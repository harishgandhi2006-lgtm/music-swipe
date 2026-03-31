import fetch from 'node-fetch';

const BASE = 'https://api.deezer.com';
const MIN_INTERVAL_MS = 300; // max ~3 req/sec to stay well under quota

let lastCallTime = 0;

async function deezerGet(path) {
  // Enforce minimum interval between requests
  const wait = Math.max(0, lastCallTime + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallTime = Date.now();

  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status} for ${path}`);
  const data = await res.json();

  if (data.error) {
    const err = new Error(`Deezer API error: ${JSON.stringify(data.error)}`);
    err.code = data.error.code;
    // code 4 = quota exceeded — callers should not retry
    if (data.error.code === 4) err.isQuota = true;
    throw err;
  }
  return data;
}

export async function getChart(limit = 50) {
  const data = await deezerGet(`/chart/0/tracks?limit=${limit}`);
  return data.data || [];
}

export async function searchTracks(query, limit = 100, index = 0) {
  const q = encodeURIComponent(query);
  const data = await deezerGet(`/search?q=${q}&limit=${limit}&index=${index}`);
  return data.data || [];
}

export async function getAlbum(albumId) {
  return deezerGet(`/album/${albumId}`);
}

export async function getArtistTop(artistId, limit = 50) {
  const data = await deezerGet(`/artist/${artistId}/top?limit=${limit}`);
  return data.data || [];
}

export async function getTrackRadio(trackId, limit = 25) {
  const data = await deezerGet(`/track/${trackId}/radio?limit=${limit}`);
  return data.data || [];
}

export async function getRelatedArtists(artistId, limit = 10) {
  const data = await deezerGet(`/artist/${artistId}/related?limit=${limit}`);
  return data.data || [];
}
