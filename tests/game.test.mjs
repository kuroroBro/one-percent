import test from "node:test";
import assert from "node:assert";
import * as g from "../js/game.js";

// Deterministic PRNG (mulberry32) so buildDeck()/shuffle results are
// reproducible across test runs.
function seeded(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [
  { tier: 92, q: "Line Q1", a: "Right1", d: ["Wrong1a", "Wrong1b", "Wrong1c"], image: "images/questions/test.svg", imageAlt: "A test diagram" },
  { tier: 92, q: "Line Q2", a: "Right1b", d: ["Wrong1d", "Wrong1e", "Wrong1f"] },
  { tier: 70, q: "Mid Q1", a: "Right2", d: ["Wrong2a", "Wrong2b", "Wrong2c"] },
  { tier: 30, q: "Hard Q1", a: "Right3", d: ["Wrong3a", "Wrong3b", "Wrong3c"] },
  { tier: 1, q: "One Percent Q1", a: "Right4", d: ["Wrong4a", "Wrong4b", "Wrong4c"] },
];

// hostId is fixed at createRoom() time, independent of the player roster —
// this is what makes a spectator Host possible (see game.js createRoom
// comment). Tests use "p1" as hostId by default, same as the old
// first-player-becomes-host behavior, but the two are no longer coupled.
function roomWith(names, hostId = "p1") {
  const room = g.createRoom("TEST", hostId);
  names.forEach((name, i) => g.addPlayer(room, `p${i + 1}`, name));
  return room;
}

function startedRoom(names, opts = {}) {
  const room = roomWith(names);
  g.startGame(room, room.hostId, {
    pool: POOL,
    ladderLength: "full",
    timerSeconds: 0,
    usedKeys: new Set(),
    rng: seeded(1),
    now: 1000,
    ...opts,
  });
  return room;
}

test("hostId is fixed at creation, independent of the player roster", () => {
  const room = roomWith(["Ana", "Ben", "Cy"]);
  assert.strictEqual(room.players.length, 3);
  assert.strictEqual(room.hostId, "p1");
});

test("a spectator Host (never added as a player) can still start and run the game", () => {
  const room = g.createRoom("TEST", "display");
  g.addPlayer(room, "p1", "Ana");
  g.addPlayer(room, "p2", "Ben");
  assert.strictEqual(room.players.length, 2); // the Host isn't among them
  const res = g.startGame(room, "display", {
    pool: POOL, ladderLength: "full", timerSeconds: 0, usedKeys: new Set(), rng: seeded(1), now: 0,
  });
  assert.deepStrictEqual(res, {});
  assert.strictEqual(room.phase, "question");
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1);
  g.submitAnswer(room, "p2", q.correctIndex, 1);
  const summary = g.resolveQuestion(room, 2);
  assert.strictEqual(summary.results.length, 2); // Host never appears in results
  assert.deepStrictEqual(g.advanceQuestion(room, "display", 3), {});
});

test("startGame with a spectator Host and zero players still requires at least one player", () => {
  const room = g.createRoom("TEST", "display");
  const res = g.startGame(room, "display", {
    pool: POOL, ladderLength: "full", timerSeconds: 0, usedKeys: new Set(), rng: seeded(1), now: 0,
  });
  assert.ok(res.error);
});

test("room caps at MAX_PLAYERS and rejects duplicate names", () => {
  const names = Array.from({ length: g.MAX_PLAYERS }, (_, i) => `p${i}`);
  const room = roomWith(names);
  assert.ok(g.addPlayer(room, "overflow", "late").error);
  const small = roomWith(["Ana"]);
  assert.ok(g.addPlayer(small, "px", "ana").error);
});

