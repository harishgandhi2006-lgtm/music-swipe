const BADGE_META = {
  hip_hop_head:  { label: 'Hip-Hop Head',   emoji: '🎤', desc: '20+ Hip-Hop likes' },
  rock_legend:   { label: 'Rock Legend',     emoji: '🎸', desc: '20+ Rock likes' },
  pop_star:      { label: 'Pop Star',        emoji: '⭐', desc: '20+ Pop likes' },
  edm_raver:     { label: 'EDM Raver',       emoji: '🎧', desc: '20+ Electronic likes' },
  jazz_cat:      { label: 'Jazz Cat',        emoji: '🎷', desc: '15+ Jazz/Soul likes' },
  indie_soul:    { label: 'Indie Soul',      emoji: '🌿', desc: '15+ Alternative likes' },
  classics_buff: { label: 'Classics Buff',   emoji: '🎻', desc: '10+ Classical likes' },
  world_explorer:{ label: 'World Explorer',  emoji: '🌍', desc: '10+ World Music likes' },
  swipe_machine: { label: 'Swipe Machine',   emoji: '🃏', desc: '100+ total swipes' },
  swipe_starter: { label: 'First Steps',     emoji: '👟', desc: '10 swipes' },
};

const ALL_BADGE_KEYS = Object.keys(BADGE_META);

export default function BadgeDisplay({ badges = [] }) {
  const unlockedKeys = new Set(badges.map(b => b.badge_key));

  return (
    <div className="grid grid-cols-5 gap-2">
      {ALL_BADGE_KEYS.map(key => {
        const meta = BADGE_META[key];
        const unlocked = unlockedKeys.has(key);
        return (
          <div
            key={key}
            title={`${meta.label}: ${meta.desc}`}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition ${
              unlocked ? 'bg-white/10' : 'bg-white/4 opacity-40'
            }`}
          >
            <span className={`text-2xl ${unlocked ? '' : 'grayscale'}`}>{meta.emoji}</span>
            <span className="text-white/50 text-[9px] text-center leading-tight line-clamp-2">
              {meta.label}
            </span>
            {unlocked && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
