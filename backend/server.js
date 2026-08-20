import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
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