test("buildDeck picks one question per distinct tier, descending, skipping empty tiers", () => {
  const deck = g.buildDeck(POOL, "full", new Set(), seeded(1));
  assert.strictEqual(deck.length, 4); // tiers: 92, 70, 30, 1
  assert.deepStrictEqual(deck.map((q) => q.tier), [92, 70, 30, 1]);
  for (const entry of deck) {
    assert.strictEqual(entry.choices.length, 4);
    assert.ok(entry.correctIndex >= 0 && entry.correctIndex < 4);
  }
});

test("buildDeck skips already-used questions via usedKeys", () => {
  const used = new Set([g.questionKey(POOL[0]), g.questionKey(POOL[1])]);
  const deck = g.buildDeck(POOL, "full", used, seeded(1));
  assert.strictEqual(deck.some((q) => q.tier === 92), false);
});

test("buildDeck carries optional question image metadata without affecting text-only questions", () => {
  const deck = g.buildDeck(POOL, "full", new Set([g.questionKey(POOL[1])]), seeded(1));
  assert.strictEqual(deck[0].image, "images/questions/test.svg");
  assert.strictEqual(deck[0].imageAlt, "A test diagram");
  assert.strictEqual(deck.find((q) => q.tier === 70).image, null);
});

test("buildDeck 'quick' spreads across available tiers within LADDER_TARGET_LENGTH", () => {
  const bigPool = [];
  for (let t = 1; t <= 20; t++) {
    bigPool.push({ tier: t * 5, q: `Q${t}`, a: "R", d: ["W1", "W2", "W3"] });
  }
  const deck = g.buildDeck(bigPool, "quick", new Set(), seeded(2));
  assert.ok(deck.length <= g.LADDER_TARGET_LENGTH);
  assert.strictEqual(deck[0].tier, 100); // easiest kept
  assert.strictEqual(deck[deck.length - 1].tier, 5); // hardest kept
});

test("startGame requires the host and at least one player", () => {
  const room = roomWith(["Ana"]);
  const asNonHost = g.startGame(room, "not-the-host", { pool: POOL, ladderLength: "full", timerSeconds: 0, usedKeys: new Set(), rng: seeded(1), now: 0 });
  assert.ok(asNonHost.error);
  const res = g.startGame(room, "p1", { pool: POOL, ladderLength: "full", timerSeconds: 0, usedKeys: new Set(), rng: seeded(1), now: 0 });
  assert.deepStrictEqual(res, {});
  assert.strictEqual(room.phase, "question");
  assert.strictEqual(room.qIndex, 0);
});

test("startGame errors when the pool has no fresh questions", () => {
  const room = roomWith(["Ana"]);
  const allUsed = new Set(POOL.map((q) => g.questionKey(q)));
  const res = g.startGame(room, "p1", { pool: POOL, ladderLength: "full", timerSeconds: 0, usedKeys: allUsed, rng: seeded(1), now: 0 });
  assert.ok(res.error);
});

test("submitAnswer accepts a valid choice and reports when everyone is in", () => {
  const room = startedRoom(["Ana", "Ben"]);
  assert.deepStrictEqual(g.submitAnswer(room, "p1", 0, 1001), { done: false });
  assert.deepStrictEqual(g.submitAnswer(room, "p2", 1, 1002), { done: true });
});

test("submitAnswer rejects eliminated players and invalid choices", () => {
  const room = startedRoom(["Ana", "Ben"]);
  const ana = g.getPlayer(room, "p1");
  ana.alive = false;
  assert.ok(g.submitAnswer(room, "p1", 0, 1001).error);
  assert.ok(g.submitAnswer(room, "p2", 9, 1001).error);
});

test("questions may have as few as 2 choices (e.g. True/False) — validated per-question, not a fixed count", () => {
  const twoChoicePool = [{ tier: 50, q: "True or False?", a: "True", d: ["False"] }];
  const room = roomWith(["Ana"]);
  g.startGame(room, room.hostId, { pool: twoChoicePool, ladderLength: "full", timerSeconds: 0, usedKeys: new Set(), rng: seeded(1), now: 0 });
  const q = g.currentQuestion(room);
  assert.strictEqual(q.choices.length, 2);
  assert.ok(g.submitAnswer(room, "p1", 2, 1001).error); // out of range for this 2-choice question
  assert.deepStrictEqual(g.submitAnswer(room, "p1", 1, 1001), { done: true });
});

