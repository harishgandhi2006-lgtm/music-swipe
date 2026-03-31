import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import tracksRouter from './routes/tracks.js';
import interactionsRouter from './routes/interactions.js';
import proxyRouter from './routes/proxy.js';
import { warmPool } from './services/recommender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/tracks', tracksRouter);
app.use('/api/interactions', interactionsRouter);
app.use('/api/proxy', proxyRouter);

// Serve frontend build in production
const frontendDist = join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Music Swipe backend running on http://localhost:${PORT}`);
  // Pre-fill the default track pool in the background at startup
  warmPool('default');
});
