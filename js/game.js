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
export const MIN_QUESTIONS_PER_GAME = 6;
export const MAX_QUESTIONS_PER_GAME = 15;

// `hostId` is fixed for the lifetime of the room, set at creation time —
// independent of `players`. This is what makes a spectator Host possible:
// the device that created the room is always authoritative, whether or not
// it also joins `players` as a participant (see js/main.js's `addPlayer`
// call being conditional on "play along" vs "run as display").
export function createRoom(code, hostId) {
  return {
    code,
    phase: "lobby", // lobby | question | reveal | over
    hostId,
    players: [], // join order preserved
    deck: [], // built at startGame; array of { tier, question, choices, correctIndex, key, source }
    qIndex: 0,
    questionStartedAt: null, // ms epoch, threaded in via `now` params for testability
    timerSeconds: 0, // 0 = no timer
    questionCount: MAX_QUESTIONS_PER_GAME,
    revealAdvanceSeconds: 0, // 0 = manual (Host taps Next); else auto-advance after N seconds
    revealStartedAt: null, // ms epoch, set when phase becomes "reveal"
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

export function addPlayer(room, playerId, name, resumeToken = null) {
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
    connected: true,
    resumeToken: resumeToken || null, // private capability; omitted by toPublicState()
    choiceIndex: null, // pending answer this question, hidden from other players
  };
  room.players.push(player);
  return { player };
}

// Rebind a returning browser's new ephemeral PeerJS id to its existing seat.
// The private resume token is the authority; player names are deliberately
// not sufficient because they are visible to everyone in the room.
export function rejoinPlayer(room, playerId, resumeToken) {
  if (!resumeToken) return { error: "No saved seat found" };
  const player = room.players.find((p) => p.resumeToken === resumeToken);
  if (!player) return { error: "No saved seat found" };
  player.id = playerId;
  player.connected = true;
  player.left = false;
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

// Mark a non-host seat offline but retain it for token-authorized rejoin.
// The Host owns the room's lifetime; if the Host closes, the room itself
// disappears with its in-memory state.
export function removePlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) return room.players.length === 0;
  player.connected = false;
  player.left = true;
  // Preserve alive/choice state so the same browser can reclaim the seat.
  // allAnswered() ignores an offline unanswered player, so a disconnect
  // cannot stall everyone else indefinitely and resolution still counts a
  // missing answer as wrong.
  return room.players.filter((p) => p.connected).length === 0;
}

// ---------- Deck building ----------

export function questionKey(entry) {
  return `${entry.tier}::${entry.q}`;
}

function distinctTiersDesc(pool) {
  return [...new Set(pool.map((q) => q.tier))].sort((a, b) => b - a);
}

// Spread the requested number of tier slots across the available range,
// always retaining the easiest and hardest endpoints.
function pickLadderTiers(tiers, count) {
  if (count <= 1) return tiers.length > 0 ? [tiers[0]] : [];
  if (tiers.length <= count) return tiers;
  const picked = [];
  const step = (tiers.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    picked.push(tiers[Math.round(i * step)]);
  }
  return [...new Set(picked)];
}

