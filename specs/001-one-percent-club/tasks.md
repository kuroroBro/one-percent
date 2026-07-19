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
- [x] `buildDeck`: tier-descending deck construction, configurable question
      count, used-question exclusion, deterministic via injected `rng`.
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

## Phase 11 - Player rejoin

- [x] Persist a private per-room rejoin token and player name in
      `localStorage` with malformed-storage tolerance.
- [x] Rebind a returning browser's new PeerJS id to its existing Host-side
      seat without exposing the token in public state.
- [x] Preserve alive/eliminated and locked-answer state across rejoin; mark
      disconnected seats offline in the roster.
- [x] Let connected players resolve without an offline unanswered player;
      drop seats still offline when starting/rematching.
- [x] Add engine and storage tests for token rejoin, privacy, independent
      room sessions, and disconnect resolution.

## Phase 12 - Configurable 6–15 round ladder

- [x] Replace Quick/Full with a Host setting for 6 through 15 questions;
      default to 15.
- [x] Build exactly the requested number when enough fresh questions exist,
      including after an entire difficulty tier has been exhausted.
- [x] Keep every dealt deck sorted from easiest reported tier to hardest and
      spread selections across the full available range.
- [x] Add coverage for six-round and fifteen-round multi-question-tier decks.

## Phase 13 - Submitted-answer highlighting

- [x] Keep the current player's submitted choice highlighted after lock-in
      and label it as "Your locked answer."
- [x] Render every contestant's revealed answer as a distinct green/red
      badge, including "no answer" for a timeout.

## Phase 14 - Image bank expansion

- [x] Research real 1% Club visual puzzles (UK/AU) with source detail
      precise enough (exact shapes, positions, colors, text) to redraw
      faithfully without referencing the original broadcast footage.
- [x] Recreate 11 as original local artwork: 10 hand-authored SVG diagrams
      (position-code grid, dice-roll board, matchstick digits, binary-tree
      rebus, glass-cube rebus, colour-chain loop, four-square star, circular
      maze, pinwheel-tile floor, football-score rebus) plus one AI-generated
      raster illustration (foil balloon numerals, via the `image-gen`
      Codex skill — the one candidate that genuinely benefits from rendered
      art over a flat diagram) downscaled and re-encoded as JPEG.
- [x] Visually QA every new SVG via headless-browser screenshot before
      wiring it in; caught and fixed two real bugs this way (a title
      overflowing its canvas on two images, and bottom-row connector arrows
      in the colour-chain diagram spanning clean through unrelated boxes
      instead of stopping at the adjacent one).
- [x] Append all 11 to `tools/raw-questions.json` and regenerate — 105
      questions across 17 tiers, 12 now image-backed.
- [x] Verify live in the real app: full lobby → question → reveal flow
      renders a new image correctly sized on both screens; confirmed the
      JPEG loads with correct dimensions via a direct `<img>` check.
- [x] `node --test` (32/32); update README's question-bank counts and
      artwork-sourcing description.

## Phase 15 - Fix image clustering at the start of the ladder

