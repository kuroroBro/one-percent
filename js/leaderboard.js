// Records one finished show for the cross-game Leader Board. Data stays in
// THIS browser (the Host device) under this game's own origin -- see
// leader-board/specs/001-leader-board/. Never throws: a storage failure
// must never break the game's own final screen.
const KEY = 'partyGames.leaderboard.v1';
const CAP = 500;

export function recordShowResult({ game, gameName, players, teams, winners, meta }) {
  try {
    if (!game || !Array.isArray(winners)) return;
    const entry = {
      v: 1,
      id: `${game}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      game,
      gameName: gameName || game,
      at: Date.now(),
      players: (players || []).map((p) => ({ name: String(p.name), score: Number(p.score) || 0 })),
      ...(teams ? { teams: teams.map((t) => ({ name: String(t.name), members: (t.members || []).map(String), score: Number(t.score) || 0 })) } : {}),
      winners: winners.map(String),
      ...(meta ? { meta } : {}),
    };
    let list = [];
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(raw)) list = raw;
    } catch { /* malformed existing data -- start fresh rather than throw */ }
    list.push(entry);
    if (list.length > CAP) list = list.slice(list.length - CAP);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('leaderboard: could not record result', e);
  }
}

// Host-facing reset for THIS game's recorded history (destructive, no
// undo). Wire it to a "reset local leaderboard history" control in the
// game's Host settings if the game offers one; the Leader Board site's
// own reset goes through the bridge instead.
export function resetShowResults() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (e) {
    console.warn('leaderboard: could not reset history', e);
    return false;
  }
}
