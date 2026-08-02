import { Router } from 'express';
import fetch from 'node-fetch';
import { resolvePreviewUrl } from '../services/preview.js';

const router = Router();

// Allow any Deezer CDN subdomain
const ALLOWED_HOST = /^https:\/\/[a-z0-9-]+\.dzcdn\.net\//;

// Callers pass a track id, not a URL: the signed stream URL is minted here, on
// demand, because Deezer's token outlives neither our cache nor our inbox.
router.get('/audio', async (req, res) => {
  const trackId = Number(req.query.trackId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    return res.status(400).json({ error: 'trackId param required' });
  }

  try {
    const streamUrl = await resolvePreviewUrl(trackId);
    if (!streamUrl) {
      return res.status(404).json({ error: 'No preview available for this track' });
    }
    // Re-checked after resolution so an unexpected upstream response can never
    // turn this route into an open proxy.
    if (!ALLOWED_HOST.test(streamUrl)) {
      return res.status(502).json({ error: 'Unexpected preview host' });
    }

    const headers = {};
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(streamUrl, { headers });

    res.status(upstream.status);

    const ct = upstream.headers.get('content-type');
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');

    if (ct) res.set('Content-Type', ct);
    if (cl) res.set('Content-Length', cl);
    if (cr) res.set('Content-Range', cr);
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'public, max-age=3600');

    // node-fetch v3 in Node.js returns a Node.js PassThrough stream
    upstream.body.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    if (!res.headersSent) res.status(502).json({ error: 'Failed to proxy audio' });
  }
});

export default router;
