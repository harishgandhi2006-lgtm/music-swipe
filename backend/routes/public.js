import { Router } from 'express';
import db from '../db.js';
import { getTrack as fetchDeezerTrack } from '../services/deezer.js';

const router = Router();

// Deliberately unauthenticated: this exposes only public Deezer catalogue
// metadata (title/artist/cover/preview), the same data every /tracks/next
// response already contains — never a user's own data, never scoped to a
// userId. See .claude/skills/strict-isolation/SKILL.md: a share link carries
// no linkage between the sharer and any recipient, so there's nothing here
// for that policy to forbid.
router.get('/tracks/:trackId/public-preview', async (req, res) => {
  const trackId = Number(req.params.trackId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return res.status(400).json({ error: 'invalid trackId' });
  }

  let track = db.getTrack(trackId);

  if (!track) {
    // Not in our cache — e.g. a link opened on a fresh install, or for a
    // track this server never pooled. Fall back to a single live lookup
    // rather than 404ing on data Deezer can still answer.
    try {
      const raw = await fetchDeezerTrack(trackId);
      track = {
        title: raw.title,
        artist_name: raw.artist?.name || '',
        cover_url: raw.album?.cover_medium || raw.album?.cover || '',
        genre_name: null,
        duration: raw.duration || 0,
      };
    } catch {
      return res.status(404).json({ error: 'Track not found' });
    }
  }

  res.json({
    id: trackId,
    title: track.title,
    artist_name: track.artist_name,
    cover_url: track.cover_url,
    genre_name: track.genre_name,
    duration: track.duration,
    previewUrl: `/api/proxy/audio?trackId=${trackId}`,
  });
});

export default router;
