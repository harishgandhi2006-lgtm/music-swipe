import { Router } from 'express';
import { searchTracks, searchArtists } from '../services/deezer.js';

const router = Router();

const GENRES = [
  'Pop', 'Rock', 'Hip Hop', 'Electronic', 'Jazz', 'R&B', 'Classical',
  'Country', 'Metal', 'Soul', 'Reggae', 'Blues', 'Folk', 'Latin', 'Dance',
  'Punk', 'Alternative', 'Indie', 'House', 'Techno', 'Funk', 'Gospel',
];

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ tracks: [], artists: [], genres: [] });
  }

  const query = q.trim();

  const genres = GENRES
    .filter(g => g.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 4)
    .map(name => ({ name }));

  // Run sequentially (rate limiter queues them anyway)
  const tracks  = await searchTracks(query, 5, 0).catch(() => []);
  const artists = await searchArtists(query, 5).catch(() => []);

  res.json({
    genres,
    artists: artists.slice(0, 5).map(a => ({
      id:      a.id,
      name:    a.name,
      picture: a.picture_small || a.picture || '',
    })),
    tracks: tracks.slice(0, 5).map(t => ({
      id:          t.id,
      title:       t.title,
      artist_name: t.artist?.name || '',
      cover_url:   t.album?.cover_small || '',
    })),
  });
});

export default router;
