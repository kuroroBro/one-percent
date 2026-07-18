# Implementation Plan: 1% Club — Party Edition

## Technical Context

| Area | Choice | Notes |
| --- | --- | --- |
| Runtime | Vanilla ES modules, HTML, CSS | Static GitHub Pages compatible, no build step. |
| Sync | PeerJS over WebRTC, full-participant model | Same pattern as `attack-attack`'s P2P conversion — every player is a peer, not just Host+Display. |
| State | Host-authoritative in memory | Non-host clients render whatever snapshot they last received. |
| Tests | `node --test` | Pure rules engine tests in `tests/game.test.mjs`. |
| Manual validation | Playwright against a real PeerJS broker | See Validation section — two real browser contexts over live WebRTC, not mocked. |

## File Structure

```text
index.html               screens: Home, Lobby, Question, Reveal, Over
css/style.css             mobile-first styling, shared visual language with sibling games
js/game.js                pure rules engine
js/questions.js           question bank (tier, question, answer, 3 distractors, source)
js/main.js                DOM rendering, host-authoritative event handling, P2P glue
js/room.js                PeerJS wrapper (full-participant, adapted from attack-attack)
js/storage.js             local settings + used-question dedupe
tests/game.test.mjs       engine behavior tests
tools/gen-questions.js    normalizes researched raw question data into js/questions.js
specs/001-...             SDD spec, plan, tasks
vendor/peerjs.min.js      vendored PeerJS client
```

## Data Model

Each question in the pool (`js/questions.js`) is:

```js
{ tier: 92, q: "…", a: "Correct answer", d: ["Wrong 1", "Wrong 2", "Wrong 3"], source: "https://…" }
```

The real show is often free-response (contestants write an answer rather than
pick from a card), so where a source didn't report the on-screen multiple
choice options, three distractor answers were authored to match the answer's
format (same units/word type) — see `tools/gen-questions.js` and the
Changelog below for the sourcing pass. `tier` is the reported/estimated
percentage of the public who answered correctly; higher tier = easier.

## Rules Engine

`buildDeck(pool, ladderLength, usedKeys, rng)` (in `js/game.js`) does the
deck construction:

