import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { updateAffinityScores } from '../services/recommender.js';
import { evaluateBadges } from '../services/badges.js';
import { JWT_SECRET } from '../middleware/auth.js';

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

router.get('/history', (req, res) => {
  const { userId } = getAuthInfo(req);
  res.json(db.getHistory(userId, 100));
});

router.get('/genres', (req, res) => {
  const { userId } = getAuthInfo(req);
  res.json(db.getGenreScores(userId));
});

export default router;
