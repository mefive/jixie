// Recently-opened strategies, most-recent-first, as an ordered list of strategy ids in localStorage.
// The strategy hero renders these as cards (cross-referenced against the saved-strategy list for name +
// snapshot), and entering /strategy with no ?id auto-opens the top one. Only ids are stored — the card data
// comes from the server list, so a deleted strategy simply drops out.

const KEY = 'jx-strategy-recents';
const LEGACY_KEY = 'jx-lab-recents';
const CAP = 12; // keep a few more than we show (6), so deletes/misses still leave enough

export function readRecents(): string[] {
  try {
    const current = localStorage.getItem(KEY);
    const legacy = current === null ? localStorage.getItem(LEGACY_KEY) : null;
    const raw = JSON.parse(current ?? legacy ?? '[]');
    const recents = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string')
      : [];
    if (legacy !== null) {
      try {
        localStorage.setItem(KEY, JSON.stringify(recents));
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Keep legacy visits readable when storage writes are unavailable.
      }
    }
    return recents;
  } catch {
    return [];
  }
}

/** Record a visit: move `id` to the front (dedup), cap the list. */
export function pushRecent(id: string): void {
  const next = [id, ...readRecents().filter((existing) => existing !== id)].slice(0, CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — recents are best-effort */
  }
}

export function removeRecent(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(readRecents().filter((existing) => existing !== id)));
  } catch {
    /* best-effort */
  }
}
