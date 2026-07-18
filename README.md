# 1% Club — Party Edition

Answer wrong, you're out. Answer right, the questions only get harder.

An unofficial, fan-made, ad-free party trivia game inspired by the TV format
*The 1% Club* (UK, hosted by Lee Mack on ITV; also a US Fox version). Every
question is labeled with the percentage of the public who reportedly
answered it correctly — the ladder starts near 90%+ ("the line") and climbs
down toward 1%. Runs entirely in the browser, peer-to-peer over WebRTC — no
backend, no build step, no accounts.

**Not affiliated with or endorsed by ITV Studios, Lee Mack, Fox, or any 1%
Club rights holder.** This is a personal, non-commercial project for playing
with friends. See "Question bank" below for sourcing notes.

## How to play

1. **Create a room** — pick a name, tap **Create a room**, and share the
   4-letter code (or the copied invite link) with your group.
2. **Everyone joins** on their own phone with the same code.
3. The Host picks a **ladder length** (Quick spreads across the available
   tiers; Full plays every tier that still has a fresh question) and a
   **timer per question**, then taps **Start the ladder**.
4. Everyone answers the same multiple-choice question (2-4 options, some are
   even True/False) at once, in secret — you can see who's "locked in" but
   not what they picked.
5. When everyone's answered (or the timer runs out), the answer is revealed
   along with everyone's pick. Answer wrong, or don't answer in time, and
   you're eliminated — but you stick around to watch the rest of the game.
6. Only the Host can advance past the reveal screen. If your whole group
   gets a question wrong together, the game ends right there with no
   winner. Survive every question in the ladder and you've reached the 1% —
   more than one player can clear it together.
7. **Play again** puts everyone back in the same lobby with a freshly built
   ladder (this device won't reuse a question it's already dealt until you
   reset its history from the lobby).

The Host plays too — there's no separate "big screen" spectator mode in this
version, just everyone on their own device.

## Question bank

79 questions across 12 difficulty tiers (from THE LINE at ~92% down to 1%),
adapted from publicly reported episode recaps of *The 1% Club* (UK and US),
each tagged with the difficulty percentage as reported by the source. The
real show is often free-response and not always 4-option (True/False and
3-way questions do occur); where a source didn't report the on-screen
options, distractor answers were authored to match the real answer's
format. Some questions carry a short logic explanation shown on the reveal
screen. Visual/diagram-based questions were excluded — this is a text-only
game. See `js/questions.js` for the per-question `source` field,
`tools/gen-questions.js`/`tools/raw-questions.json` for the sourcing
pipeline, and `specs/001-one-percent-club/plan.md`'s Data Model section and
Changelog for the full methodology (including two data-quality bugs caught
and fixed while building this).

If you believe a question shouldn't be reproduced here, open an issue and it
will be removed.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
node --test tests/game.test.mjs
```

## Design docs (SDD)

This project was built spec-first. See
[`specs/001-one-percent-club/`](specs/001-one-percent-club/):
[spec.md](specs/001-one-percent-club/spec.md),
[plan.md](specs/001-one-percent-club/plan.md), and
[tasks.md](specs/001-one-percent-club/tasks.md).
