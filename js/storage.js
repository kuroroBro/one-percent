// localStorage persistence for last-used name/settings and which questions
// have already been played, so replays on the same device don't repeat a
// ladder. Modeled on guess-antok-phrases's storage.js.

const SETTINGS_KEY = "onePercentClub.settings.v1";
const USED_QUESTIONS_KEY = "onePercentClub.usedQuestionKeys.v1";
const PLAYER_SESSIONS_KEY = "onePercentClub.playerSessions.v1";

export const DEFAULT_SETTINGS = {
  name: "",
  questionCount: 15,
  timerSeconds: 30, // 0 = no timer
  revealAdvanceSeconds: 0, // 0 = manual (Host taps Next question); else auto-advance after N seconds
  spectatorHost: false, // true = Host runs the room as a display, doesn't play
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full/blocked - the game still works for this session
  }
}

export function loadSettings() {
  const saved = read(SETTINGS_KEY, null);
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  return { ...structuredClone(DEFAULT_SETTINGS), ...saved };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function loadUsedQuestionKeys() {
  const saved = read(USED_QUESTIONS_KEY, []);
  if (!Array.isArray(saved)) return [];
  return saved.filter((key) => typeof key === "string");
}

export function saveUsedQuestionKeys(keys) {
  write(USED_QUESTIONS_KEY, [...new Set(keys)]);
}

export function markQuestionsUsed(keys) {
  if (!keys || keys.length === 0) return;
  saveUsedQuestionKeys([...loadUsedQuestionKeys(), ...keys]);
}

export function resetUsedQuestionKeys() {
  saveUsedQuestionKeys([]);
}

// A rejoin token is a private capability shared only by this browser and the
// Host. It is never included in public room state. Sessions are keyed by room
// code so one browser can safely have remembered seats in different rooms.
export function loadPlayerSession(code) {
  const sessions = read(PLAYER_SESSIONS_KEY, {});
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return null;
  const session = sessions[String(code || "").toUpperCase()];
  if (!session || typeof session.resumeToken !== "string" || !session.resumeToken) return null;
  return {
    resumeToken: session.resumeToken,
    name: typeof session.name === "string" ? session.name : "",
  };
}

export function savePlayerSession(code, session) {
  const normalizedCode = String(code || "").toUpperCase();
  if (!normalizedCode || !session || typeof session.resumeToken !== "string" || !session.resumeToken) return;
  const sessions = read(PLAYER_SESSIONS_KEY, {});
  const safeSessions = sessions && typeof sessions === "object" && !Array.isArray(sessions) ? sessions : {};
  safeSessions[normalizedCode] = {
    resumeToken: session.resumeToken,
    name: String(session.name || "").slice(0, 20),
  };
  write(PLAYER_SESSIONS_KEY, safeSessions);
}

export function createResumeToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