test("resolveQuestion eliminates wrong answers and advances to 'reveal' mid-ladder", () => {
  const room = startedRoom(["Ana", "Ben", "Cy"]);
  const q = g.currentQuestion(room);
  const wrongIdx = (q.correctIndex + 1) % 4;
  g.submitAnswer(room, "p1", q.correctIndex, 1001); // right
  g.submitAnswer(room, "p2", wrongIdx, 1001); // wrong
  g.submitAnswer(room, "p3", q.correctIndex, 1001); // right
  const summary = g.resolveQuestion(room, 1002);
  assert.strictEqual(summary.tier, 92);
  assert.strictEqual(summary.isLine, true);
  assert.strictEqual(g.getPlayer(room, "p1").alive, true);
  assert.strictEqual(g.getPlayer(room, "p2").alive, false);
  assert.strictEqual(g.getPlayer(room, "p3").alive, true);
  assert.strictEqual(room.phase, "reveal");
});

test("a player who never answers before resolution counts as wrong", () => {
  const room = startedRoom(["Ana", "Ben"], { timerSeconds: 20 });
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  // Ben never answers; timer expiry lets the host force a resolve.
  assert.strictEqual(g.checkTimerExpired(room, 1000 + 20000), true);
  const summary = g.resolveQuestion(room, 1000 + 20000);
  assert.strictEqual(summary.results.find((r) => r.id === "p2").correct, false);
  assert.strictEqual(g.getPlayer(room, "p2").alive, false);
});

test("everyone wrong on the same question still reveals the answer before ending with no winners", () => {
  const room = startedRoom(["Ana", "Ben"]);
  const q = g.currentQuestion(room);
  const wrongIdx = (q.correctIndex + 1) % 4;
  g.submitAnswer(room, "p1", wrongIdx, 1001);
  g.submitAnswer(room, "p2", wrongIdx, 1001);
  g.resolveQuestion(room, 1002);
  assert.strictEqual(room.phase, "reveal"); // wipeout still shows the reveal first
  assert.strictEqual(room.lastResult.correctIndex, q.correctIndex);
  g.advanceQuestion(room, room.hostId, 1003);
  assert.strictEqual(room.phase, "over");
  assert.deepStrictEqual(room.winnerIds, []);
});

test("surviving the final question in the ladder wins, ties can share the win", () => {
  const room = startedRoom(["Ana", "Ben"]);
  // Full ladder from POOL has 4 tiers: walk through all of them correctly.
  for (let i = 0; i < 4; i++) {
    const q = g.currentQuestion(room);
    g.submitAnswer(room, "p1", q.correctIndex, 2000 + i);
    g.submitAnswer(room, "p2", q.correctIndex, 2000 + i);
    g.resolveQuestion(room, 2000 + i);
    if (room.phase === "reveal") g.advanceQuestion(room, room.hostId, 2000 + i);
  }
  assert.strictEqual(room.phase, "over");
  assert.deepStrictEqual(new Set(room.winnerIds), new Set(["p1", "p2"]));
});

test("advanceQuestion is host-only and only valid from 'reveal'", () => {
  const room = startedRoom(["Ana", "Ben"]);
  assert.ok(g.advanceQuestion(room, "p1", 1000).error); // still 'question' phase
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  g.submitAnswer(room, "p2", q.correctIndex, 1001);
  g.resolveQuestion(room, 1002);
  assert.ok(g.advanceQuestion(room, "p2", 1003).error); // not the host
  assert.deepStrictEqual(g.advanceQuestion(room, "p1", 1003), {});
  assert.strictEqual(room.phase, "question");
  assert.strictEqual(room.qIndex, 1);
});

