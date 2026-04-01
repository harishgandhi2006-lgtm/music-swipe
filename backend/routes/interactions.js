import { Router } from 'express';
import db from '../db.js';
import { updateAffinityScores } from '../services/recommender.js';

const router = Router();

router.post('/', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  const { track_id, action } = req.body;

  if (!track_id || !['like', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'track_id and action (like|reject) required' });
  }

  const track = db.getTrack(track_id);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  db.insertInteraction(userId, track_id, action);
  updateAffinityScores(userId, track_id);

  res.status(201).json({ ok: true });
});

router.get('/history', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  res.json(db.getHistory(userId, 100));
});

router.post('/undo', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  const removed = db.removeLastInteraction(userId);
  if (!removed) return res.status(400).json({ error: 'No interaction to undo' });
  updateAffinityScores(userId, removed.track_id);
  res.json({ ok: true, removed });
});

router.get('/genres', (req, res) => {
  const userId = req.headers['x-user-id'] || 'default';
  res.json(db.getGenreScores(userId));
});

export default router;
