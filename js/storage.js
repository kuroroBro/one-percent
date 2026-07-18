// localStorage persistence for last-used name/settings and which questions
// have already been played, so replays on the same device don't repeat a
// ladder. Modeled on guess-antok-phrases's storage.js.

const SETTINGS_KEY = "onePercentClub.settings.v1";
const USED_QUESTIONS_KEY = "onePercentClub.usedQuestionKeys.v1";

export const DEFAULT_SETTINGS = {
  name: "",
  ladderLength: "quick", // "quick" | "full"
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
