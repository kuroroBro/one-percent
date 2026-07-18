# Feature Specification: 1% Club — Party Edition

**Feature branch**: `001-one-percent-club`
**Status**: Draft
**Created**: 2026-07-18

## Overview

1% Club (Party Edition) is a browser-only elimination trivia game inspired by
the TV format *The 1% Club*: every player answers the same multiple-choice logic
question at once, in secret. Each question is labeled with the percentage of
the public who supposedly answered it correctly when it was surveyed. The
opening question is **the line**, usually the easiest on the ladder. Answer
wrong — or don't answer before the timer runs out — and you're eliminated.
Whoever is still standing when the ladder runs out has reached the 1%.

Unlike the Host+Display sibling games (`guess-antok-phrases`), and like
`attack-attack`'s P2P conversion, players are full participants on their own
devices, not passive render-only Displays. One player's device becomes the
room's authoritative Host. By default the Host also plays, but the Host can
instead create the room as a spectator ("run as a display only") — see US-8
— and choose to have the game auto-advance through reveals without any taps
at all, so the whole ladder can run hands-off once started.

This is an unofficial, non-commercial fan project. It is not affiliated with
or endorsed by ITV Studios, Lee Mack, Fox, or any 1% Club rights holder — see
`README.md` for the sourcing/attribution note on the question bank.

## User Stories

### US-1: Create or join a room
As a player, I want to create a room or join one with a 4-character code, so
my group can play together from our own phones.

Acceptance criteria:
- Creating a room picks a free room code and opens a lobby; the creator is
  the Host and first player.
- Joining requires a name (unique in the room, 1–20 chars) and enters the
  same lobby.
- Up to `MAX_PLAYERS` (12) players per room.
- If the room code doesn't resolve to a reachable Host peer, joining fails
  with a plain-language error.

### US-2: Configure and start the ladder
As the Host, I want to choose how long the ladder is and how much time each
question gets, so the session fits my group and how much time we have.

Acceptance criteria:
- The Host picks an exact question count from 6 through 15 (default 15) and
  a per-question timer (off, 20s, 30s, 45s, or 60s) before starting.
- When enough fresh questions exist, the dealt deck matches that count and
  is ordered from the easiest reported percentage to the hardest. Questions
  are spread across the full available difficulty range; multiple questions
  from a tier are allowed when fewer distinct tiers remain than the selected
  count.
- Starting requires at least one player (solo ladder attempts are allowed).
- The deck is built from questions not already used on this device in a
  previous game (see US-6); if none remain, starting fails with a clear
  error and a way to reset the question history.
- Non-host players see a waiting hint instead of the start control.

### US-3: Answer a question
As a player, I want to pick one of four answers in secret and see whether
everyone else has locked in, so no one can copy an answer mid-round.

Acceptance criteria:
- The current question shows its difficulty tier (and is marked **THE LINE**
  if it's the first question), the question text, and its choices (2-4
  options depending on the question).
- Other players' chosen answer is never visible before the question
  resolves — only whether they've locked in yet.
- After submitting, a player continues to see their own chosen button
  highlighted and explicitly labeled as their locked answer.
- A question resolves the instant every connected player has answered
  (including already-eliminated ones — see below), or when the timer runs
  out (whichever comes first). Not answering in time counts as wrong.
- An eliminated player keeps answering every remaining question exactly
  like everyone else — elimination only removes future win eligibility, it
  never stops a player from participating in the rest of the ladder. Once a
  player is eliminated they can never become eligible to win again, even if
  every subsequent answer is correct.

### US-4: See the result and keep going
As a player, I want to see the correct answer and who got it right before
the ladder continues, so eliminations feel earned, not sudden.

Acceptance criteria:
- Resolving a question **always** shows a reveal screen with the correct
  answer and every connected player's pick — including already-eliminated
  players who answered along with everyone else — even when every player
  still eligible to win got it wrong together (a full wipeout) — the game
  never jumps straight to a result screen without showing the answer first.
- Each contestant's submitted answer is visually separated from their name
  as a prominent green or red answer badge; a timeout shows "no answer."
  A player who was already ineligible to win going into this question is
  marked distinctly in the results list, since their answer no longer
  affects who can still win.
- Only the Host can advance from the reveal screen. Advancing either deals
  the next question, or — if every player eligible to win just fell off
  together, or that was the last tier in the ladder — ends the game.
- The Host's advance button is labeled differently depending on which of
  those two outcomes is coming next.

### US-5: End of the ladder
As a group, we want a clear result: who (if anyone) reached the 1%.

Acceptance criteria:
- If every player still eligible to win is eliminated on the same question,
  the game ends immediately with no winner — even if some already-eliminated
  players also answered that question alongside them.
- If at least one player is still eligible to win after the final question
  in the built ladder resolves, every eligible player is a winner — ties are
  allowed; the win is not exclusive to a single player.
- The Host can start a rematch ("Play again") that returns to the lobby with
  the same players (anyone who disconnected mid-game is dropped), a fresh
  join-editable roster, and a newly built deck.

### US-6: Don't repeat questions on the same device
As a returning player, I want a fresh set of questions each time I host, so
repeat games don't reuse the exact same ladder.

Acceptance criteria:
- Each question used in a built deck is recorded in this device's local
  storage and excluded from future decks built on that device.
- The Host can clear that history from the lobby to bring the full bank back
  into rotation.
- This is a per-device convenience, not cross-device sync — there is no
  account system.

### US-7: Disconnect handling
As a player, I want the game to keep working sensibly if someone's
connection drops, so one dropped phone doesn't stall the room.

Acceptance criteria:
- Leaving during the lobby removes that seat entirely.
- Leaving mid-game marks that player eliminated (seat stays visible, marked
  "left") rather than removing them.
