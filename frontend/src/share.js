// Everything a share link needs travels in the URL itself — no server write
// happens when a link is built or opened, so there is no linkage stored
// between the sharer and whoever opens it. See public-preview route on the
// backend for the other half of this.

const NOTE_MAX_LEN = 140;

export function buildShareUrl(track, note) {
  const params = new URLSearchParams({ t: String(track.id) });
  const trimmed = note?.trim().slice(0, NOTE_MAX_LEN);
  if (trimmed) params.set('n', trimmed);
  return `${window.location.origin}/share?${params.toString()}`;
}

export function parseShareParams(search) {
  const params = new URLSearchParams(search);
  const trackId = Number(params.get('t'));
  return {
    trackId: Number.isInteger(trackId) && trackId > 0 ? trackId : null,
    note: params.get('n') || '',
  };
}

export { NOTE_MAX_LEN };
