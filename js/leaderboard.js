// Records one finished show for the cross-game Leader Board, in a shared
// Firestore database (not this browser's own storage -- see
// leader-board/specs/001-leader-board/ for why this replaced the earlier
// localStorage + per-game bridge-iframe design, and js/firebase-config.js
// for which project/collection this writes to). Never throws: a write
// failure -- offline, network, quota -- must never break the game's own
// final screen.
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getFirestore, collection, addDoc } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { firebaseConfig, LEADERBOARD_COLLECTION } from './firebase-config.js';

function db() {
  const app = getApps()[0] || initializeApp(firebaseConfig);
  return getFirestore(app);
}

export async function recordShowResult({ game, gameName, players, teams, winners, meta }) {
  try {
    if (!game || !Array.isArray(winners)) return;
    const entry = {
      v: 1,
      game,
      gameName: gameName || game,
      at: Date.now(),
      players: (players || []).map((p) => ({ name: String(p.name), score: Number(p.score) || 0 })),
      ...(teams ? { teams: teams.map((t) => ({ name: String(t.name), members: (t.members || []).map(String), score: Number(t.score) || 0 })) } : {}),
      winners: winners.map(String),
      ...(meta ? { meta } : {}),
    };
    await addDoc(collection(db(), LEADERBOARD_COLLECTION), entry);
  } catch (e) {
    console.warn('leaderboard: could not record result', e);
  }
}
