# Implementation Plan: 1% Club — Party Edition

## Technical Context

| Area | Choice | Notes |
| --- | --- | --- |
| Runtime | Vanilla ES modules, HTML, CSS | Static GitHub Pages compatible, no build step. |
| Sync | PeerJS over WebRTC, full-participant model | Same pattern as `attack-attack`'s P2P conversion — every player is a peer, not just Host+Display. |
| State | Host-authoritative in memory | Non-host clients render whatever snapshot they last received. |
| Tests | `node --test` | Pure engine and local-storage tests in `tests/*.test.mjs`. |
| Manual validation | Playwright against a real PeerJS broker | See Validation section — two real browser contexts over live WebRTC, not mocked. |

## File Structure

```text
index.html               screens: Home, Lobby, Question, Reveal, Over
css/style.css             mobile-first styling, shared visual language with sibling games
js/game.js                pure rules engine
js/questions.js           question bank (tier, question, answers, optional image, source)
images/questions/         locally hosted question artwork
js/main.js                DOM rendering, host-authoritative event handling, P2P glue
js/room.js                PeerJS wrapper (full-participant, adapted from attack-attack)
js/storage.js             local settings + used-question dedupe
tests/*.test.mjs          engine behavior + local-storage tests
tools/gen-questions.js    normalizes researched raw question data into js/questions.js
specs/001-...             SDD spec, plan, tasks
vendor/peerjs.min.js      vendored PeerJS client
```

## Data Model

Each question in the pool (`js/questions.js`) is:

```js
{ tier: 92, q: "…", a: "Correct answer", d: ["Wrong 1", "Wrong 2"], image: "images/questions/example.svg", imageAlt: "…", source: "https://…" }
```

The real show is often free-response (contestants write an answer rather than
pick from a card), so where a source didn't report the on-screen multiple
choice options, three distractor answers were authored to match the answer's
format (same units/word type) — see `tools/gen-questions.js` and the
Changelog below for the sourcing pass. `tier` is the reported/estimated
percentage of the public who answered correctly; higher tier = easier.

`image` and `imageAlt` are optional as a pair. The generator rejects an
image-backed entry without alt text. Assets use local, site-relative paths,
so peers receive only stable path strings in public state and load the same
static files; text-only generated entries omit both fields.

## Rules Engine

`buildDeck(pool, questionCount, usedKeys, rng)` (in `js/game.js`) does the
deck construction:

