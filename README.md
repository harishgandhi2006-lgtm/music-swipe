# Music Swipe

A Tinder-style music discovery app that learns your taste over time. Swipe right to like, left to pass — the more you swipe, the better the recommendations get.

![Stack](https://img.shields.io/badge/React-18-blue) ![Stack](https://img.shields.io/badge/Node.js-Express-green) ![Stack](https://img.shields.io/badge/Deezer-API-orange)

## Features

- Auto-plays 30-second song previews
- Drag or button-swipe to like/reject tracks
- Adjustable playback speed (0.5× – 2×)
- Recommendations improve with every swipe based on:
  - Genre affinity
  - Artist affinity
  - Preferred song length
  - Track popularity
- Pre-fetched track pool — no lag between swipes
- Multi-user support (each browser gets its own taste profile)

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React, Vite, Framer Motion, Tailwind CSS |
| Backend | Node.js, Express |
| Database | JSON file store (no setup required) |
| Music | Deezer API (free, no key needed) |

## Getting Started

**Requirements:** Node.js 18+

```bash
# Install dependencies
npm install --prefix backend
npm install --prefix frontend
```

**Terminal 1 — Backend:**
```bash
cd backend
node --watch server.js
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## How Recommendations Work

| Interactions | Mode |
|---|---|
| < 5 swipes | Random tracks from Deezer charts |
| 5–19 swipes | Genre-weighted + 20% exploration |
| 20+ swipes | Multi-factor scoring + epsilon-greedy exploration |

**Scoring weights:**
- Genre affinity — 30%
- Artist affinity — 30%
- Duration match — 20%
- Popularity — 20%

The backend maintains a pre-fetched pool of 12 tracks per user, refilling silently in the background so recommendations are always instant.
