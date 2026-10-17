import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// Owns an isolated demo server; never touches real seat searches.
const port = 11019;
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;
async function startServer() {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore",
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Test server failed to start");
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Server readiness timeout");
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill("SIGKILL"); // Deliberately simulate process loss, including all server state.
  await exited;
}
async function waitSnapshot(id: string, matches: (s: { successfulChecks: number; status: string; attempts: number }) => boolean) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/monitor/${id}`);
      if (r.ok && matches(await r.json())) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Session did not recover within 40 seconds");
}
async function main() {
  await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.getByRole("button", { name: /체험해 보기/ }).click();
    await page.waitForFunction(() => !!localStorage.getItem("binjari-v1-session"));
    const id = await page.evaluate(() => localStorage.getItem("binjari-v1-session"));
    await stopServer();
    await startServer();
    await waitSnapshot(id!, s => s.successfulChecks > 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("binjari-v1-session")), id);
    await page.getByRole("button", { name: "확인했어요" }).click({ timeout: 12000 }).catch(() => {});
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    await page.getByRole("button", { name: "다시 시작", exact: true }).waitFor();
    await stopServer();
    await startServer();
    await waitSnapshot(id!, s => s.status === "paused" && s.attempts === 0);
    const response = await page.request.patch(`${base}/api/monitor/${id}`, { data: { action: "stop" } });
    assert.ok(response.ok(), `${response.status()}: ${await response.text()}`);
    await page.waitForFunction(() => !localStorage.getItem("binjari-v1-session"));
    await stopServer();
    await startServer();
    await page.reload();
    assert.equal((await page.request.get(`${base}/api/monitor/${id}`)).status(), 404);
    console.log("PASS: running session recovers after server process loss; pause survives recovery; stopped session stays stopped.");
  } finally {
    await browser.close();
    await stopServer();
  }
}
main().catch(async error => { console.error(error); await stopServer(); process.exit(1); });