1. Filter out any question whose `tier::q` key is in `usedKeys` (this
   device's play history — see `js/storage.js`).
2. Clamp the Host's requested count to 6–15 and spread tier slots evenly
   across the full available difficulty range, retaining the easiest and
   hardest endpoints.
3. Pick one random unused question per selected tier. If fewer distinct
   tiers remain than requested rounds, make additional evenly spread passes
   through tiers with unused candidates until the exact count is reached.
4. Sort the selected questions by tier descending, then shuffle each one's
   choices (2–4 options), recording `correctIndex`.

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

### Fixed hostId, spectator Host

`createRoom(code, hostId)` takes `hostId` explicitly and never changes it —
`addPlayer()` no longer assigns it. This decouples "who is authoritative"
from "who is a player," which is exactly what a spectator Host needs: the
Host device creating the room can choose whether to also call `addPlayer()`
for itself. If it doesn't, that device is still `room.hostId` (still the
only device `startGame`/`advanceQuestion`/`resetToLobby` will accept), it
just never appears in `players`, so it's automatically excluded from every
roster, `submitAnswer` call, results list, and winner list — no separate
"spectator" flag needed anywhere in the engine. Every client (not just the
Host's own) can detect a spectator Host the same way: `hostId` not present
in `players`. `js/main.js` uses that to show a lobby-wide hint, and uses
`!!me()` (whether *this* viewer's own id is in `players`) to decide whether
to render eliminated-banner-or-answer-buttons versus a spectator banner —
the same boolean the old "eliminated" check already computed, just no
longer assuming every viewer is necessarily a player at all.

One consequence: `removePlayer()`'s "room is now empty" return value is no
longer acted on destructively in `main.js` — with a spectator Host, the
player roster hitting zero is a normal state (an empty lobby waiting for
joins), not a signal to tear the room down. The Host's device is what owns
the room's lifetime; it ends only when that device's own tab/peer closes.

### Reveal auto-advance

`room.revealAdvanceSeconds` (0 = manual) and `room.revealStartedAt` (set by
`resolveQuestion()`, cleared by `advanceQuestion()`) mirror the existing
question-timer pattern exactly — `checkRevealExpired(room, now)` is a
straight copy of `checkTimerExpired()`'s shape for the reveal phase. This
symmetry means the client-side handling is symmetric too:
`renderReveal()` runs the same `requestAnimationFrame` countdown loop as
`renderQuestion()`'s question timer, and when it elapses on the Host's own
device, calls the same `advanceQuestion()` path a manual "Next question"
tap would — `maybeAutoAdvance()` mirrors `tryResolve()`. Because
`advanceQuestion()` still re-checks `byId === room.hostId` and
`room.phase === "reveal"` itself, auto-advance can't do anything a manual
tap couldn't; it's purely a client-side decision about *when* to call the
same authoritative function. The manual "Next question" button stays
visible and clickable even with auto-advance on, so the Host can skip the
pause early.

### Player rejoin

PeerJS connection ids are ephemeral, so they cannot serve as durable player
identity. After a successful join, `js/storage.js` stores a random capability
token under the room code. The Host retains the same token on the private
`Player` object. A later `joinRoom` intent presents the token and
`rejoinPlayer()` replaces the old peer id with the new connection id while
preserving the rest of the seat.

`toPublicState()` explicitly omits `resumeToken`; only `connected` is public
so the roster can mark an offline seat. `removePlayer()` now marks the seat
offline rather than deleting or immediately eliminating it. `allAnswered()`
waits only on connected alive players when at least one exists, so an offline
non-answer cannot hold the group indefinitely; `resolveQuestion()` still
includes every alive seat and therefore eliminates that missing answer. With
zero connected players and no timer, the question intentionally stays open
for rejoin. Starting a new ladder or rematch drops seats still offline.

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
"locked in" indicator per player. Optional question artwork appears between
the prompt and choices with responsive, contained sizing, and is repeated on
the reveal screen to preserve context. An eliminated player sees the round play
out with an "you're eliminated" banner but no active choices. Reveal shows
the correct answer, a per-player right/wrong list, and a Host-only advance
button whose label depends on whether the next tap ends the game. Over
declares winners (or "no one cleared the line") and offers a Host-only
rematch.

## Validation

- `node --test tests/*.test.mjs` — engine and storage tests covering deck
  building, authority, answer/timer flow, endings, rejoin identity/privacy,
  disconnect resolution, room-scoped persistence, and state redaction.
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

- **v7** (2026-07-18): Replaced Quick/Full with an explicit 6–15 questions
  setting, defaulting to the full 15-round ladder. Deck building now returns
  the requested count whenever enough fresh questions remain, even if prior
  play has exhausted an entire tier, by making evenly spread extra passes
  through tiers before sorting the final deck easiest-to-hardest.

- **v6** (2026-07-18): Added same-browser player rejoin. A private per-room
  token in `localStorage` lets a new PeerJS connection reclaim its Host-side
  seat while preserving eligibility and locked answers. Offline status is
  visible but the token is never broadcast. Disconnect-aware resolution and
  rematch cleanup prevent abandoned seats from stalling active players.

- **v5** (2026-07-18): Expanded the bank from 79 questions across 12 tiers
  to 94 questions across 15 tiers using 2025 US episode guides and 2026 US
  recap sources. Added 15 questions with directly reported answers and
  difficulty percentages; retained reported answer choices when available
  and marked authored multiple-choice distractors in the raw data. Visual
  questions whose complete layouts could not be reconstructed accurately
  from the recap text were deliberately not imported.

- **v4** (2026-07-18): Added optional image-backed questions end to end.
  `tools/gen-questions.js` now accepts `image`/`imageAlt` and rejects artwork
  without an accessible description; `buildDeck()`, open-question public
  state, and reveal summaries preserve those fields. Both play and reveal
  screens render the same contained responsive image and remove the element's
  `src` for text-only questions. Added the sourced CAT + letter + LOG puzzle
  with locally hosted SVG artwork and engine coverage for image propagation.

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
- **v3** (2026-07-18): Added US-8, a fully automated Host — a spectator Host
  role (Home screen checkbox, "Run as a display only") and a configurable
  reveal auto-advance (manual/5s/8s/12s), independently combinable so a
  whole game can run from one initial "Start" tap. Required decoupling
  `hostId` from `players` in `game.js` (see Rules Engine section above);
  this also fixed a latent issue that would otherwise have surfaced with a
  spectator Host — `main.js`'s `handlePeerClose` used to tear the whole
  room down whenever `removePlayer()` reported zero players left, which
  used to be effectively unreachable (the Host was always counted as a
  player, so that count could never legitimately hit zero while the Host's
  own device was still running) but would have wrongly killed a spectator
  Host's room the moment the last real player disconnected from an
  otherwise-idle lobby. All 22 tests pass (4 new: spectator-Host start/play,
  spectator-Host-with-zero-players still requires a player, and both
  manual/auto-advance reveal-expiry cases). Verified live with two
  Playwright passes: (1) manual mode, non-spectator — confirmed unchanged
  from v1/v2 behavior; (2) spectator Host + 5s auto-advance with two real
  players — Host correctly excluded from the lobby roster and from
  answering, saw a "running the game" banner instead of choice buttons, and
  the game advanced from reveal to the correct next phase (a wipeout ending,
  in that run) with zero taps after Start.
