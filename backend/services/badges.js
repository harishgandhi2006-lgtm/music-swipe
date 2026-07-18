import db from '../db.js';

export const BADGE_RULES = [
  { key: 'hip_hop_head',  label: 'Hip-Hop Head',   emoji: '🎤', genres: ['Rap/Hip Hop', 'Hip Hop', 'Hip-Hop', 'Rap'], threshold: 20 },
  { key: 'rock_legend',   label: 'Rock Legend',     emoji: '🎸', genres: ['Rock', 'Hard Rock', 'Punk', 'Metal'],       threshold: 20 },
  { key: 'pop_star',      label: 'Pop Star',        emoji: '⭐', genres: ['Pop'],                                      threshold: 20 },
  { key: 'edm_raver',     label: 'EDM Raver',       emoji: '🎧', genres: ['Electronic', 'Dance', 'House', 'Techno', 'EDM', 'Electro'], threshold: 20 },
  { key: 'jazz_cat',      label: 'Jazz Cat',        emoji: '🎷', genres: ['Jazz', 'Blues', 'Soul', 'Funk'],            threshold: 15 },
  { key: 'indie_soul',    label: 'Indie Soul',      emoji: '🌿', genres: ['Alternative', 'Indie', 'Alternative/Indie', 'Folk'], threshold: 15 },
  { key: 'classics_buff', label: 'Classics Buff',   emoji: '🎻', genres: ['Classical', 'Classique', 'Classic'],        threshold: 10 },
  { key: 'world_explorer',label: 'World Explorer',  emoji: '🌍', genres: ['Latin', 'Reggae', 'World', 'African'],      threshold: 10 },
  { key: 'swipe_machine', label: 'Swipe Machine',   emoji: '🃏', type: 'total',                                       threshold: 100 },
  { key: 'swipe_starter', label: 'First Steps',     emoji: '👟', type: 'total',                                       threshold: 10 },
];

export const ALL_BADGE_KEYS = new Set(BADGE_RULES.map(r => r.key));

function genreMatches(genreName, ruleGenres) {
  if (!genreName) return false;
  const lower = genreName.toLowerCase();
  return ruleGenres.some(rg => lower.includes(rg.toLowerCase()) || rg.toLowerCase().includes(lower));
}

export function evaluateBadges(strUserId, intUserId) {
  const newBadges = [];
  if (!intUserId) return newBadges;

  const genreScores = db.getGenreScores(strUserId);
  const totalCount = db.countInteractions(strUserId);
  const existingBadges = new Set(db.getUserBadges(intUserId).map(b => b.badge_key));

  for (const rule of BADGE_RULES) {
    if (existingBadges.has(rule.key)) continue;

    let qualifies = false;
    if (rule.type === 'total') {
      qualifies = totalCount >= rule.threshold;
    } else {
      // Engagement, not approval: swiping through 20 metal tracks says you
      // explored the genre even if you rejected most of them, so rejects count.
      const matching = genreScores.filter(g => genreMatches(g.genre_name, rule.genres));
      const totalSwipes = matching.reduce((s, g) => s + g.likes + g.rejects, 0);
      qualifies = totalSwipes >= rule.threshold;
    }

    if (qualifies) {
      const isNew = db.unlockBadge(intUserId, rule.key);
      if (isNew) newBadges.push({ key: rule.key, label: rule.label, emoji: rule.emoji });
    }
  }

  return newBadges;
}
