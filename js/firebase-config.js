// Public Firebase client config for narabu's existing Firestore project --
// safe to commit/bake into the client bundle (this is the standard Firebase
// guidance: security is enforced by Firestore Security Rules, not by hiding
// this object). Reuses narabu's own project rather than a dedicated one for
// the Leader Board -- see specs/001-leader-board/plan.md.
//
// Sourced from narabu.gondoit.work's .env.local (explicitly labeled
// "PRODUCTION" there) and its .firebaserc default project, NOT its
// .env.production file -- that file's authDomain/projectId/storageBucket
// values ("narabu-reborn...") don't match any project this portfolio's
// authenticated Firebase CLI session can see (`firebase projects:list`
// only shows "narabu-500814"), so they're almost certainly stale from an
// earlier rename attempt. apiKey/messagingSenderId/appId are identical in
// both files either way.
export const firebaseConfig = {
  apiKey: 'AIzaSyCiSjaRLkqExvqllVj9IduxKqYW0xlPis8',
  authDomain: 'narabu-500814.firebaseapp.com',
  projectId: 'narabu-500814',
  storageBucket: 'narabu-500814.firebasestorage.app',
  messagingSenderId: '774434130225',
  appId: '1:774434130225:web:1d8eb9da215e900c444810',
};

// Top-level collection this project writes to/reads from -- kept separate
// from narabu's own events/responses/games collections in the same
// database.
export const LEADERBOARD_COLLECTION = 'leaderboardShows';
