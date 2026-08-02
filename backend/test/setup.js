// Loaded via `node --test --import=./test/setup.js`, which guarantees it runs
// before any test module — and therefore before db.js is imported and opens a
// connection. Points the whole run at a throwaway database so tests can write
// freely and can never read or damage the real music_swipe.db.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MUSIC_SWIPE_DB = join(
  mkdtempSync(join(tmpdir(), 'music-swipe-test-')),
  'test.db',
);