1. Filter out any question whose `tier::q` key is in `usedKeys` (this
   device's play history — see `js/storage.js`).
2. Collect the distinct tiers still available and sort descending (easiest
   first). "Full" plays every tier with a fresh question; "Quick" spreads
   `LADDER_TARGET_LENGTH` (8) tiers evenly across that range, always keeping
   the easiest and hardest endpoints.
3. For each selected tier, pick one unused question at random (`rng`
   injected for deterministic tests) and shuffle its choices (2-4 options —
   some sourced questions are True/False or 3-way, not always 4), recording
   `correctIndex`.

The ladder always runs in descending-difficulty order — unlike
`guess-antok-phrases`'s shuffled-together deck, tier order is the entire
point of this format, so it is never randomized.

Game phases are `lobby`, `question`, `reveal`, and `over`. A critical design
point (found via live Playwright testing during this build, not just unit
tests — see Validation and Changelog v1): **`resolveQuestion()` always
transitions to `reveal`, never straight to `over`**, even when every
remaining player got the question wrong together. The decision to end the
game is deferred to `advanceQuestion()`, which the Host triggers from the
reveal screen — that function checks the pending outcome computed by
`resolveQuestion()` (`room._pendingOver` / `room._pendingWinners`, internal
fields never sent over the wire) and either deals the next question or
transitions to `over` with the precomputed `winnerIds`. This guarantees the
correct answer is always shown before the game ends, matching how the real
show always reveals results before moving on — a full-wipeout ending was the
one path that skipped this in the first draft.

A question resolves when every still-alive player has answered
(`allAnswered()`) or the timer expires (`checkTimerExpired()`); not
answering counts as wrong, same as a wrong pick. Winners are anyone alive
after the last question in the built deck resolves — more than one player
can win together, matching the real show's format where the whole surviving
group attempts the final question and any correct answer splits the win.

## Networking

Adapted near-verbatim from `attack-attack/js/room.js` (full-participant
model, not Host+Display): the Host peer accepts connections from every other
player and exposes `broadcast`/`broadcastEach`/`close`; non-host clients get
a request/ack `send()` plus a `close()`. Room codes use the
`onepct-room-XXXX` PeerJS ID prefix (distinct from sibling games sharing the
same public broker) and a lookalike-free 4-character alphabet.

`js/main.js`'s `handleEvent()` is the single place game intents are
processed — called in-process for the Host's own actions, or via
`room.js`'s `onMessage` for a remote player's request — mirroring
`attack-attack`'s `callAction()`/`handleEvent()` split so there is exactly
one authority path regardless of which device triggered the action.

`toPublicState(room, viewerId, now)` redacts per viewer: a player's own
`choiceIndex` is included as `myChoice`, everyone else's is reduced to an
`answered` boolean. The current question's `correctIndex` is omitted
entirely while `phase === "question"`; it only becomes visible via
`lastResult` once a question has resolved into `reveal`.

## UI

Home picks a name and either creates or joins a room. Lobby shows the
roster, host-only ladder-length/timer settings, and a "reset question
history" control backed by `js/storage.js`. Question shows the tier badge
(styled distinctly when it's THE LINE), the question, four large tap
targets, a live countdown bar when a timer is set, and the roster with a
"locked in" indicator per player. An eliminated player sees the round play
out with an "you're eliminated" banner but no active choices. Reveal shows
the correct answer, a per-player right/wrong list, and a Host-only advance
button whose label depends on whether the next tap ends the game. Over
declares winners (or "no one cleared the line") and offers a Host-only
rematch.

## Validation

- `node --test tests/game.test.mjs` — 17 engine tests covering deck
  building (tier selection, dedupe, quick-vs-full spread), start/host
  gating, answer submission, timer expiry, wipeout vs. survival endings,
  ties, disconnect handling on rematch, and state redaction.
- Live two-browser Playwright smoke test against the real public PeerJS
  broker (not a mock): create room → join by code → both see the lobby
  roster → start → both see the question and tier badge → both answer →
  reveal shows the correct answer and results even on a full wipeout →
  Host-only advance → over screen shows the right outcome text → Play Again
  returns both devices to a shared lobby.
- A second live Playwright run verified the timer path specifically: a solo
  player who never answers still gets auto-resolved (as wrong) the instant
  the configured timer elapses, without any client-side action.

## Changelog

- **v1** (2026-07-18): Initial build. Ported the P2P full-participant room
  model from `attack-attack` and pure-engine/test-harness conventions from
  `guess-antok-phrases`. Found and fixed a real bug via live Playwright
  testing (not caught by the original unit tests, which only checked
  `room.phase` after `resolveQuestion()` in isolation): a full wipeout
  transitioned `resolveQuestion()` straight to `phase: "over"`, so the
  reveal screen — and the correct answer — was never shown to players who
  all got the last question wrong together. Refactored so
  `resolveQuestion()` always lands on `reveal` and stores a pending outcome;
  `advanceQuestion()` (Host-only, fired from the reveal screen) is now the
  only place `phase` becomes `over`. Updated the two affected unit tests to
  call `advanceQuestion()` before asserting `over`, and added `main.js`
  logic to relabel the Host's advance button ("Next question" vs. "See
  final results") based on the client-visible fields already in
  `toPublicState()` (no new field needed on the wire).
- **v2** (2026-07-18): Populated the real question bank via web research
  across UK/US recap sources (Yahoo, TV Guide, ScreenRant, Moviedelic,
  bobbymgsk.wordpress.com), 81 raw entries in `tools/raw-questions.json`,
  normalized by `tools/gen-questions.js` into 79 usable questions across 12
  distinct tiers (92 down to 1; 2 raw entries dropped for unmatchable
  answer/choice text). Two real data-quality problems were caught and fixed
  during normalization, not just by inspection:
  1. The real show is sometimes True/False or 3-way, not always 4-option —
     the research pass (correctly) returned questions with as few as 2
     choices. The engine originally hard-required exactly
     `CHOICES_PER_QUESTION = 4` in `submitAnswer()`; this was a design bug
     waiting to happen, not just a data-shape mismatch, so it was fixed at
     the engine level (validate against `currentQuestion(room).choices.length`
     per question, renamed the constant to `MAX_CHOICES_PER_QUESTION` for
     UI-sizing purposes only) rather than padding thin questions with a
     fabricated 4th option.
  2. One scraped choice's text ("The 0.5% Club (correct, same as Half a
     %)") leaked the correct answer directly inside a distractor's own
     label — the source article's own annotation, not something either
     research pass invented. `gen-questions.js` now strips a trailing
     parenthetical from **every** choice, not just from `answer` (which
     was already necessary anyway, to split explanatory asides like "V (all
     the given letters rhyme with…)" out of answer text) — surfaced as a
     new `explain` field threaded through `buildDeck()` → `resolveQuestion()`
     → `toPublicState()` and shown on the reveal screen, rather than
     discarded.
  The first research pass returned questions skewed almost entirely to the
  1-5% tier (the sources it drew from are literally titled "hardest
  questions ever"); a second pass was explicitly directed at full-episode
  recap articles to backfill the 60-95%/line range. Re-ran
  `node --test tests/game.test.mjs` (18/18, including a new test for
  sub-4-choice questions) and a fresh two-browser Playwright pass against
  the real bank (a genuine 2-choice "line" question from `js/questions.js`
  played correctly end-to-end).