- A question can't wait forever on a player who is gone — if a disconnect
  leaves every remaining connected player answered, resolution proceeds
  (whether or not those remaining players are still eligible to win).
- If the Host disconnects, the room cannot continue — same accepted
  limitation as `attack-attack`'s P2P model.

### US-8: Fully automated Host

As a Host, I want to run the game as a hands-off shared display instead of
playing, and have the ladder advance itself between questions, so a group
can play without anyone managing the pace.

Acceptance criteria:
- On the Home screen, the room creator can check "Run as a display only — I
  won't play" before creating a room. That device becomes the room's Host
  (still authoritative — still the only device that can start the game,
  advance the ladder, or trigger a rematch) without being added as a player:
  it never answers questions and never appears in any roster, results list,
  or winner list.
- A spectator Host does not need to enter a name.
- Everyone in the lobby (not just the Host) can see that the Host is running
  the room as a display rather than playing.
- The Host can leave "Run as a display" unchecked to play normally, exactly
  as before this feature — this is opt-in, not a behavior change to the
  default flow.
- Independently of spectator mode, the Host picks how the reveal screen
  advances: **manual** (default — a Host tap is required, as today) or
  **auto-advance** after a configurable pause (5, 8, or 12 seconds) once a
  question resolves. Auto-advance applies to every reveal in that game,
  including the one that ends the game (a wipeout or the final tier) — the
  Host's device still performs that transition, just on a timer instead of a
  tap, so `advanceQuestion`'s host-only authority check is unchanged.
- A Host using auto-advance can still tap "Next question" early if they want
  to skip the pause.
- Combining both settings (spectator Host + auto-advance) lets an entire
  game run from start to a single initial tap with no further manual
  intervention, once at least one other player has joined and the Host taps
  Start.

### US-9: Rejoin a player seat

As a player, I want to return to the same seat after refreshing, closing the
tab, or briefly losing my connection, so I can continue the current game.

Acceptance criteria:
- After a successful join, the browser stores a private, unguessable rejoin
  token and player name for that room code in `localStorage`.
- Reloading the room URL automatically rejoins; manually joining the same
  room from that browser also reclaims the existing seat, even though PeerJS
  assigns the new connection a different peer id.
- Rejoining preserves the seat's alive/eliminated status and any answer that
  was already locked in; it never revives an eliminated player.
- The rejoin token remains Host-private and is never included in public room
  state. A visible player name alone cannot reclaim a seat.
- Offline seats remain visible. If at least one connected player remains,
  offline unanswered seats do not block question resolution and count as
  wrong when the question resolves. If nobody remains connected and no timer
  is active, the question waits for someone to rejoin.
- A rematch drops seats that are still offline. The Host itself cannot resume
  after closing because its in-memory room is the authority and no backend
  exists.

## Functional Requirements

- **FR-1** Static site only: must run from GitHub Pages (no backend, no
  build step required to serve).
- **FR-2** Game logic stays a pure, testable module (`js/game.js`) with no
  DOM or network code.
- **FR-3** Host-authoritative networking over PeerJS: only the Host mutates
  room state; every other player's client sends intents and renders
  whatever snapshot it last received.
- **FR-4** No secret field is ever broadcast to non-Host clients before it's
  supposed to be public: another player's pending answer choice, and a
  question's correct-answer index while that question is still open, are
  both excluded from every outbound message until the question resolves.
- **FR-5** No ads, no analytics, no tracking, no accounts, no real-money
  stakes.
- **FR-6** A question may include an optional locally hosted image. The same
  image is visible while answering and on reveal, scales without cropping,
  and has meaningful alt text. Text-only questions show no placeholder.
- **FR-7** Player reconnection uses a per-room capability token persisted in
  `localStorage`; tokens must not be broadcast by `toPublicState()`.

## Key Entities

- **QuestionEntry** (source pool, `js/questions.js`): `tier` (difficulty
  percentage, 1–99), `q` (question text), `a` (correct answer text), `d`
  (array of 1–3 distractor answer texts — some real questions are True/False
  or 3-way, not always 4-option), optional `explain` (a short logic
  explanation shown on the reveal screen), optional `source` (attribution
  URL), and optional `image` plus `imageAlt` (site-relative asset path and
  accessible description; `imageAlt` is required when `image` is set).
- **DeckEntry**: one `QuestionEntry` resolved into a dealt question — `tier`,
  `question`, `choices` (2–4 texts, shuffled), `correctIndex`, `explain`,
  `image`, `imageAlt`, `key` (dedupe key), `source`.
- **Player**: `id`, `name`, `alive`, `left`, `connected`, private
  `resumeToken`, and `choiceIndex` (pending answer, hidden from everyone but
  that player pre-reveal).
- **Room**: `code`, `phase` (`lobby` \| `question` \| `reveal` \| `over`),
  `hostId` (fixed at creation, independent of `players` — see US-8),
  `players`, `deck`, `qIndex`, `timerSeconds`, `questionCount`,
  `revealAdvanceSeconds`, `revealStartedAt`, `lastResult`, `winnerIds`.

## Non-goals

- No free-text answer input — every question is multiple choice (2-4
  options), even where the original show used a free-response format (see
  plan.md Data Model for how distractors were sourced).
- No dedicated big-screen Display *layout* — the spectator Host (US-8) reuses
  the same phone-sized screens as everyone else rather than a TV-optimized
  view; it's an opt-in Host role, not a second app surface like
  `guess-antok-phrases`'s Display.
- No real-money or points-based scoring — outcome is binary per game
  (reached the 1% or didn't).
- No remote or player-uploaded images — artwork is curated with the question
  bank and served as a local static asset.
- No Host reconnection or cross-device player resume — the room lives only
  in the Host's memory, and a player's rejoin token is local to one browser.
