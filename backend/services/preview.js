import { getTrack } from './deezer.js';

// Deezer signs every preview URL with an Akamai `hdnea` token that expires ~15
// minutes after it is minted. That is far shorter than the lifetime of anything
// we store: a track can sit in the recommender pool, in the `tracks` table, or
// in someone's inbox for hours or days. Serving the saved URL therefore hands
// the browser a link the CDN answers with 403, and <audio> reports that as a
// silent failure to play.
//
// So we never persist the signed URL for playback — we resolve it at the moment
// the browser actually asks for the bytes. The token is then always live, no
// matter how stale the surrounding track record is.
const TTL_MS = 10 * 60 * 1000; // comfortably inside the token's own lifetime

const cache = new Map(); // trackId -> { promise, expiresAt }

export function resolvePreviewUrl(trackId) {
  const hit = cache.get(trackId);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;

  // Cache the promise rather than the resolved value: one <audio> element fires
  // several overlapping range requests per play, and they should share a single
  // Deezer call instead of racing to make their own.
  const promise = getTrack(trackId)
    .then(track => track.preview || null)
    .catch(err => {
      cache.delete(trackId); // don't pin a transient failure for the full TTL
      throw err;
    });

  cache.set(trackId, { promise, expiresAt: Date.now() + TTL_MS });
  return promise;
}
