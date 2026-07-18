// PeerJS networking for the 1% Club party edition, adapted from
// attack-attack's room.js. Every player here is a full peer that sends
// actions — there's no passive render-only role. This module is a plain
// transport, not game-aware: it knows nothing about `game.js`. The Host side
// hands incoming { event, payload } pairs to an `onMessage` callback and
// sends back whatever that callback returns as the ack; js/main.js is what
// actually calls into game.js and decides what to broadcast.

const ID_PREFIX = "onepct-room-"; // distinct from the sibling games' prefixes
// No lookalikes (0/O, 1/I/L) so codes survive being read aloud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ACK_TIMEOUT_MS = 10000;

function randomCode(len = 4) {
  let code = "";
  for (let i = 0; i < len; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function peerUnavailable() {
  return typeof window === "undefined" || typeof window.Peer !== "function";
}

// By default rooms use the free public PeerJS broker. `?broker=host:port`
// points at a self-hosted peerjs-server instead (also how we test offline).
function peerOptions() {
  const broker = new URLSearchParams(window.location.search).get("broker");
  if (!broker) return { debug: 0 };
  const [host, port] = broker.split(":");
  return {
    host,
    port: Number(port) || (window.location.protocol === "https:" ? 443 : 80),
    path: "/",
    secure: window.location.protocol === "https:",
    debug: 0,
  };
}

// Host a room. `onMessage(playerId, event, payload)` is called for every
// incoming request and its return value is sent back as that request's ack.
// `onPeerClose(playerId)` fires when a connection drops.
//
// Resolves to:
//   code
//   broadcast(event, payload)         — same unsolicited push to every peer
//   broadcastEach(event, payloadFor)  — a push computed per-recipient, via
//                                       payloadFor(playerId); use this for
//                                       anything that must differ by viewer
//                                       (e.g. a state snapshot that includes
//                                       that player's own pending answer but
//                                       omits everyone else's)
//   close()                    — tear down the room
export function hostRoom({ onMessage, onPeerClose, onError }, attempt = 0) {
  return new Promise((resolve, reject) => {
    if (peerUnavailable()) {
      reject(new Error("Room service failed to load. Check your connection and reload."));
      return;
    }
    const code = randomCode();
    const peer = new Peer(ID_PREFIX + code, peerOptions());
    const conns = new Map(); // playerId (conn.peer) -> conn
    let settled = false;

    peer.on("open", () => {
      settled = true;
      resolve({
        code,
        broadcast(event, payload) {
          const data = JSON.stringify({ event, payload });
          for (const conn of conns.values()) {
            if (conn.open) conn.send(data);
          }
        },
        broadcastEach(event, payloadFor) {
          for (const [playerId, conn] of conns.entries()) {
            if (conn.open) conn.send(JSON.stringify({ event, payload: payloadFor(playerId) }));
          }
        },
        close() {
          peer.destroy();
        },
      });
    });

    peer.on("connection", (conn) => {
      const playerId = conn.peer;
      conn.on("open", () => {
        conns.set(playerId, conn);
      });
      conn.on("data", (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return; // ignore malformed input from strangers
        }
        if (!msg || typeof msg.event !== "string") return;
        if (msg.event === "bye") {
          drop();
          return;
        }
        const res = onMessage(playerId, msg.event, msg.payload);
        if (conn.open) conn.send(JSON.stringify({ reqId: msg.reqId, res }));
      });
      const drop = () => {
        if (!conns.has(playerId)) return;
        conns.delete(playerId);
        onPeerClose(playerId);
      };
      conn.on("close", drop);
      conn.on("error", drop);
    });

    peer.on("error", (err) => {
      if (!settled && err.type === "unavailable-id" && attempt < 5) {
        // Code collision on the broker — roll a new one.
        peer.destroy();
        hostRoom({ onMessage, onPeerClose, onError }, attempt + 1).then(resolve, reject);
      } else if (!settled) {
        peer.destroy();
        reject(new Error("Could not reach the room service. A working room is required to play — see README."));
      } else {
        onError("Room connection lost. Reload this screen to reconnect.");
      }
    });
  });
}

// Join a room as a non-host player. `onPush(event, payload)` fires for every
// unsolicited broadcast from the Host (state, questionResult, roomClosed).
// `onClose(message)` fires when the connection ends.
//
// Resolves to:
//   id                                     this player's peer id
//   send(event, payload) -> Promise<res>   request/ack round trip to the Host
//   close()
export function joinRoom(code, { onPush, onClose }) {
  return new Promise((resolve, reject) => {
    if (peerUnavailable()) {
      reject(new Error("Room service failed to load. Check your connection and reload."));
      return;
    }
    const peer = new Peer(peerOptions());
    const pending = new Map(); // reqId -> { resolve, reject, timer }
    let settled = false;
    let reqSeq = 0;

    peer.on("open", () => {
      const conn = peer.connect(ID_PREFIX + normalizeCode(code), { reliable: true });
      conn.on("open", () => {
        settled = true;
        window.addEventListener("pagehide", () => {
          try { conn.send(JSON.stringify({ event: "bye" })); } catch { /* leaving anyway */ }
        });
        resolve({
          id: peer.id,
          send(event, payload) {
            return new Promise((res, rej) => {
              const reqId = ++reqSeq;
              const timer = setTimeout(() => {
                pending.delete(reqId);
                rej(new Error("The host didn't respond — check your connection and try again."));
              }, ACK_TIMEOUT_MS);
              pending.set(reqId, { resolve: res, reject: rej, timer });
              conn.send(JSON.stringify({ reqId, event, payload }));
            });
          },
          close() {
            peer.destroy();
          },
        });
      });
      conn.on("data", (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        if (msg && msg.reqId !== undefined && pending.has(msg.reqId)) {
          const { resolve: res, timer } = pending.get(msg.reqId);
          clearTimeout(timer);
          pending.delete(msg.reqId);
          res(msg.res);
        } else if (msg && typeof msg.event === "string") {
          onPush(msg.event, msg.payload);
        }
      });
      conn.on("close", () => {
        if (settled) onClose("The host closed the room.");
        peer.destroy();
      });
    });

    peer.on("error", (err) => {
      peer.destroy();
      if (settled) {
        onClose("Room connection lost.");
      } else if (err.type === "peer-unavailable") {
        reject(new Error(`No room found with code ${normalizeCode(code)}. Double-check it with the host.`));
      } else {
        reject(new Error("Could not reach the room service. Try again in a moment."));
      }
    });
  });
}
