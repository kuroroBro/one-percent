// Pure game logic for The 1% Club (party edition) — no I/O, fully
// unit-testable. See specs/001-one-percent-club/plan.md for the full design.
//
// Rules, modeled on the TV format:
// - 1..MAX_PLAYERS players. Everyone who is still "alive" answers the same
//   multiple-choice question (2-4 options) at once, in secret (no one sees anyone else's pick
//   until the question resolves).
// - The ladder runs from the easiest tier (~90%+, "the line") down to the
//   hardest available tier (as low as 1%). Anyone who answers wrong, or
//   doesn't answer before the timer runs out, is eliminated.
// - If everyone still alive gets a question wrong together, the game ends
//   immediately with no winner — the whole group "fell off the line".
// - Whoever is still alive after the final question in the ladder clears
//   has reached the 1% and wins (ties split the win — more than one player
//   can clear the ladder together).

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 12;
export const MAX_CHOICES_PER_QUESTION = 4; // some questions are True/False (2) or 3-way instead
export const LADDER_TARGET_LENGTH = 8; // how many tiers a "Quick" ladder picks

export function createRoom(code) {
  return {
    code,
    phase: "lobby", // lobby | question | reveal | over
    hostId: null,
    players: [], // join order preserved
    deck: [], // built at startGame; array of { tier, question, choices, correctIndex, key, source }
    qIndex: 0,
    questionStartedAt: null, // ms epoch, threaded in via `now` params for testability
    timerSeconds: 0, // 0 = no timer
    ladderLength: "quick", // "quick" | "full"
    lastResult: null, // summary of the most recently resolved question
    winnerIds: null, // set once phase === "over"; [] means no one cleared it
    _pendingOver: false, // internal: does the next advanceQuestion() end the game?
    _pendingWinners: null,
    touchedAt: Date.now(),
  };
}

export function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

export function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

export function addPlayer(room, playerId, name) {
  if (room.phase !== "lobby") return { error: "Game already in progress" };
  if (room.players.length >= MAX_PLAYERS) return { error: `Room is full (${MAX_PLAYERS} players max)` };
  const trimmed = String(name || "").trim().slice(0, 20);
  if (!trimmed) return { error: "Name is required" };
  if (room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: "That name is already taken in this room" };
  }
  const player = {
    id: playerId,
    name: trimmed,
    alive: true,
    left: false,
    choiceIndex: null, // pending answer this question, hidden from other players
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = playerId;
  return { player };
}

export function renamePlayer(room, playerId, name) {
  const player = getPlayer(room, playerId);
  if (!player) return { error: "You are not in this room" };
  const trimmed = String(name || "").trim().slice(0, 20);
  if (!trimmed) return { error: "Name is required" };
  if (room.players.some((p) => p.id !== playerId && p.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: "That name is already taken in this room" };
  }
  player.name = trimmed;
  return {};
}

// Returns true if the room is now empty and should be deleted.
export function removePlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) return room.players.length === 0;
  if (room.phase === "lobby" || room.phase === "over") {
    room.players = room.players.filter((p) => p.id !== playerId);
  } else {
    // Mid-game: leaving means elimination, seat stays visible marked "left"
    player.alive = false;
    player.left = true;
    player.choiceIndex = null;
  }
  if (room.hostId === playerId) {
    const next = room.players.find((p) => !p.left);
    room.hostId = next ? next.id : null;
  }
  return room.players.filter((p) => !p.left).length === 0;
}

// ---------- Deck building ----------

export function questionKey(entry) {
  return `${entry.tier}::${entry.q}`;
}

function distinctTiersDesc(pool) {
  return [...new Set(pool.map((q) => q.tier))].sort((a, b) => b - a);
}