// Builds one ladder with the requested number of fresh questions, descending
// from easiest to hardest and spread across the available tier range.
// `usedKeys` is a Set of questionKey() strings to exclude (see js/storage.js).
// `rng` is injected for deterministic tests.
export function buildDeck(pool, questionCount, usedKeys, rng = Math.random) {
  const available = pool.filter((q) => !usedKeys.has(questionKey(q)));
  const targetCount = Math.min(
    available.length,
    Math.max(MIN_QUESTIONS_PER_GAME, Math.min(MAX_QUESTIONS_PER_GAME, Number(questionCount) || MAX_QUESTIONS_PER_GAME))
  );
  const byTier = new Map();
  for (const q of available) {
    if (!byTier.has(q.tier)) byTier.set(q.tier, []);
    byTier.get(q.tier).push(q);
  }
  const allTiers = distinctTiersDesc(available);
  const selected = [];

  // First take one question from tiers spread across the whole difficulty
  // range. If fewer distinct tiers remain than the requested round count,
  // add further questions in evenly spread passes over tiers that still have
  // unused candidates. This keeps the exact count without sacrificing the
  // easiest-to-hardest ordering.
  const takeFromTier = (tier) => {
    const candidates = byTier.get(tier);
    if (!candidates || candidates.length === 0) return false;
    const index = Math.floor(rng() * candidates.length);
    selected.push(candidates.splice(index, 1)[0]);
    return true;
  };

  for (const tier of pickLadderTiers(allTiers, targetCount)) takeFromTier(tier);
  while (selected.length < targetCount) {
    const remainingTiers = allTiers.filter((tier) => byTier.get(tier)?.length);
    if (remainingTiers.length === 0) break;
    const slots = Math.min(targetCount - selected.length, remainingTiers.length);
    for (const tier of pickLadderTiers(remainingTiers, slots)) takeFromTier(tier);
  }

  selected.sort((a, b) => b.tier - a.tier);
  const deck = [];
  for (const entry of selected) {
    const shuffled = [entry.a, ...entry.d]
      .map((c, i) => [rng(), c, i])
      .sort((x, y) => x[0] - y[0]);
    deck.push({
      tier: entry.tier,
      question: entry.q,
      image: entry.image || null,
      imageAlt: entry.imageAlt || null,
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

export function startGame(room, byId, { pool, questionCount, timerSeconds, revealAdvanceSeconds, usedKeys, rng = Math.random, now }) {
  if (room.phase !== "lobby" && room.phase !== "over") return { error: "Game already in progress" };
  if (byId !== room.hostId) return { error: "Only the host can start the game" };
  const connectedPlayers = room.players.filter((p) => p.connected);
  if (connectedPlayers.length < MIN_PLAYERS) return { error: "Need at least one connected player" };
  room.players = connectedPlayers;

  const deck = buildDeck(pool, questionCount, usedKeys, rng);
  if (deck.length === 0) return { error: "No fresh questions left — reset the question bank in settings" };

  for (const p of room.players) {
    p.alive = true;
    p.left = false;
    p.choiceIndex = null;
  }
  room.deck = deck;
  room.qIndex = 0;
  room.phase = "question";
  room.questionCount = Math.max(MIN_QUESTIONS_PER_GAME, Math.min(MAX_QUESTIONS_PER_GAME, Number(questionCount) || MAX_QUESTIONS_PER_GAME));
  room.timerSeconds = timerSeconds || 0;
  room.revealAdvanceSeconds = revealAdvanceSeconds || 0;
  room.questionStartedAt = now;
  room.revealStartedAt = null;
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
  const connected = alive.filter((p) => p.connected);
  if (connected.length > 0) return connected.every((p) => p.choiceIndex !== null);
  // If everybody dropped only after locking in, the Host can still reveal;
  // otherwise keep the question open for at least one seat to rejoin.
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

// Mirrors checkTimerExpired() for the post-question "reveal" screen: when
// revealAdvanceSeconds is set, the Host's client auto-calls advanceQuestion()
// once this elapses instead of waiting for a tap.
export function checkRevealExpired(room, now) {
  return (
    room.phase === "reveal" &&
    room.revealAdvanceSeconds > 0 &&
    room.revealStartedAt !== null &&
    now >= room.revealStartedAt + room.revealAdvanceSeconds * 1000
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
    image: q.image,
    imageAlt: q.imageAlt,
    choices: q.choices,
    correctIndex: q.correctIndex,
    explain: q.explain || null,
    results,
  };
  room.lastResult = summary;
  room.phase = "reveal";
  room.revealStartedAt = now;

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
  room.revealStartedAt = null;
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
  room.players = room.players.filter((p) => p.connected);
  for (const p of room.players) {
    p.alive = true;
    p.choiceIndex = null;
  }
  room.phase = "lobby";
  room.deck = [];
  room.qIndex = 0;
  room.questionStartedAt = null;
  room.revealStartedAt = null;
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
    questionCount: room.questionCount,
    timerSeconds: room.timerSeconds,
    questionDeadlineAt:
      room.phase === "question" && room.timerSeconds > 0
        ? room.questionStartedAt + room.timerSeconds * 1000
        : null,
    revealAdvanceSeconds: room.revealAdvanceSeconds,
    revealDeadlineAt:
      room.phase === "reveal" && room.revealAdvanceSeconds > 0
        ? room.revealStartedAt + room.revealAdvanceSeconds * 1000
        : null,
    now,
    winnerIds: room.winnerIds,
    lastResult: room.lastResult,
    question:
      room.phase === "question" && q
        ? {
            tier: q.tier,
            isLine: room.qIndex === 0,
            question: q.question,
            image: q.image,
            imageAlt: q.imageAlt,
            choices: q.choices,
          }
        : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      left: p.left,
      connected: p.connected,
      answered: p.choiceIndex !== null,
      myChoice: p.id === viewerId ? p.choiceIndex : undefined,
    })),
  };
}
