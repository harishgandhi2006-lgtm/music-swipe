const KEY = 'music_swipe_user_id';

function generateId() {
  return 'user_' + Math.random().toString(36).slice(2, 11);
}

export function getUserId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(KEY, id);
  }
  return id;
}
