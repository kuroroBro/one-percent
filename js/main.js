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
import { loadSettings, saveSettings, loadUsedQuestionKeys, markQuestionsUsed, resetUsedQuestionKeys } from "./storage.js";

const HOST_ID = "host"; // stable local id for the Host's own player entry

let isHost = false;
let room = null; // authoritative room object — only meaningful when isHost
let net = null; // { broadcast, broadcastEach, close } (host) or { send, close } (client)
let state = null; // last known public state
let myId = null;
let clockOffset = 0; // hostNow - myNow, so my countdown matches the Host's clock
let timerHandle = null;
let selectedChoice = null; // my pending pick this question, before I submit

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
  if (p.id === myId) chip.classList.add("me");
  const name = document.createElement("span");
  name.className = "pname";
  name.textContent = p.name + (p.id === state.hostId ? " ★" : "");
  chip.appendChild(name);
  if (state.phase === "question" && p.alive) {
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

function renderLobby() {
  $("lobby-code").textContent = state.code;
  renderRoster($("lobby-players"));
  const iAmHost = myId === state.hostId;
  $("start-btn").classList.toggle("hidden", !iAmHost);
  $("lobby-host-settings").classList.toggle("hidden", !iAmHost);
  $("lobby-hint").textContent = iAmHost
    ? "Start whenever your group has joined."
    : "Waiting for the host to start the ladder…";
}

function tierLabel(tier, isLine) {
  if (isLine) return `THE LINE — ${tier}%`;
  return `${tier}% got this right`;
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
  renderRoster($("question-roster"));

  const my = me();
  const alive = my && my.alive;
  $("out-banner").classList.toggle("hidden", !!alive);

  const box = $("question-choices");
  box.innerHTML = "";
  q.choices.forEach((choiceText, i) => {
    const btn = document.createElement("button");
    btn.className = "btn choice-btn";
    btn.textContent = choiceText;
    btn.disabled = !alive || (my && my.answered);
    if (selectedChoice === i) btn.classList.add("selected");
    btn.addEventListener("click", () => pickChoice(i));
    box.appendChild(btn);
  });

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

function renderReveal() {
  const r = state.lastResult;
  $("reveal-tier").textContent = tierLabel(r.tier, r.isLine);
  $("reveal-question").textContent = r.question;
  $("reveal-answer").textContent = r.choices[r.correctIndex];
  $("reveal-explain").textContent = r.explain || "";
  $("reveal-explain").classList.toggle("hidden", !r.explain);
  const list = $("reveal-results");
  list.innerHTML = "";
  for (const res of r.results) {
    const row = document.createElement("div");
    row.className = "result-row" + (res.correct ? " correct" : " wrong");
    const pickedText =
      res.choiceIndex === null || res.choiceIndex === undefined
        ? "no answer"
        : r.choices[res.choiceIndex];
    row.textContent = `${res.correct ? "✅" : "❌"} ${res.name} — ${pickedText}`;
    list.appendChild(row);
  }
  const stillIn = state.players.filter((p) => p.alive);
  const isEnding = stillIn.length === 0 || state.qIndex === state.deckLength - 1;
  $("reveal-status").textContent =
    stillIn.length === 0
      ? "Everyone fell off the line."
      : `${stillIn.length} still in: ${stillIn.map((p) => p.name).join(", ")}`;
  const iAmHost = myId === state.hostId;
  $("next-btn").textContent = isEnding ? "See final results →" : "Next question →";
  $("next-btn").classList.toggle("hidden", !iAmHost);
}

function renderOver() {
  const winners = state.winnerIds || [];
  const names = state.players.filter((p) => winners.includes(p.id)).map((p) => p.name);
  $("over-title").textContent = names.length > 0 ? "🏆 Reached the 1%!" : "No one cleared the line";
  $("over-detail").textContent =
    names.length > 0
      ? `${names.join(" & ")} climbed the whole ladder.`
      : "The whole group fell off before the ladder ran out. Give it another go!";
  const iAmHost = myId === state.hostId;
  $("again-btn").classList.toggle("hidden", !iAmHost);
}

function render() {
  if (!state) return show("home");
  selectedChoice = null;
  if (state.phase === "lobby") {
    show("lobby");
    renderLobby();
  } else if (state.phase === "question") {
    show("question");
    renderQuestion();
  } else if (state.phase === "reveal") {
    stopTimerLoop();
    show("reveal");
    renderReveal();
  } else if (state.phase === "over") {
    stopTimerLoop();
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
  if (!my || !my.alive || my.answered) return;
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
      const res = game.addPlayer(room, playerId, payload.name);
      if (res.error) return { error: res.error };
      broadcastState();
      return { code: room.code, playerId, hostNow: Date.now(), state: game.toPublicState(room, playerId, Date.now()) };
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
        ladderLength: payload.ladderLength || "quick",
        timerSeconds: Number(payload.timerSeconds) || 0,
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
  const empty = game.removePlayer(room, playerId);
  if (empty) {
    net.close();
    net = null;
    room = null;
    isHost = false;
    return;
  }
  broadcastState();
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
  if (my) saveSettings({ ...loadSettings(), name: my.name });
}

function resetToHome() {
  isHost = false;
  room = null;
  net = null;
  myId = null;
}

$("create-btn").addEventListener("click", async () => {
  const name = $("name-input").value.trim();
  if (!name) return toast("Enter your name first");
  $("create-btn").disabled = true;
  try {
    const hostNet = await hostRoom({
      onMessage: handleEvent,
      onPeerClose: handlePeerClose,
      onError: (msg) => toast(msg),
    });
    room = game.createRoom(hostNet.code);
    const res = game.addPlayer(room, HOST_ID, name);
    if (res.error) {
      hostNet.close();
      room = null;
      return toast(res.error);
    }
    isHost = true;
    net = hostNet;
    myId = HOST_ID;
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
    const joined = await joinRoom(code, { onPush: handlePush, onClose: handleNetClose });
    net = joined;
    isHost = false;
    const res = await net.send("joinRoom", { name });
    if (res.error) {
      net.close();
      net = null;
      return toast(res.error);
    }
    myId = joined.id;
    enterRoom(res);
  } catch (err) {
    resetToHome();
    toast(err.message || "Could not join that room");
  } finally {
    $("join-btn").disabled = false;
  }
}

$("join-btn").addEventListener("click", () => {
  const name = $("name-input").value.trim();
  const code = $("code-input").value.trim().toUpperCase();
  if (!name) return toast("Enter your name first");
  if (!code) return toast("Enter a room code");
  join(code, name);
});

$("copy-link-btn").addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  navigator.clipboard.writeText(url).then(
    () => toast("Invite link copied"),
    () => toast(url)
  );
});

$("start-btn").addEventListener("click", () => {
  const ladderLength = $("ladder-select").value;
  const timerSeconds = Number($("timer-select").value);
  saveSettings({ ...loadSettings(), ladderLength, timerSeconds });
  callAction("startGame", { ladderLength, timerSeconds }).then(
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
$("ladder-select").value = saved.ladderLength;
$("timer-select").value = String(saved.timerSeconds);
$("rename-input").value = saved.name;

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) $("code-input").value = urlRoom;

render();