// A "Quick" ladder spreads LADDER_TARGET_LENGTH tiers evenly across whatever
// tiers are actually available (always keeping the easiest and hardest
// endpoints); "Full" plays every distinct tier present in the pool.
function pickLadderTiers(tiers, ladderLength) {
  if (ladderLength === "full" || tiers.length <= LADDER_TARGET_LENGTH) return tiers;
  const picked = [];
  const step = (tiers.length - 1) / (LADDER_TARGET_LENGTH - 1);
  for (let i = 0; i < LADDER_TARGET_LENGTH; i++) {
    picked.push(tiers[Math.round(i * step)]);
  }
  return [...new Set(picked)];
}

// Builds one ladder: one question per selected tier, descending from easiest
// to hardest, skipping any tier with no unused questions left. `usedKeys` is
// a Set of questionKey() strings to exclude (see js/storage.js). `rng` is
// injected for deterministic tests.
export function buildDeck(pool, ladderLength, usedKeys, rng = Math.random) {
  const available = pool.filter((q) => !usedKeys.has(questionKey(q)));
  const byTier = new Map();
  for (const q of available) {
    if (!byTier.has(q.tier)) byTier.set(q.tier, []);
    byTier.get(q.tier).push(q);
  }
  const tiers = pickLadderTiers(distinctTiersDesc(available), ladderLength);
  const deck = [];
  for (const tier of tiers) {
    const candidates = byTier.get(tier);
    if (!candidates || candidates.length === 0) continue;
    const entry = candidates[Math.floor(rng() * candidates.length)];
    const shuffled = [entry.a, ...entry.d]
      .map((c, i) => [rng(), c, i])
      .sort((x, y) => x[0] - y[0]);
    deck.push({
      tier: entry.tier,
      question: entry.q,
      choices: shuffled.map((s) => s[1]),
      correctIndex: shuffled.findIndex((s) => s[2] === 0),
      explain: entry.explain || null,
      key: questionKey(entry),
      source: entry.source || null,
    });
  }
  return deck;
}

// ---------- Game flow ----------

export function startGame(room, byId, { pool, ladderLength, timerSeconds, usedKeys, rng = Math.random, now }) {
  if (room.phase !== "lobby" && room.phase !== "over") return { error: "Game already in progress" };
  if (byId !== room.hostId) return { error: "Only the host can start the game" };
  if (room.players.length < MIN_PLAYERS) return { error: "Need at least one player" };

  const deck = buildDeck(pool, ladderLength, usedKeys, rng);
  if (deck.length === 0) return { error: "No fresh questions left — reset the question bank in settings" };

  for (const p of room.players) {
    p.alive = true;
    p.left = false;
    p.choiceIndex = null;
  }
  room.deck = deck;
  room.qIndex = 0;
  room.phase = "question";
  room.ladderLength = ladderLength;
  room.timerSeconds = timerSeconds || 0;
  room.questionStartedAt = now;
  room.lastResult = null;
  room.winnerIds = null;
  return {};
}

export function currentQuestion(room) {
  return room.deck[room.qIndex] || null;
}

export function submitAnswer(room, playerId, choiceIndex, now) {
  if (room.phase !== "question") return { error: "No question is open right now" };
  const player = getPlayer(room, playerId);
  if (!player) return { error: "You are not in this game" };
  if (!player.alive) return { error: "You have been eliminated" };
  const q = currentQuestion(room);
  // Choice count varies per question (2-4) — the real show isn't always a
  // 4-option format (some questions are True/False or 3-way), so validate
  // against this question's own choices rather than a fixed constant.
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= q.choices.length) {
    return { error: "Invalid choice" };
  }
  if (checkTimerExpired(room, now)) return { error: "Time's up for this question" };
  player.choiceIndex = choiceIndex;
  return { done: allAnswered(room) };
}

export function allAnswered(room) {
  const alive = alivePlayers(room);
  return alive.length > 0 && alive.every((p) => p.choiceIndex !== null);
}

export function checkTimerExpired(room, now) {
  return (
    room.phase === "question" &&
    room.timerSeconds > 0 &&
    room.questionStartedAt !== null &&
    now >= room.questionStartedAt + room.timerSeconds * 1000
  );
}

