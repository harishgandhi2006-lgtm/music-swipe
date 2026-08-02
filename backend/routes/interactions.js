import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { updateAffinityScores } from '../services/recommender.js';
import { evaluateBadges } from '../services/badges.js';
import { JWT_SECRET, requireAuth } from '../middleware/auth.js';

const router = Router();

function getAuthInfo(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      return { userId: String(payload.userId), intId: payload.userId };
    } catch {}
  }
  return { userId: req.headers['x-user-id'] || 'default', intId: null };
}

router.post('/', (req, res) => {
  const { userId, intId } = getAuthInfo(req);
  const { track_id, action } = req.body;

  if (!track_id || !['like', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'track_id and action (like|reject) required' });
  }

  const track = db.getTrack(track_id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  db.insertInteraction(userId, track_id, action);
  updateAffinityScores(userId, track_id);

  const newBadges = intId ? evaluateBadges(userId, intId) : [];
  res.status(201).json({ ok: true, newBadges });
});

// Undo. requireAuth rather than the getAuthInfo fallback used by POST /: an
// anonymous caller undoing against the shared 'default' bucket could delete
// someone else's interaction, the same risk /liked already guards against.
// The 10s server-side window is deliberately looser than the client's own
// undo-affordance timeout, so a slow network never turns a valid undo into a
// no-op 404.
router.delete('/:trackId', requireAuth, (req, res) => {
  const trackId = Number(req.params.trackId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return res.status(400).json({ error: 'invalid trackId' });
  }

  const removed = db.deleteRecentInteraction(req.userId, trackId, 10_000);
  if (!removed) return res.status(404).json({ error: 'No recent matching interaction to undo' });

  // Same recompute-from-live-counts path a fresh swipe uses — deleting the
  // row first means it recomputes to exactly what the scores would have been
  // had the swipe never happened.
  updateAffinityScores(req.userId, trackId);
  res.status(200).json({ ok: true });
});

router.get('/history', (req, res) => {
  const { userId } = getAuthInfo(req);
  res.json(db.getHistory(userId, 100));
});

// The permanent liked archive. requireAuth rather than the getAuthInfo fallback
// used above: an anonymous caller would otherwise be handed whatever the shared
// 'default' bucket happens to hold, which is someone else's listening history.
router.get('/liked', requireAuth, (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const items = db.getLikedArchive(req.userId, limit, offset).map(row => ({
    ...row,
    // Signed on demand for the same reason the discover feed is: a preview URL
    // stored alongside the like would have expired within 15 minutes, and an
    // archived like is replayed days later by definition.
    previewUrl: `/api/proxy/audio?trackId=${row.track_id}`,
  }));

  res.json({ items, total: db.countLikedArchive(req.userId), limit, offset });
});

router.get('/genres', (req, res) => {
  const { userId } = getAuthInfo(req);
  res.json(db.getGenreScores(userId));
});

export default router;
