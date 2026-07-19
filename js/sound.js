// Tiny, dependency-free sound effects synthesized with the Web Audio API —
// no external audio files, so there's nothing to source, license, or ship
// as a binary asset. Every "sound" here is just oscillators with a gain
// envelope, generated on the fly.

let ctx = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers block audio until a user gesture unlocks it. Call this from an
// early click handler (Create room / Join) so the context is already
// running by the time playGameStart() actually needs to fire later —
// that moment isn't itself a fresh click for every player (joined players
// hear it from a network broadcast, not a tap).
export function unlockAudio() {
  getCtx();
}

function tone(c, freq, startSec, durationSec, { type = "sine", peakGain = 0.2, attack = 0.012, release = 0.12 } = {}) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + startSec);
  gain.gain.setValueAtTime(0, c.currentTime + startSec);
  gain.gain.linearRampToValueAtTime(peakGain, c.currentTime + startSec + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + startSec + durationSec + release);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + startSec);
  osc.stop(c.currentTime + startSec + durationSec + release + 0.02);
}

// A short, dramatic "the ladder begins" cue — a low suspense note into a
// bold ascending fanfare. Plays once, right when the room leaves the lobby
// for the first question (see main.js's phase-transition check), never on
// every re-render.
export function playGameStart() {
  const c = getCtx();
  if (!c) return;
  tone(c, 196.0, 0, 0.16, { type: "square", peakGain: 0.14 }); // low suspense hit
  const fanfare = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  fanfare.forEach((freq, i) => tone(c, freq, 0.2 + i * 0.09, 0.11, { type: "square", peakGain: 0.18 }));
}
