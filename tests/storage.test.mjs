import test from "node:test";
import assert from "node:assert";
import { loadPlayerSession, savePlayerSession } from "../js/storage.js";

const store = new Map();

global.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
};

test.beforeEach(() => store.clear());

test("player sessions persist a private token per normalized room code", () => {
  savePlayerSession("ab12", { resumeToken: "secret-token", name: "Ana" });
  assert.deepStrictEqual(loadPlayerSession("AB12"), {
    resumeToken: "secret-token",
    name: "Ana",
  });
});

test("different rooms retain independent player sessions", () => {
  savePlayerSession("AAAA", { resumeToken: "token-a", name: "Ana" });
  savePlayerSession("BBBB", { resumeToken: "token-b", name: "Ben" });
  assert.strictEqual(loadPlayerSession("AAAA").resumeToken, "token-a");
  assert.strictEqual(loadPlayerSession("BBBB").resumeToken, "token-b");
});

test("malformed or incomplete saved session data is ignored", () => {
  localStorage.setItem("onePercentClub.playerSessions.v1", JSON.stringify({ TEST: { name: "Ana" } }));
  assert.strictEqual(loadPlayerSession("TEST"), null);
});
