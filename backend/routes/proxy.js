import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Allow any Deezer CDN subdomain
const ALLOWED_HOST = /^https:\/\/[a-z0-9-]+\.dzcdn\.net\//;

router.get('/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });

  const decoded = decodeURIComponent(url);
  if (!ALLOWED_HOST.test(decoded)) {
    return res.status(403).json({ error: 'URL not allowed' });
  }

  try {
    const headers = {};
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(decoded, { headers });

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
