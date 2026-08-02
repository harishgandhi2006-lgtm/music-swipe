export default function TopArtistsList({ artists }) {
  if (!artists?.length) {
    return (
      <div className="flex flex-col items-center py-6 gap-2">
        <div className="text-3xl">🎤</div>
        <p className="text-white/30 text-xs">No artist data yet</p>
      </div>
    );
  }

  const max = artists[0].likes;

  return (
    <div className="flex flex-col gap-2">
      {artists.map((a, i) => (
        <div key={a.artist_id} className="flex items-center gap-3">
          {/* Rank */}
          <span className="text-white/30 text-xs w-4 text-right shrink-0">{i + 1}</span>
          {/* Bar + label */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-white text-xs font-medium truncate">{a.artist_name}</span>
              <span className="text-white/40 text-xs shrink-0 ml-2">{a.likes}♥</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all"
                style={{ width: `${(a.likes / max) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
