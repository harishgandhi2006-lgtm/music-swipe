import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getNextTrack, warmPool } from '../services/recommender.js';
import { JWT_SECRET } from '../middleware/auth.js';

const router = Router();

function getUserId(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      return String(payload.userId);
    } catch {}
  }
  return req.headers['x-user-id'] || 'default';
}

router.get('/next', async (req, res) => {
  const userId = getUserId(req);
  warmPool(userId);
  try {
    const track = await getNextTrack(userId);
    if (!track) return res.status(503).json({ error: 'No tracks available right now' });
    res.json({
      ...track,
      preview_url: `/api/proxy/audio?url=${encodeURIComponent(track.preview_url)}`,
    });
  } catch (err) {
    console.error('Error fetching next track:', err.message);
    const status = err.isQuota ? 429 : 500;
    res.status(status).json({ error: err.isQuota ? 'Rate limited — try again shortly' : 'Failed to fetch track' });
  }
});

export default router;
