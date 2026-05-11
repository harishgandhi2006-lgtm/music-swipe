import { Router } from 'express';
import { getNextTrack, getFilteredTrack } from '../services/recommender.js';

const router = Router();

router.get('/next', async (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  const { filter_type, filter_id, filter_name } = req.query;

  try {
    let track;

    if (filter_type) {
      const filter = {
        type: filter_type,
        id:   filter_id ? Number(filter_id) : null,
        name: filter_name || null,
      };
      track = await getFilteredTrack(userId, filter);
    } else {
      track = await getNextTrack(userId);
    }

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
