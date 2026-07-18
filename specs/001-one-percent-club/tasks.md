# Tasks: 1% Club — Party Edition

## Phase 1 - Scaffold

- [x] Copy the proven P2P full-participant room structure from `attack-attack`
      (`js/room.js`), renaming the PeerJS ID prefix.
- [x] Copy the pure-rules-engine + `node --test` harness convention from
      `guess-antok-phrases`/`attack-attack`.
- [x] Set up `specs/001-one-percent-club/`, `LICENSE`, `.nojekyll`,
      `vendor/peerjs.min.js`.

## Phase 2 - Rules engine

- [x] `createRoom`, `addPlayer`, `renamePlayer`, `removePlayer` (lobby edits,
      mid-game leave marks eliminated + "left").
- [x] `buildDeck`: tier-descending deck construction, Quick vs Full ladder
      length, used-question exclusion, deterministic via injected `rng`.
- [x] `startGame`: host-only, builds the deck, resets player state, requires
      at least one fresh question.
- [x] `submitAnswer` / `allAnswered` / `checkTimerExpired`.
- [x] `resolveQuestion`: eliminate wrong/non-answers, always land on
      `reveal`, compute (but don't yet apply) the pending game-over outcome.
- [x] `advanceQuestion`: host-only, applies the pending outcome — next
      question or `over` with precomputed `winnerIds`.
- [x] `resetToLobby`: host-only rematch, drops players who left mid-game.
- [x] `toPublicState`: per-viewer redaction (own pending choice only, no
      correct-answer leak pre-reveal).

## Phase 3 - Networking + client

- [x] `js/room.js`: PeerJS hostRoom/joinRoom, full-participant (adapted from
      `attack-attack`, distinct ID prefix `onepct-room-`).
- [x] `js/main.js`: `handleEvent`/`callAction`/`broadcastState` host-authority
      split; screens for Home, Lobby, Question, Reveal, Over.
- [x] Countdown timer bar synced to the Host's clock via `hostNow` offset,
      auto-resolves on the Host when it elapses.
- [x] `js/storage.js`: saved name/settings, used-question-key dedupe with a
      Host-visible "reset question history" control.

## Phase 4 - Question bank

- [x] Research real/published *1% Club* questions (UK + US) with reported
      difficulty tiers via web search across multiple recap sources.
- [x] Normalize into `js/questions.js`'s `{ tier, q, a, d, source }` shape,
      inventing plausible distractors only where the source didn't report
      the show's own multiple-choice options (flagged during research).
- [x] Support optional local question images with required alt text through
      normalization, deck construction, public state, and reveal.
- [x] Add the sourced CAT + letter + LOG rebus as the first image-backed
      question with local SVG artwork.
- [x] Record sourcing/attribution in the README.

## Phase 5 - Styling

- [x] Shared dark/gold visual language with sibling games (`--gold`,
      `--panel`, `.btn-gold`, etc. from `attack-attack/css/style.css`).
- [x] Tier badge styling, distinct treatment for THE LINE.
- [x] Responsive, uncropped question artwork on question and reveal screens.
- [x] Countdown bar, question choice grid, reveal result rows, roster chips
      with "locked in" status.

## Phase 6 - Documentation

- [x] SDD spec, plan (including the reveal/over bug fix writeup), and this
      task list.
- [x] README with how-to-play, local dev, question-bank sourcing/disclaimer,
      and SDD links.

## Phase 7 - Validation

- [x] `node --test tests/game.test.mjs` (17/17 passing).
- [x] Live two-browser Playwright run over the real public PeerJS broker:
      full lobby → question → reveal → over → play-again loop, including a
      full-wipeout ending.
- [x] Live Playwright run of the timer-expiry auto-resolve path (solo
      player, no answer, timer elapses).
- [x] Found and fixed the wipeout/reveal-skip bug from the second-phase
      testing above (see plan.md Changelog v1); reran both the unit suite
      and both Playwright scripts to confirm the fix.

## Phase 8 - Fully automated Host (US-8, post-launch)

- [x] Decouple `hostId` from `players` in `game.js` (`createRoom(code,
      hostId)`); remove the now-dead host-reassignment branch in
      `removePlayer()`.
- [x] Add `revealAdvanceSeconds`/`revealStartedAt`/`checkRevealExpired()` to
      the engine, mirroring the existing question-timer pattern.
- [x] Home screen: "Run as a display only" checkbox; skip adding the Host as
      a player when checked, skip requiring a name.
- [x] Lobby: "After each reveal" select (manual/5s/8s/12s); lobby-wide hint
      when the Host isn't a player, derived from state, not a local flag.
- [x] Question/reveal screens: spectator banner + no answer buttons for a
      non-player viewer; reveal countdown bar + Host-side auto-advance timer
      that still goes through the same `advanceQuestion()` authority check.
- [x] Fix `main.js`'s `handlePeerClose` to stop tearing down the room when
      the player count hits zero (see plan.md Changelog v3 for why this was
      previously safe but became a real bug with a spectator Host).
- [x] 4 new engine tests (spectator Host start/play, spectator Host with
      zero players, manual vs. auto-advance reveal expiry). All 22 tests
      pass.
- [x] Live Playwright verification: manual/non-spectator regression check,
      and a combined spectator-Host + 5s-auto-advance run with two real
      players confirming zero taps were needed after Start.

## Phase 9 - Image-backed questions

- [x] Extend raw/generated question schemas with optional `image` and
      `imageAlt`, rejecting inaccessible image entries.
- [x] Preserve image metadata in dealt questions, open-question public state,
      and reveal summaries.
- [x] Render image questions accessibly without affecting text-only questions.
- [x] Add engine coverage for propagation and rerun the suite.

## Phase 10 - Internet-sourced bank expansion

- [x] Review current public episode guides and recaps for additional
      questions with reported tiers and answers.
- [x] Add 15 reproducible questions from 2025 US episode guides and 2026 US
      recaps; preserve reported choices and flag authored distractors.
- [x] Exclude image-only questions when recap text does not contain enough
      information to recreate the puzzle faithfully.
- [x] Regenerate the bank: 94 questions across 15 tiers; rerun all tests.
