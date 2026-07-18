import db from '../db.js';

// ── Config ────────────────────────────────────────────────────────────────────

// Genre overlap is the broad signal; artist overlap is rarer but much stronger
// evidence of shared taste, so it carries weight disproportionate to its size.
const WEIGHTS = { genre: 0.55, artist: 0.45 };

// Ceiling on how much overlap we require before trusting a score fully. Held
// against the *available* data (see confidenceFor) rather than used directly:
// a fixed bar would zero out every match while the app is young and everyone's
// history is thin.
const CONFIDENCE_SATURATION = 12;

const MIN_SCORE = 0.05; // don't surface matches this weak

// ── Vector math ───────────────────────────────────────────────────────────────

// Sublinear weighting: someone's 50th rap like says less than their 5th.
function weight(likes) {
  return Math.log1p(likes);
}

// Cosine similarity over two Map<key, { likes }> vectors.
function cosine(vecA, vecB) {
  if (!vecA?.size || !vecB?.size) return 0;

  // Iterate the smaller vector for the dot product
  const [small, large] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

  let dot = 0;
  for (const [key, { likes }] of small) {
    const other = large.get(key);
    if (other) dot += weight(likes) * weight(other.likes);
  }
  if (dot === 0) return 0;

  let normA = 0, normB = 0;
  for (const { likes } of vecA.values()) normA += weight(likes) ** 2;
  for (const { likes } of vecB.values()) normB += weight(likes) ** 2;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Keys present in both vectors, ranked by how much both users like them.
function sharedItems(vecA, vecB, limit) {
  if (!vecA?.size || !vecB?.size) return [];
  const shared = [];
  for (const [key, a] of vecA) {
    const b = vecB.get(key);
    if (b) shared.push({ name: a.name || b.name, strength: Math.min(a.likes, b.likes) });
  }
  return shared
    .sort((x, y) => y.strength - x.strength)
    .slice(0, limit)
    .map(s => s.name)
    .filter(Boolean);
}

// Total overlapping likes across both dimensions — our proxy for how much
// evidence the similarity score is actually resting on.
function overlapVolume(vecA, vecB) {
  if (!vecA?.size || !vecB?.size) return 0;
  let total = 0;
  for (const [key, a] of vecA) {
    const b = vecB.get(key);
    if (b) total += Math.min(a.likes, b.likes);
  }
  return total;
}

function totalLikes(vec) {
  if (!vec?.size) return 0;
  let n = 0;
  for (const { likes } of vec.values()) n += likes;
  return n;
}

// How much to trust a similarity score, given how much history exists to judge
// on. Graded against the thinner of the two profiles: if both users have only
// six likes each and share four, that's strong evidence *for the data we have*,
// and should rank higher than an absolute-threshold rule would allow.
function confidenceFor(overlap, myTotal, theirTotal) {
  const available = Math.min(myTotal, theirTotal, CONFIDENCE_SATURATION);
  if (available <= 0) return 0;
  return Math.min(1, overlap / available);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Rank users by music-taste similarity to `userId`.
 * Excludes existing friends and pending requests.
 * Returns [{ id, username, score, sharedGenres, sharedArtists }]
 */
export function getTasteMatches(userId, limit = 20) {
  const candidates = db.getTasteMatchCandidates(userId);
  if (candidates.length === 0) return [];

  const allIds = [userId, ...candidates.map(c => c.id)];
  const genreVectors = db.getGenreVectors(allIds);
  const artistVectors = db.getArtistVectors(allIds);

  const myGenres = genreVectors.get(userId);
  const myArtists = artistVectors.get(userId);

  // No taste profile yet — nothing meaningful to match on.
  if (!myGenres?.size && !myArtists?.size) return [];

  return candidates
    .map(candidate => {
      const theirGenres = genreVectors.get(candidate.id);
      const theirArtists = artistVectors.get(candidate.id);

      const genreSim = cosine(myGenres, theirGenres);
      const artistSim = cosine(myArtists, theirArtists);
      const raw = WEIGHTS.genre * genreSim + WEIGHTS.artist * artistSim;

      const overlap = overlapVolume(myGenres, theirGenres) + overlapVolume(myArtists, theirArtists);
      const confidence = confidenceFor(
        overlap,
        totalLikes(myGenres) + totalLikes(myArtists),
        totalLikes(theirGenres) + totalLikes(theirArtists),
      );

      return {
        id: candidate.id,
        username: candidate.username,
        score: Math.round(raw * confidence * 100) / 100,
        sharedGenres: sharedItems(myGenres, theirGenres, 3),
        sharedArtists: sharedItems(myArtists, theirArtists, 3),
      };
    })
    .filter(m => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
