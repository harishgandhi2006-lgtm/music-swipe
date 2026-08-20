import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import tracksRouter from './routes/tracks.js';
import interactionsRouter from './routes/interactions.js';
import proxyRouter from './routes/proxy.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import publicRouter from './routes/public.js';
import socialRouter from './routes/social.js';
import { warmPool } from './services/recommender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Trust exactly one hop — the platform's own reverse proxy (Fly.io edge /
// Railway proxy) — not `true`, which would trust the whole spoofable
// X-Forwarded-For chain. The rate limiters below key off req.ip, which
// depends on this being set correctly behind any reverse proxy.
app.set('trust proxy', 1);

const corsOptions = {
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
};
app.use(cors(corsOptions));

// Ahead of express.json() so an over-quota request is rejected before
// spending time parsing its body, and ahead of every route mount so it
// covers the whole /api surface uniformly.
const generalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api', generalLimiter);

// Layers on top of generalLimiter at the /api/auth mount only — auth
// endpoints get both the general budget and this stricter one.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.use(express.json());

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/interactions', interactionsRouter);
app.use('/api/proxy', proxyRouter);
// Must be mounted before profileRouter/socialRouter: both apply requireAuth
// to every request that reaches them (router.use with no path), which fires
// before Express even checks for a matching route inside that router — so
// any router sharing the '/api' prefix and mounted after either of them is
// unreachable. socialRouter and profileRouter can be ordered either way
// relative to each other since both share that same blanket-requireAuth
// shape and don't overlap on routes.
app.use('/api', publicRouter);
app.use('/api', socialRouter);
app.use('/api', profileRouter);

// Serve frontend build in production
const frontendDist = join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Music Swipe backend running on http://localhost:${PORT}`);
  warmPool('default');
});
