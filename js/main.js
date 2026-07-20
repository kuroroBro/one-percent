// 1% Club (party edition) client. Every player runs this same file; whoever
// creates the room additionally becomes the room's authoritative Host (see
// specs/001-one-percent-club/plan.md). Non-host players send intents over
// PeerJS and render whatever state the Host last pushed; the Host mutates
// `room` directly via js/game.js and pushes the result to everyone,
// including itself (there is no separate "server process" to loop back
// through — see `push()` below).

import * as game from "./game.js";
import { QUESTIONS } from "./questions.js";
import { hostRoom, joinRoom } from "./room.js";
import { unlockAudio, playGameStart } from "./sound.js";
import {
  createResumeToken,
  loadPlayerSession,
  loadSettings,
  loadUsedQuestionKeys,
  markQuestionsUsed,
  resetUsedQuestionKeys,
  savePlayerSession,
  saveSettings,
} from "./storage.js";
import { recordShowResult } from "./leaderboard.js";

const HOST_ID = "host"; // stable local id for the Host's own player entry

let isHost = false;
let room = null; // authoritative room object — only meaningful when isHost
let net = null; // { broadcast, broadcastEach, close } (host) or { send, close } (client)
let state = null; // last known public state
let myId = null;
let clockOffset = 0; // hostNow - myNow, so my countdown matches the Host's clock
let timerHandle = null;
let revealTimerHandle = null;
let selectedChoice = null; // my pending pick this question, before I submit
let activeResumeToken = null;
let lastPhase = null; // previous state.phase, so we can tell lobby -> question apart from a mid-game re-render

const $ = (id) => document.getElementById(id);
const screens = {
  home: $("screen-home"),
  lobby: $("screen-lobby"),
  question: $("screen-question"),
  reveal: $("screen-reveal"),
  over: $("screen-over"),
};

