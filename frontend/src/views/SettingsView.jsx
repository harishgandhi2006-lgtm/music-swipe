import { useEffect, useState } from 'react';
import { fetchPreferences, updatePreferences } from '../api.js';

// Mirrors the backend defaults in recommender.js's WEIGHTS — shown as the
// slider position for a user who hasn't set an override yet.
const DEFAULT_GENRE = 0.26;
const DEFAULT_ARTIST = 0.26;
const DEFAULT_EXPLORATION = 0.20;

export default function SettingsView({ onBack }) {
  const [genreWeight, setGenreWeight] = useState(DEFAULT_GENRE);
  const [artistWeight, setArtistWeight] = useState(DEFAULT_ARTIST);
  const [explorationRate, setExplorationRate] = useState(DEFAULT_EXPLORATION);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchPreferences()
      .then(prefs => {
        if (prefs.genre_weight != null) setGenreWeight(prefs.genre_weight);
        if (prefs.artist_weight != null) setArtistWeight(prefs.artist_weight);
        if (prefs.exploration_rate != null) setExplorationRate(prefs.exploration_rate);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function change(setter) {
    return (e) => { setter(Number(e.target.value)); setDirty(true); setSaved(false); };
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updatePreferences({
        genre_weight: genreWeight,
        artist_weight: artistWeight,
        exploration_rate: explorationRate,
      });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await updatePreferences({ genre_weight: null, artist_weight: null, exploration_rate: null });
      setGenreWeight(DEFAULT_GENRE);
      setArtistWeight(DEFAULT_ARTIST);
      setExplorationRate(DEFAULT_EXPLORATION);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Whatever genre+artist don't claim goes to duration/popularity/desirability
  // combined — mirrors effectiveWeights in recommender.js exactly.
  const remaining = Math.max(0, 1 - genreWeight - artistWeight);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 shrink-0">
        <button onClick={onBack} className="text-white/50 hover:text-white transition text-lg px-1">
          ←
        </button>
        <h1 className="text-white font-bold text-xl tracking-tight">Discovery Settings</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-6">
          <p className="text-white/40 text-xs leading-relaxed">
            These only ever adjust how much weight your own genre and artist history
            carries in what gets recommended — never anyone else's activity.
          </p>

          <Slider
            label="Genre emphasis"
            value={genreWeight}
            onChange={change(setGenreWeight)}
          />
          <Slider
            label="Artist emphasis"
            value={artistWeight}
            onChange={change(setArtistWeight)}
          />
          <Slider
            label="Exploration rate"
            value={explorationRate}
            onChange={change(setExplorationRate)}
          />

          <p className="text-white/30 text-xs">
            Remaining weight for duration, popularity, and desirability: {Math.round(remaining * 100)}%
            {remaining === 0 && ' — genre and artist emphasis are using the full budget'}
          </p>

          <div className="flex gap-3 mt-2">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex-1 py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition disabled:opacity-40"
            >
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
            </button>
            <button
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-white/70 text-sm font-medium">{label}</p>
        <p className="text-white/40 text-xs">{Math.round(value * 100)}%</p>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={onChange}
        className="w-full accent-white"
      />
    </div>
  );
}
