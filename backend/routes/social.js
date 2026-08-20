import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  sendConnectionRequest, respondToRequest, listConnections, listPendingRequests,
  getActivityFeed, socialBus, SocialError,
} from '../services/social.js';

const router = Router();

// Account-scoped only, no anonymous fallback — same as profile.js. Friend
// requests/connections/activity are inherently tied to a real account, not
// the per-browser anonymous id used for pre-login swiping.
router.use(requireAuth);

function handleSocialError(err, res) {
  if (err instanceof SocialError) return res.status(err.status).json({ error: err.message });
  throw err;
}

router.post('/social/requests', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });
  try {
    res.status(201).json(sendConnectionRequest(req.userId, username));
  } catch (err) {
    handleSocialError(err, res);
  }
});

router.get('/social/requests', (req, res) => {
  res.json(listPendingRequests(req.userId));
});

router.put('/social/requests/:id', (req, res) => {
  const { accept } = req.body;
  if (typeof accept !== 'boolean') return res.status(400).json({ error: 'accept must be a boolean' });
  try {
    res.json(respondToRequest(req.userId, Number(req.params.id), accept));
  } catch (err) {
    handleSocialError(err, res);
  }
});

router.get('/social/connections', (req, res) => {
  res.json(listConnections(req.userId));
});

router.get('/social/activity', (req, res) => {
  res.json(getActivityFeed(req.userId));
});

// One long-lived SSE connection per active user. Scoped routing — this
// handler only ever receives events emitted at `user:${req.userId}` — never
// a global broadcast every open connection has to filter (see
// ARCHITECTURE.md's SSE section for why that matters at ~1,000 connections).
router.get('/social/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  // Disable Node's default socket timeout for this long-lived connection,
  // and heartbeat so reverse proxies (Nginx/Cloudflare) don't drop a
  // quiet-but-healthy connection for idling — SSE has no transport-level
  // keepalive of its own. The comment line is invisible to EventSource's
  // message handler but resets the proxy's idle timer.
  req.socket.setTimeout(0);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  const send = ({ event, data }) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  socialBus.on(`user:${req.userId}`, send);

  req.on('close', () => {
    clearInterval(heartbeat);
    socialBus.off(`user:${req.userId}`, send);
  });
});

export default router;
