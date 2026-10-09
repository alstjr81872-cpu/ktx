import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { KorailBridge, KorailBridgeError } from "../lib/korail-bridge";
const options = {
  python: "python3",
  script: path.join(process.cwd(), "tests/fixtures/korail-worker.py"),
  timeoutMs: 2000,
};
const params = (mode = "success") => new URLSearchParams({ mode });
const signal = () => new AbortController().signal;

test("the bridge preserves its worker between queries", async () => {
  const bridge = new KorailBridge(options);
  try {
    const first = (await bridge.request(params(), signal())) as {
      pid: number;
      count: number;
    };
    const second = (await bridge.request(params(), signal())) as {
      pid: number;
      count: number;
    };
    assert.equal(first.pid, second.pid);
    assert.equal(second.count, 2);
  } finally {
    bridge.close();
  }
});
test("aborting a request terminates it and a new request can reconnect", async () => {
  const bridge = new KorailBridge(options);
  const controller = new AbortController();
  try {
    const first = (await bridge.request(params(), signal())) as { pid: number };
    const pending = bridge.request(params("hang"), controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    const next = (await bridge.request(params(), signal())) as {
      pid: number;
      count: number;
    };
    assert.notEqual(first.pid, next.pid);
    assert.equal(next.count, 1);
  } finally {
    bridge.close();
  }
});
test("a stuck worker times out instead of keeping the search running indefinitely", async () => {
  const bridge = new KorailBridge({ ...options, timeoutMs: 150 });
  try {
    await assert.rejects(
      bridge.request(params("hang"), signal()),
      (e: unknown) =>
        e instanceof KorailBridgeError &&
        e.retryable &&
        e.message.includes("초과"),
    );
  } finally {
    bridge.close();
  }
});
test("worker exit and missing Python have actionable, distinct failure types", async () => {
  const bridge = new KorailBridge(options);
  try {
    await assert.rejects(
      bridge.request(params("crash"), signal()),
      (e: unknown) => e instanceof KorailBridgeError && e.retryable,
    );
  } finally {
    bridge.close();
  }
  const missing = new KorailBridge({
    ...options,
    python: "/definitely-missing/bin/python",
  });
  try {
    await assert.rejects(
      missing.request(params(), signal()),
      (e: unknown) =>
        e instanceof KorailBridgeError &&
        !e.retryable &&
        e.message.includes("setup:korail"),
    );
  } finally {
    missing.close();
  }
});
test("HTTP 403 from Korail is terminal", async () => {
  const bridge = new KorailBridge(options);
  try {
    await assert.rejects(
      bridge.request(params("blocked"), signal()),
      (e: unknown) => e instanceof KorailBridgeError && !e.retryable,
    );
  } finally {
    bridge.close();
  }
});
