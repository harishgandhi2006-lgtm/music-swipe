import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BADGE_RULES } from '../services/badges.js';

const router = Router();

router.use(requireAuth);

// ── Own profile ──────────────────────────────────────────────────────────────
// Scoped to the caller only — there is no cross-user profile lookup, so one
// account's genre/artist breakdown is never exposed to another.
router.get('/profile', (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, ...db.getUserProfile(req.userId) });
});

// ── Taste-weight preferences ─────────────────────────────────────────────────
// Scoped to the caller only, same as /profile above — req.userId comes from
// the verified JWT, never from the request body or params.
router.get('/profile/preferences', (req, res) => {
  res.json(db.getUserPreferences(req.userId) || {});
});

router.put('/profile/preferences', (req, res) => {
  const { genre_weight, artist_weight, exploration_rate } = req.body;
  for (const [key, value] of Object.entries({ genre_weight, artist_weight, exploration_rate })) {
    if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      return res.status(400).json({ error: `${key} must be a number in [0,1] or null` });
    }
  }
  db.upsertUserPreferences(req.userId, { genre_weight, artist_weight, exploration_rate });
  res.status(200).json({ ok: true });
});

// ── Badge catalogue ─────────────────────────────────────────────────────────
router.get('/badges/catalogue', (_req, res) => {
  res.json(BADGE_RULES.map(({ key, label, emoji, threshold, type, genres }) => ({
    key, label, emoji, threshold, type: type || 'genre', genres,
  })));
});

export default router;