- [x] Diagnose a real player-reported bug ("all image questions come
      first"): tiers 90% and 40% each had exactly one question total, and
      both happened to be the newly-added image puzzle — since the deck is
      always dealt difficulty-descending, those tiers landed at fixed,
      predictable early-ish ladder positions in nearly every game,
      guaranteed to be an image every time. Confirmed via a script auditing
      every tier's image/total ratio, then a 500-game deck-build simulation
      showing image sightings concentrated in the ladder's first half.
- [x] Research and add 11 real text-only questions at the 85-95%, 35-45%
      tiers to dilute the two singleton tiers (and their thin neighbors) so
      no tier is 100% image-only anymore.
- [x] Research and add 5 more real image questions at the harder 5-25%
      tiers (seven-segment digits, suit-symbol count, symbol-row symmetry,
      Poggendorff illusion, three-circle Venn diagram) as new hand-authored
      SVGs, to correct the easy/hard skew rather than just diluting it.
- [x] Re-verify visually via headless-browser `<img>` rendering (not
      standalone file viewing, which distorts SVGs with no explicit
      width/height); confirmed the Venn diagram's word placements are
      mathematically inside/outside the correct circles.
- [x] Re-ran the 500-game simulation after the fix: zero tiers are 100%
      image, and image sightings now hit nearly every ladder position
      (2 through 15) with more weight in the second half than the first —
      the reverse of the original bug. Bank is now 120 questions across 17
      tiers, 17 image-backed. `node --test` 32/32.

## Phase 16 - Home screen hero and portfolio back-link

- [x] Generate a cinematic game-show stage hero image (`image-gen` skill →
      Codex `image_gen`) matching the game's own dark navy/gold palette —
      spotlit podium, silhouetted contestants, no text/logos/faces (avoids
      any resemblance to the real show's actual set). Downscaled and
      re-encoded as JPEG (1.6MB → 156KB).
- [x] Wire it into `#screen-home` only via `body:has(#screen-home:not
      (.hidden))`, same technique as `attack-attack`'s and
      `guess-antok-phrases`' home hero images — gradient overlay into
      `--bg` for text legibility, other screens keep the plain radial
      gradient.
- [x] Add a "← GONAPPS" back-link to `https://gondoit.work/`, adapted from
      `gondoit.work/mapcode`'s same-pattern back-link but restyled to this
      game's own palette. Placed inside `#screen-home` itself (not a
      separate visibility rule) so it naturally shows only on the home
      screen and disappears during actual gameplay.
- [x] Verified live: hero renders correctly with legible text on the home
      screen, reverts to the plain gradient with no stray link on every
      other screen (checked via the lobby). `node --test` still 32/32.

## Phase 17 - Maze fix + 25-question bank expansion

- [x] Fixed a real reported bug in the circular maze image: the concentric
      rings were drawn as fully closed circles with no actual openings, so
      no route from any labeled point ever reached the center — rebuilt
      with explicit color-coded dotted routes (A/C/D visibly reach the
      GOAL, B visibly stops at a drawn dead-end wall) instead of relying on
      inferred ring-gap connectivity.
- [x] Checked a large 16-episode UK Season 4 question compilation for
      content not already in the bank; a first attempt via a background
      research agent hit an account-level session limit mid-task, so the
      episodes were instead fetched directly (4 episodes per fetch, 4
      fetches) and reviewed by hand.
- [x] Verified each candidate's stated logic independently before adding it
      (recomputed the math/wordplay from scratch) and dropped anything with
      ambiguous mechanics, a scenario missing key details, or dependence on
      exact source text (headline wording, tongue-twister text, underlined
      letters) that couldn't be reproduced reliably — quality/confidence
      bar over quantity, consistent with prior research passes.
- [x] Added 25 new text-only questions spread across tiers 80 down to 5
      (no new images — the bank already has good image coverage from
      Phases 9/14/15). Bank is now 145 questions across 17 tiers, still 0
      tiers at 100% image. `node --test` 32/32.

## Phase 18 - Maze image: three recreation attempts, then removed

- [x] After the Phase 17 rebuild, the reporter shared a reference photo of
      the real puzzle's maze graphic and asked to use it directly (with a
      corner icon cropped out). Declined: this project's images are
      original recreations only, never screenshots or lightly-edited
      copies of someone else's graphic (a rule held across all prior
      images, and the photo's origin/copyright status wasn't known) —
      minor edits like cropping a watermark don't change that it's still
      someone else's file.
      Attempted one more from-scratch original recreation using the photo
      only as a structural/style reference (positions, colors, general
      "thick black walls, red letter badges, blue arrows" look), built as
      a directly-authored carved-tunnel design so correctness didn't
      depend on inferred wall-gap geometry — still not judged an accurate
      enough match.
- [x] Given three attempts without a satisfying result, removed the maze
      question and `circle-maze.svg` entirely rather than continue
      guessing. Bank is now 144 questions across 17 tiers, 16 image-backed,
      still 0 tiers at 100% image (tier 90 has 4 remaining). `node --test`
      32/32.

## Phase 19 - Eliminated players keep answering, but can never win

- [x] Reworked elimination semantics: `alive` now means "still eligible to
      win," not "still allowed to answer." `submitAnswer()` no longer
      rejects eliminated players; a new `activePlayers()` (everyone ever
      added to the room, connected or not — mirrors how `alivePlayers()`
      always worked) replaces `alivePlayers()` as the "who must answer this
      round" set in `allAnswered()` and as the scored `actors` in
      `resolveQuestion()`.
- [x] Confirmed by construction (the flip is a straight-line `if
      (!correct) p.alive = false`, never set back to true) that a wrong
      answer is permanent and an eliminated player answering correctly
      later never restores eligibility.
- [x] Kept the wipeout-ends-the-game rule exactly as before, but re-scoped
      to *eligible* players: the game only ends early when
      `alivePlayers(room).length === 0` after resolving, which now
      correctly ignores whatever already-eliminated players also answered
      that same question — verified with a dedicated test where an
      eliminated player answers correctly on the same question that wipes
      out the last eligible player, and the wipeout still fires.
- [x] UI: eliminated players keep full, enabled answer buttons and a
      roster "locked in / thinking…" status (previously gated behind
      `alive`); the elimination banner copy changed from "watch the rest
      play it out" to "not eligible to win anymore — but keep answering!";
      the reveal results list marks already-ineligible respondents
      distinctly so it's clear their answer no longer affects standings.
- [x] First pass introduced a real bug: a new `activePlayers()` filtered on
      `!p.left`, but `removePlayer()`/`rejoinPlayer()` toggle `left` and
      `connected` together, so once every seat went offline the "resolve
      using already-locked-in answers" fallback saw an empty set instead
      of the frozen roster it needs — caught by the existing disconnect
      test suite, fixed by making `activePlayers()` unfiltered (matching
      how `alivePlayers()` always behaved structurally).
- [x] Added 2 new engine tests (permanent ineligibility despite later
      correct answers; wipeout judged only by eligible players even when
      an eliminated player answers the same question) plus rewrote the
      "eliminated players are rejected" test into "eliminated players keep
      answering." All 34 tests pass. Verified live: an eliminated player's
      buttons stay enabled, they can lock in an answer, and the roster/
      reveal reflect their ineligibility correctly.
- [x] Added a lobby QR code that encodes only the public `?room=CODE` invite
      URL, with scan guidance and accessible alt text. Private rejoin tokens
      remain in local storage and are never included in the QR payload.