// Resolve the current question. Call when allAnswered(room) or
// checkTimerExpired(room, now). Eliminates everyone who answered wrong or
// didn't answer, then always moves to "reveal" so the correct answer is
// shown — even on a total wipeout — before the host advances the game.
// Whether that advance lands on the next question or ends the game is
// decided in advanceQuestion(), not here. Returns the round summary (also
// stored on room.lastResult).
export function resolveQuestion(room, now) {
  const q = currentQuestion(room);
  const actors = alivePlayers(room);
  const results = actors.map((p) => ({
    id: p.id,
    name: p.name,
    choiceIndex: p.choiceIndex,
    correct: p.choiceIndex === q.correctIndex,
  }));

  for (const p of actors) {
    const r = results.find((x) => x.id === p.id);
    if (!r.correct) p.alive = false;
    p.choiceIndex = null;
  }

  const summary = {
    qIndex: room.qIndex,
    tier: q.tier,
    isLine: room.qIndex === 0,
    question: q.question,
    choices: q.choices,
    correctIndex: q.correctIndex,
    explain: q.explain || null,
    results,
  };
  room.lastResult = summary;
  room.phase = "reveal";

  const survivors = alivePlayers(room);
  const isLastQuestion = room.qIndex === room.deck.length - 1;
  if (survivors.length === 0) {
    room._pendingOver = true;
    room._pendingWinners = [];
  } else if (isLastQuestion) {
    room._pendingOver = true;
    room._pendingWinners = survivors.map((p) => p.id);
  } else {
    room._pendingOver = false;
    room._pendingWinners = null;
  }
  return summary;
}

// Host-only: advance from the post-question "reveal" screen either to the
// next question, or — if that was a wipeout or the final tier — to "over".
export function advanceQuestion(room, byId, now) {
  if (room.phase !== "reveal") return { error: "No question result to advance from" };
  if (byId !== room.hostId) return { error: "Only the host can advance the ladder" };
  if (room._pendingOver) {
    room.phase = "over";
    room.winnerIds = room._pendingWinners;
  } else {
    room.qIndex += 1;
    room.phase = "question";
    room.questionStartedAt = now;
  }
  return {};
}

// "Play again": back to lobby, same seats (players who left mid-game are
// dropped since the lobby is open to edits again).
export function resetToLobby(room, byId) {
  if (byId !== room.hostId) return { error: "Only the host can reset the room" };
  if (room.phase !== "over") return { error: "Game is not over" };
  room.players = room.players.filter((p) => !p.left);
  for (const p of room.players) {
    p.alive = true;
    p.choiceIndex = null;
  }
  room.phase = "lobby";
  room.deck = [];
  room.qIndex = 0;
  room.questionStartedAt = null;
  room.lastResult = null;
  room.winnerIds = null;
  room._pendingOver = false;
  room._pendingWinners = null;
  return {};
}

// State safe to broadcast: the correct answer index is only ever included
// once a question has resolved (room.lastResult); the *current* question's
// correctIndex is never sent while phase === "question", and no player's
// choiceIndex is included for anyone but the viewer themselves before the
// reveal (only a `answered: true/false` flag is public).
export function toPublicState(room, viewerId, now) {
  const q = currentQuestion(room);
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    qIndex: room.qIndex,
    deckLength: room.deck.length,
    ladderLength: room.ladderLength,
    timerSeconds: room.timerSeconds,
    questionDeadlineAt:
      room.phase === "question" && room.timerSeconds > 0
        ? room.questionStartedAt + room.timerSeconds * 1000
        : null,
    now,
    winnerIds: room.winnerIds,
    lastResult: room.lastResult,
    question:
      room.phase === "question" && q
        ? { tier: q.tier, isLine: room.qIndex === 0, question: q.question, choices: q.choices }
        : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      left: p.left,
      answered: p.choiceIndex !== null,
      myChoice: p.id === viewerId ? p.choiceIndex : undefined,
    })),
  };
}