function show(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function me() {
  return state ? state.players.find((p) => p.id === myId) : null;
}

function hostNow() {
  return Date.now() + clockOffset;
}

// ---------- Rendering ----------

function renderPlayerChip(p) {
  const chip = document.createElement("div");
  chip.className = "pchip";
  if (!p.alive) chip.classList.add("out");
  if (!p.connected) chip.classList.add("disconnected");
  if (p.id === myId) chip.classList.add("me");
  const name = document.createElement("span");
  name.className = "pname";
  name.textContent = p.name + (p.id === state.hostId ? " ★" : "");
  chip.appendChild(name);
  if (!p.connected) {
    const status = document.createElement("span");
    status.className = "ready-dot";
    status.textContent = "offline — can rejoin";
    chip.appendChild(status);
  }
  if (state.phase === "question" && p.connected) {
    const dot = document.createElement("span");
    dot.className = "ready-dot" + (p.answered ? " in" : "");
    dot.textContent = p.answered ? "locked in" : "thinking…";
    chip.appendChild(dot);
  }
  return chip;
}

function renderRoster(container) {
  container.innerHTML = "";
  for (const p of state.players) container.appendChild(renderPlayerChip(p));
}

// Derived from state, not a locally-tracked flag: the Host is "spectating"
// whenever hostId doesn't correspond to any entry in players (see
// game.js createRoom — hostId is fixed independent of the roster). Anyone
// viewing state can tell, not just the Host's own device.
function hostIsPlaying() {
  return state.players.some((p) => p.id === state.hostId);
}

function renderLobby() {
  $("lobby-code").textContent = state.code;
  const inviteUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`;
  const qr = $("lobby-qr");
  // Keep the QR payload to the public room URL only. Player resume tokens are
  // deliberately stored privately in localStorage and never put in invites.
  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inviteUrl)}`;
  qr.alt = `QR code to join room ${state.code}`;
  renderRoster($("lobby-players"));
  const iAmHost = myId === state.hostId;
  $("start-btn").classList.toggle("hidden", !iAmHost);
  $("lobby-host-settings").classList.toggle("hidden", !iAmHost);
  $("lobby-spectator-hint").classList.toggle("hidden", hostIsPlaying());
  $("lobby-hint").textContent = iAmHost
    ? "Start whenever your group has joined."
    : "Waiting for the host to start the ladder…";
}

function tierLabel(tier, isLine) {
  if (isLine) return `THE LINE — ${tier}%`;
  return `${tier}% got this right`;
}

function renderQuestionImage(elementId, image, imageAlt) {
  const el = $(elementId);
  if (image) {
    el.src = image;
    el.alt = imageAlt || "Question illustration";
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("src");
    el.alt = "";
    el.classList.add("hidden");
  }
}

function stopTimerLoop() {
  if (timerHandle) cancelAnimationFrame(timerHandle);
  timerHandle = null;
}

function renderQuestion() {
  const q = state.question;
  $("question-progress").textContent = `Question ${state.qIndex + 1} of ${state.deckLength}`;
  $("question-tier").textContent = tierLabel(q.tier, q.isLine);
  $("question-tier").classList.toggle("line", q.isLine);
  $("question-text").textContent = q.question;
  renderQuestionImage("question-image", q.image, q.imageAlt);
  renderRoster($("question-roster"));

  const my = me();
  const isPlayer = !!my;
  const alive = isPlayer && my.alive;
  $("out-banner").classList.toggle("hidden", !isPlayer || alive);
  $("spectator-banner").classList.toggle("hidden", isPlayer);

  const box = $("question-choices");
  box.innerHTML = "";
  if (isPlayer) {
    const chosenIndex = my.answered ? my.myChoice : selectedChoice;
    q.choices.forEach((choiceText, i) => {
      const btn = document.createElement("button");
      btn.className = "btn choice-btn";
      btn.textContent = choiceText;
      btn.disabled = my.answered;
      const isChosen = chosenIndex === i;
      btn.setAttribute("aria-pressed", String(isChosen));
      if (isChosen) {
        btn.classList.add("selected");
        if (my.answered) {
          btn.classList.add("locked");
          const marker = document.createElement("span");
          marker.className = "answer-marker";
          marker.textContent = "✓ Your locked answer";
          btn.appendChild(marker);
        }
      }
      btn.addEventListener("click", () => pickChoice(i));
      box.appendChild(btn);
    });
  }

  stopTimerLoop();
  const bar = $("timer-bar");
  const label = $("timer-label");
  if (state.questionDeadlineAt) {
    bar.classList.remove("hidden");
    const total = state.timerSeconds * 1000;
    const tick = () => {
      const remainMs = Math.max(0, state.questionDeadlineAt - hostNow());
      bar.style.setProperty("--pct", `${Math.max(0, (remainMs / total) * 100)}%`);
      label.textContent = `${Math.ceil(remainMs / 1000)}s`;
      if (remainMs <= 0) {
        stopTimerLoop();
        if (isHost) tryResolve();
        return;
      }
      timerHandle = requestAnimationFrame(tick);
    };
    tick();
  } else {
    bar.classList.add("hidden");
    label.textContent = "";
  }
}

function stopRevealTimerLoop() {
  if (revealTimerHandle) cancelAnimationFrame(revealTimerHandle);
  revealTimerHandle = null;
}

function renderReveal() {
  stopRevealTimerLoop();
  const r = state.lastResult;
  $("reveal-tier").textContent = tierLabel(r.tier, r.isLine);
  $("reveal-question").textContent = r.question;
  renderQuestionImage("reveal-image", r.image, r.imageAlt);
  $("reveal-answer").textContent = r.choices[r.correctIndex];
  $("reveal-explain").textContent = r.explain || "";
  $("reveal-explain").classList.toggle("hidden", !r.explain);
  const list = $("reveal-results");
  list.innerHTML = "";
  for (const res of r.results) {
    const row = document.createElement("div");
    row.className = "result-row" + (res.correct ? " correct" : " wrong");
    if (!res.wasEligible) row.classList.add("already-out");
    const pickedText =
      res.choiceIndex === null || res.choiceIndex === undefined
        ? "no answer"
        : r.choices[res.choiceIndex];
    const player = document.createElement("span");
    player.className = "result-player";
    const tag = res.wasEligible ? "" : " (not eligible to win)";
    player.textContent = `${res.correct ? "✅" : "❌"} ${res.name}${tag}`;
    const answer = document.createElement("strong");
    answer.className = "result-answer";
    answer.textContent = pickedText;
    answer.title = `${res.name}'s submitted answer`;
    row.append(player, answer);
    list.appendChild(row);
  }
  const stillIn = state.players.filter((p) => p.alive);
  // Mirrors game.js's resolveQuestion(): the next advance ends the game
  // either because every eligible player just fell off (a wipeout, which
  // can happen mid-ladder) or because this was the last question either way.
  const isEnding = stillIn.length === 0 || state.qIndex === state.deckLength - 1;
  $("reveal-status").textContent =
    stillIn.length === 0
      ? "Everyone fell off the line — no one can win this game anymore."
      : `${stillIn.length} still eligible to win: ${stillIn.map((p) => p.name).join(", ")}`;
  const iAmHost = myId === state.hostId;
  $("next-btn").textContent = isEnding ? "See final results →" : "Next question →";
  $("next-btn").classList.toggle("hidden", !iAmHost);

  const bar = $("reveal-timer-bar");
  const label = $("reveal-timer-label");
  if (state.revealDeadlineAt) {
    bar.classList.remove("hidden");
    const total = state.revealAdvanceSeconds * 1000;
    const tick = () => {
      const remainMs = Math.max(0, state.revealDeadlineAt - hostNow());
      bar.style.setProperty("--pct", `${Math.max(0, (remainMs / total) * 100)}%`);
      label.textContent = `Next in ${Math.ceil(remainMs / 1000)}s`;
      if (remainMs <= 0) {
        stopRevealTimerLoop();
        if (isHost) maybeAutoAdvance();
        return;
      }
      revealTimerHandle = requestAnimationFrame(tick);
    };
    tick();
  } else {
    bar.classList.add("hidden");
    label.textContent = "";
  }
}

function renderOver() {
  const winners = state.winnerIds || [];
  const names = state.players.filter((p) => winners.includes(p.id)).map((p) => p.name);
  $("over-title").textContent = names.length > 0 ? "🏆 Reached the 1%!" : "No one cleared the line";
  $("over-detail").textContent =
    names.length > 0
      ? `${names.join(" & ")} climbed the whole ladder.`
      : "The whole group fell off before the ladder ran out. Give it another go!";
  // Full final standings, not just the winner line -- every player's own
  // result should be visible on this screen, not only the survivors'.
  const list = $("over-results");
  list.innerHTML = "";
  const ordered = [...state.players].sort((a, b) => Number(winners.includes(b.id)) - Number(winners.includes(a.id)));
  for (const p of ordered) {
    const won = winners.includes(p.id);
    const row = document.createElement("div");
    row.className = "result-row" + (won ? " correct" : " wrong");
    const player = document.createElement("span");
    player.className = "result-player";
    player.textContent = `${won ? "✅" : "❌"} ${p.name}`;
    const status = document.createElement("strong");
    status.className = "result-answer";
    status.textContent = won ? "Reached the 1%" : "Eliminated";
    row.append(player, status);
    list.appendChild(row);
  }
  const iAmHost = myId === state.hostId;
  $("again-btn").classList.toggle("hidden", !iAmHost);
}

function render() {
  if (!state) { lastPhase = null; return show("home"); }
  selectedChoice = null;
  // The ladder actually begins the moment everyone leaves the lobby for the
  // first question — fires once per game (including replays via "Play
  // again", which resets to "lobby" first), never on the timer-driven
  // re-renders that already happen throughout "question".
  if (state.phase === "question" && lastPhase === "lobby") playGameStart();
  lastPhase = state.phase;
  if (state.phase === "lobby") {
    show("lobby");
    renderLobby();
  } else if (state.phase === "question") {
    stopRevealTimerLoop();
    show("question");
    renderQuestion();
  } else if (state.phase === "reveal") {
    stopTimerLoop();
    show("reveal");
    renderReveal();
  } else if (state.phase === "over") {
    stopTimerLoop();
    stopRevealTimerLoop();
    show("over");
    renderOver();
  }
}

// ---------- Actions ----------
// Every user-initiated intent flows through here. On the Host's own device
// it's applied directly (no network hop); everyone else sends it to the
// Host over PeerJS and awaits the ack.
function callAction(event, payload) {
  if (isHost) return Promise.resolve(handleEvent(myId, event, payload));
  return net.send(event, payload);
}

function pickChoice(i) {
  const my = me();
  if (!my || my.answered) return;
  selectedChoice = i;
  renderQuestion();
  callAction("answer", { choiceIndex: i }).then(
    (res) => { if (res.error) toast(res.error); },
    (err) => toast(err.message)
  );
}

// ---------- Host authority ----------
// The direct replacement for a server's per-event handlers, called either
// in-process (the Host's own actions) or from room.js's onMessage (a remote
// player's request). Only ever runs on the Host's device.
function handleEvent(playerId, event, payload) {
  payload = payload || {};
  switch (event) {
    case "joinRoom": {
      let res = game.rejoinPlayer(room, playerId, payload.resumeToken);
      const rejoined = !res.error;
      if (res.error === "No saved seat found") {
        res = game.addPlayer(room, playerId, payload.name, payload.resumeToken);
      }
      if (res.error) return { error: res.error };
      broadcastState();
      return { code: room.code, playerId, rejoined, hostNow: Date.now(), state: game.toPublicState(room, playerId, Date.now()) };
    }
    case "rename": {
      const res = game.renamePlayer(room, playerId, payload.name);
      if (res.error) return { error: res.error };
      broadcastState();
      return {};
    }
    case "startGame": {
      const now = Date.now();
      const usedKeys = new Set(loadUsedQuestionKeys());
      const res = game.startGame(room, playerId, {
        pool: QUESTIONS,
        questionCount: Number(payload.questionCount) || game.MAX_QUESTIONS_PER_GAME,
        timerSeconds: Number(payload.timerSeconds) || 0,
        revealAdvanceSeconds: Number(payload.revealAdvanceSeconds) || 0,
        usedKeys,
        now,
      });
      if (res.error) return { error: res.error };
      markQuestionsUsed(room.deck.map((q) => q.key));
      broadcastState();
      return {};
    }
    case "answer": {
      const res = game.submitAnswer(room, playerId, payload.choiceIndex, Date.now());
      if (res.error) return { error: res.error };
      broadcastState();
      tryResolve();
      return {};
    }
    case "advance": {
      const res = game.advanceQuestion(room, playerId, Date.now());
      if (res.error) return { error: res.error };
      if (room.phase === "over") recordShow();
      broadcastState();
      return {};
    }
    case "playAgain": {
      const res = game.resetToLobby(room, playerId);
      if (res.error) return { error: res.error };
      broadcastState();
      return {};
    }
    default:
      return { error: "Unknown request" };
  }
}

// Unlike a plain broadcast, a state snapshot differs per recipient — each
// player's own pending choice is included, everyone else's is withheld
// (js/game.js's toPublicState). net.broadcastEach computes that per
// connection; the Host's own view (no network hop) is applied directly.
function broadcastState() {
  const now = Date.now();
  net.broadcastEach("state", (playerId) => game.toPublicState(room, playerId, now));
  applyState(game.toPublicState(room, myId, now), now);
}

function tryResolve() {
  if (room.phase !== "question") return;
  const timedOut = game.checkTimerExpired(room, Date.now());
  if (!game.allAnswered(room) && !timedOut) return;
  game.resolveQuestion(room, Date.now());
  broadcastState();
}

// Mirrors tryResolve() for the reveal screen: only ever called on the
// Host's own device (the client-side countdown in renderReveal() gates
// this behind `if (isHost)`), and advanceQuestion() re-checks phase/host
// authority itself either way.
function maybeAutoAdvance() {
  if (!room || room.phase !== "reveal") return;
  if (!game.checkRevealExpired(room, Date.now())) return;
  game.advanceQuestion(room, room.hostId, Date.now());
  if (room.phase === "over") recordShow();
  broadcastState();
}

// Records the finished show for the cross-game Leader Board, from the same
// final state renderOver() shows the players -- see
// leader-board/specs/001-leader-board/. Host-only (both call sites above
// only ever run on the Host device). This game has no numeric score --
// it's last-one-standing -- so each player's recorded "score" is 1 if
// they reached the 1% (survived to the end) and 0 if eliminated, matching
// the win/loss the over screen now shows for every player.
function recordShow() {
  const winners = room.winnerIds || [];
  recordShowResult({
    game: "one-percent", gameName: "The One Percent Club",
    players: room.players.map((p) => ({ name: p.name, score: winners.includes(p.id) ? 1 : 0 })),
    winners: room.players.filter((p) => winners.includes(p.id)).map((p) => p.name),
    meta: { questions: room.deck?.length },
  });
}

function applyState(newState, hostNowMs) {
  state = newState;
  clockOffset = hostNowMs !== undefined ? hostNowMs - Date.now() : 0;
  render();
}

function handlePush(event, payload) {
  if (event === "state") applyState(payload, payload.now);
  else if (event === "roomClosed") handleNetClose(payload.message || "The host closed the room.");
}

function handlePeerClose(playerId) {
  if (!room) return;
  // Note: we don't tear the room down even if this leaves zero players — a
  // spectator Host (hostId isn't in players at all, see game.js createRoom)
  // must be able to keep an empty lobby open waiting for joins. The room
  // only ever ends when the Host's own device closes.
  game.removePlayer(room, playerId);
  broadcastState();
  tryResolve();
}

function handleNetClose(message) {
  toast(message);
  resetToHome();
  state = null;
  render();
}

// ---------- Connect / lobby ----------

function enterRoom(res) {
  myId = res.playerId;
  applyState(res.state, res.hostNow);
  history.replaceState(null, "", `?room=${res.code}`);
  const my = me();
  if (my) {
    saveSettings({ ...loadSettings(), name: my.name });
    if (activeResumeToken) savePlayerSession(res.code, { resumeToken: activeResumeToken, name: my.name });
  }
}

function resetToHome() {
  isHost = false;
  room = null;
  net = null;
  myId = null;
}

$("create-btn").addEventListener("click", async () => {
  unlockAudio(); // must happen on a real click — the game-start sound fires later, without one
  const spectator = $("spectator-checkbox").checked;
  const name = $("name-input").value.trim();
  if (!spectator && !name) return toast("Enter your name first");
  $("create-btn").disabled = true;
  try {
    const hostNet = await hostRoom({
      onMessage: handleEvent,
      onPeerClose: handlePeerClose,
      onError: (msg) => toast(msg),
    });
    room = game.createRoom(hostNet.code, HOST_ID);
    if (!spectator) {
      const res = game.addPlayer(room, HOST_ID, name);
      if (res.error) {
        hostNet.close();
        room = null;
        return toast(res.error);
      }
    }
    isHost = true;
    net = hostNet;
    myId = HOST_ID;
    saveSettings({ ...loadSettings(), spectatorHost: spectator });
    enterRoom({ code: room.code, playerId: myId, hostNow: Date.now(), state: game.toPublicState(room, myId, Date.now()) });
  } catch (err) {
    resetToHome();
    toast(err.message || "Could not create a room");
  } finally {
    $("create-btn").disabled = false;
  }
});

async function join(code, name) {
  $("join-btn").disabled = true;
  try {
    const savedSession = loadPlayerSession(code);
    activeResumeToken = savedSession ? savedSession.resumeToken : createResumeToken();
    const joined = await joinRoom(code, { onPush: handlePush, onClose: handleNetClose });
    net = joined;
    isHost = false;
    const res = await net.send("joinRoom", { name, resumeToken: activeResumeToken });
    if (res.error) {
      net.close();
      net = null;
      return toast(res.error);
    }
    myId = joined.id;
    enterRoom(res);
    if (res.rejoined) toast("Rejoined your previous seat");
  } catch (err) {
    resetToHome();
    toast(err.message || "Could not join that room");
  } finally {
    $("join-btn").disabled = false;
  }
}

$("join-btn").addEventListener("click", () => {
  unlockAudio(); // must happen on a real click — the game-start sound fires later, without one
  const name = $("name-input").value.trim();
  const code = $("code-input").value.trim().toUpperCase();
  if (!name) return toast("Enter your name first");
  if (!code) return toast("Enter a room code");
  join(code, name);
});

$("copy-link-btn").addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`;
  navigator.clipboard.writeText(url).then(
    () => toast("Invite link copied"),
    () => toast(url)
  );
});

$("start-btn").addEventListener("click", () => {
  const questionCount = Number($("question-count-select").value);
  const timerSeconds = Number($("timer-select").value);
  const revealAdvanceSeconds = Number($("reveal-advance-select").value);
  saveSettings({ ...loadSettings(), questionCount, timerSeconds, revealAdvanceSeconds });
  callAction("startGame", { questionCount, timerSeconds, revealAdvanceSeconds }).then(
    (res) => { if (res.error) toast(res.error); },
    (err) => toast(err.message)
  );
});

$("next-btn").addEventListener("click", () => {
  callAction("advance").then(
    (res) => { if (res.error) toast(res.error); },
    (err) => toast(err.message)
  );
});

$("again-btn").addEventListener("click", () => {
  callAction("playAgain").then(
    (res) => { if (res.error) toast(res.error); },
    (err) => toast(err.message)
  );
});

$("reset-questions-btn").addEventListener("click", () => {
  resetUsedQuestionKeys();
  toast("Question history cleared — the full bank is back in play");
});

$("rename-btn").addEventListener("click", () => {
  const name = $("rename-input").value.trim();
  if (!name) return;
  callAction("rename", { name }).then(
    (res) => { if (res.error) toast(res.error); },
    (err) => toast(err.message)
  );
});

// ---------- Boot ----------

const saved = loadSettings();
if (saved.name) $("name-input").value = saved.name;
$("spectator-checkbox").checked = !!saved.spectatorHost;
$("question-count-select").value = String(saved.questionCount);
$("timer-select").value = String(saved.timerSeconds);
$("reveal-advance-select").value = String(saved.revealAdvanceSeconds);
$("rename-input").value = saved.name;

const urlRoom = new URLSearchParams(location.search).get("room");
let savedUrlSession = null;
if (urlRoom) {
  $("code-input").value = urlRoom;
  savedUrlSession = loadPlayerSession(urlRoom);
  if (savedUrlSession && savedUrlSession.name) {
    $("name-input").value = savedUrlSession.name;
    $("rename-input").value = savedUrlSession.name;
    $("join-btn").textContent = "Rejoin";
  }
}

render();

// A room invite remains in the URL after joining. On reload, a remembered
// seat can therefore reconnect immediately without making the player retype
// anything or race another player for the same display name.
if (urlRoom && savedUrlSession && savedUrlSession.name) {
  join(urlRoom, savedUrlSession.name);
}
