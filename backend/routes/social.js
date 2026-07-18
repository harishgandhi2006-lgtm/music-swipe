import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BADGE_RULES } from '../services/badges.js';
import { getTasteMatches } from '../services/tasteMatch.js';

const router = Router();

// All social routes require authentication
router.use(requireAuth);

// ── User search ─────────────────────────────────────────────────────────────
router.get('/users/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const users = db.searchUsers(q, req.userId);
  // Attach friendship status for each result
  const withStatus = users.map(u => {
    const f = db.getFriendshipStatus(req.userId, u.id);
    return { ...u, friendshipStatus: f?.status || null, friendshipId: f?.id || null, isRequester: f?.requester_id === req.userId };
  });
  res.json(withStatus);
});

// ── User profile ─────────────────────────────────────────────────────────────
router.get('/users/:id/profile', (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user id' });

  const user = db.getUserById(targetId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const profile = db.getUserProfile(targetId);
  const friendship = targetId !== req.userId ? db.getFriendshipStatus(req.userId, targetId) : null;

  res.json({
    id: user.id,
    username: user.username,
    ...profile,
    friendship: friendship ? {
      id: friendship.id,
      status: friendship.status,
      isRequester: friendship.requester_id === req.userId,
    } : null,
  });
});

// ── Taste matcher ───────────────────────────────────────────────────────────
router.get('/users/taste-matches', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  res.json(getTasteMatches(req.userId, limit));
});

// ── Friend requests ─────────────────────────────────────────────────────────
router.post('/friends/request', (req, res) => {
  const { targetId } = req.body;
  if (!targetId || targetId === req.userId) {
    return res.status(400).json({ error: 'Invalid target user' });
  }

  const target = db.getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db.getFriendshipStatus(req.userId, targetId);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.status === 'pending') return res.status(409).json({ error: 'Request already pending' });
    // Allow re-request after decline
    db.removeFriend(existing.id, req.userId);
  }

  db.sendFriendRequest(req.userId, targetId);
  res.status(201).json({ ok: true });
});

router.post('/friends/respond', (req, res) => {
  const { friendshipId, status } = req.body;
  if (!friendshipId || !['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'friendshipId and status (accepted|declined) required' });
  }

  const updated = db.respondFriendRequest(friendshipId, req.userId, status);
  if (!updated) return res.status(403).json({ error: 'Cannot respond to this request' });
  res.json({ ok: true, status: updated.status });
});

router.get('/friends', (req, res) => {
  res.json(db.getFriends(req.userId));
});

router.get('/friends/pending', (req, res) => {
  res.json(db.getPendingRequests(req.userId));
});

router.delete('/friends/:id', (req, res) => {
  const friendshipId = parseInt(req.params.id, 10);
  if (isNaN(friendshipId)) return res.status(400).json({ error: 'Invalid friendship id' });

  const removed = db.removeFriend(friendshipId, req.userId);
  if (!removed) return res.status(403).json({ error: 'Cannot remove this friendship' });
  res.json({ ok: true });
});

// ── Sharing (tracks + artists) ──────────────────────────────────────────────
router.post('/share', (req, res) => {
  const { receiverId, message } = req.body;

  // Accept either { itemType, itemId } or the legacy { trackId } shape.
  const itemType = req.body.itemType || (req.body.trackId ? 'track' : null);
  const itemId   = req.body.itemId   ?? req.body.trackId ?? null;

  if (!receiverId || !itemId || !itemType) {
    return res.status(400).json({ error: 'receiverId, itemType and itemId required' });
  }
  if (!['track', 'artist'].includes(itemType)) {
    return res.status(400).json({ error: "itemType must be 'track' or 'artist'" });
  }

  const friendship = db.getFriendshipStatus(req.userId, receiverId);
  if (!friendship || friendship.status !== 'accepted') {
    return res.status(403).json({ error: 'You can only share with friends' });
  }

  // The item must be something we've actually cached, or the inbox can't render it.
  const exists = itemType === 'track' ? db.getTrack(itemId) : db.getArtistMeta(itemId);
  if (!exists) {
    return res.status(404).json({ error: `${itemType === 'track' ? 'Track' : 'Artist'} not found` });
  }

  const id = db.shareItem(req.userId, receiverId, itemType, itemId, message || null);
  res.status(201).json({ ok: true, id, itemType });
});

router.get('/inbox', (req, res) => {
  const formatted = db.getInbox(req.userId).map(item => ({
    id: item.id,
    itemType: item.item_type,
    itemId: item.item_id,
    message: item.message,
    seen: !!item.seen,
    createdAt: item.created_at,
    senderId: item.sender_id,
    senderUsername: item.sender_username,
    artistName: item.artist_name,
    genreName: item.genre_name,
    // Tracks carry their own art; artist shares borrow it from a top track.
    coverUrl: item.item_type === 'track' ? item.cover_url : item.artist_cover,
    title: item.item_type === 'track' ? item.title : item.artist_name,
    duration: item.item_type === 'track' ? item.duration : null,
    previewUrl: item.preview_url
      ? `/api/proxy/audio?url=${encodeURIComponent(item.preview_url)}`
      : null,
  }));
  res.json(formatted);
});

router.get('/inbox/unseen-count', (req, res) => {
  res.json({ count: db.getUnseenCount(req.userId) });
});

router.post('/inbox/:id/seen', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  db.markSeen(id, req.userId);
  res.json({ ok: true });
});

// ── Badge catalogue ─────────────────────────────────────────────────────────
router.get('/badges/catalogue', (_req, res) => {
  res.json(BADGE_RULES.map(({ key, label, emoji, threshold, type, genres }) => ({
    key, label, emoji, threshold, type: type || 'genre', genres,
  })));
});

export default router;