test("resetToLobby drops players who left mid-game and clears the deck", () => {
  const room = startedRoom(["Ana", "Ben", "Cy"]);
  g.removePlayer(room, "p3"); // mid-game leave -> marked left
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  g.submitAnswer(room, "p2", q.correctIndex, 1001);
  g.resolveQuestion(room, 1002);
  g.advanceQuestion(room, "p1", 1003);
  // Force game over by wiping everyone on the next question.
  const q2 = g.currentQuestion(room);
  const wrongIdx = (q2.correctIndex + 1) % 4;
  g.submitAnswer(room, "p1", wrongIdx, 1004);
  g.submitAnswer(room, "p2", wrongIdx, 1004);
  g.resolveQuestion(room, 1005);
  g.advanceQuestion(room, "p1", 1006);
  assert.strictEqual(room.phase, "over");
  const res = g.resetToLobby(room, "p1");
  assert.deepStrictEqual(res, {});
  assert.strictEqual(room.phase, "lobby");
  assert.strictEqual(room.players.length, 2); // p3 dropped
  assert.ok(room.players.every((p) => p.alive));
  assert.strictEqual(room.deck.length, 0);
});

test("toPublicState never leaks the correct answer while a question is open", () => {
  const room = startedRoom(["Ana", "Ben"]);
  g.submitAnswer(room, "p1", 2, 1001);
  const stateForP1 = g.toPublicState(room, "p1", 1002);
  const stateForP2 = g.toPublicState(room, "p2", 1002);
  assert.strictEqual(stateForP1.question.correctIndex, undefined);
  assert.strictEqual(stateForP1.lastResult, null);
  assert.strictEqual(stateForP1.players.find((p) => p.id === "p1").myChoice, 2);
  assert.strictEqual(stateForP2.players.find((p) => p.id === "p1").myChoice, undefined);
  assert.strictEqual(stateForP2.players.find((p) => p.id === "p1").answered, true);
});

test("revealAdvanceSeconds: 0 means manual advance, no auto-expiry ever", () => {
  const room = startedRoom(["Ana", "Ben"], { revealAdvanceSeconds: 0 });
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  g.submitAnswer(room, "p2", q.correctIndex, 1001);
  g.resolveQuestion(room, 1002);
  assert.strictEqual(g.checkRevealExpired(room, 1002 + 999999), false);
});

test("revealAdvanceSeconds > 0 auto-expires after the configured pause and resets on advance", () => {
  const room = startedRoom(["Ana", "Ben"], { revealAdvanceSeconds: 5 });
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  g.submitAnswer(room, "p2", q.correctIndex, 1001);
  g.resolveQuestion(room, 2000);
  assert.strictEqual(g.checkRevealExpired(room, 2000 + 4999), false);
  assert.strictEqual(g.checkRevealExpired(room, 2000 + 5000), true);
  const state = g.toPublicState(room, "p1", 2000 + 5000);
  assert.strictEqual(state.revealDeadlineAt, 2000 + 5000);
  g.advanceQuestion(room, room.hostId, 2000 + 5000);
  assert.strictEqual(room.revealStartedAt, null);
  assert.strictEqual(g.checkRevealExpired(room, 2000 + 999999), false); // now in 'question' phase
});

test("toPublicState reveals the answer only after resolveQuestion, via lastResult", () => {
  const room = startedRoom(["Ana", "Ben"]);
  const q = g.currentQuestion(room);
  g.submitAnswer(room, "p1", q.correctIndex, 1001);
  g.submitAnswer(room, "p2", q.correctIndex, 1001);
  g.resolveQuestion(room, 1002);
  const state = g.toPublicState(room, "p1", 1003);
  assert.strictEqual(state.lastResult.correctIndex, q.correctIndex);
  assert.strictEqual(state.lastResult.image, q.image);
  assert.strictEqual(state.lastResult.imageAlt, q.imageAlt);
});
