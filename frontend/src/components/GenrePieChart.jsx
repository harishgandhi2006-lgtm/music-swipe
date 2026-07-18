const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#14b8a6'];

export default function GenrePieChart({ genres }) {
  if (!genres?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <div className="text-3xl">🎧</div>
        <p className="text-white/30 text-xs">No genre data yet</p>
      </div>
    );
  }

  const totalLikes = genres.reduce((s, g) => s + g.likes, 0);
  const R = 56;
  const CX = 76;
  const CY = 76;
  const circumference = 2 * Math.PI * R;

  let cumulative = 0;
  const slices = genres.map((g, i) => {
    const pct = g.likes / totalLikes;
    const dashLen = pct * circumference;
    const gapLen = circumference - dashLen;
    // strokeDashoffset: rotate so each slice starts after the previous
    const offset = circumference - cumulative * circumference;
    cumulative += pct;
    return { ...g, pct, dashLen, gapLen, offset, color: COLORS[i % COLORS.length] };
  });

  return (
    <div className="flex items-center gap-5">
      {/* Donut chart */}
      <svg width="152" height="152" viewBox="0 0 152 152" className="shrink-0">
        {slices.map((s, i) => (
          <circle
            key={i}
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="28"
            strokeDasharray={`${s.dashLen} ${s.gapLen}`}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        {/* Donut hole */}
        <circle cx={CX} cy={CY} r={42} fill="#111111" />
        <text x={CX} y={CY - 6} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">
          {totalLikes}
        </text>
        <text x={CX} y={CY + 9} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">
          likes
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-white/70 text-xs truncate">{s.genre_name}</span>
            <span className="text-white/40 text-xs ml-auto shrink-0">{Math.round(s.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
