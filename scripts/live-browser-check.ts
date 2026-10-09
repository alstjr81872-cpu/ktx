import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { MonitorSnapshot } from "../lib/types";

// Opt-in real Korail traffic: three polling cycles, no login or reservation.
async function main() {
  const baseURL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let id: string | null = null;
  await mkdir("/tmp/binjari-check", { recursive: true });
  try {
    await page.goto(baseURL);
    await page
      .getByRole("group", { name: "조회 간격" })
      .getByRole("button", { name: "2초" })
      .click();
    const started = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/monitor") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "빈자리 탐색 시작", exact: true })
      .click();
    const response = await started;
    const start = await response.json();
    assert.equal(response.status(), 201, start.error);
    id = start.id;
    const deadline = Date.now() + 90000;
    let observed: MonitorSnapshot | null = null;
    while (Date.now() < deadline) {
      const stateResponse = await page.request.get(`${baseURL}/api/monitor/${id}`);
      assert.equal(stateResponse.status(), 200);
      observed = await stateResponse.json();
      if (observed?.error) throw new Error(observed.error);
      if (observed && observed.successfulChecks >= 3) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(observed && observed.successfulChecks >= 3, `Live checks did not complete: ${JSON.stringify(observed && {status: observed.status, attempts: observed.attempts, successfulChecks: observed.successfulChecks, error: observed.error})}`);
    const paused = await page.request.patch(`${baseURL}/api/monitor/${id}`, {
      data: { action: "pause" },
    });
    const result: MonitorSnapshot = await paused.json();
    assert.equal(result.error, null);
    assert.ok(result.successfulChecks >= 3);
    assert.equal(result.config.mode, "live");
    assert.equal(result.config.intervalSeconds, 2);
    assert.ok(
      result.trains.length > 0,
      "Expected real schedules for the default Seoul–Busan journey",
    );
    assert.ok(
      result.trains.every((t) => t.type === "KTX" && !t.id.startsWith("demo-")),
    );
    const hasAlerts = result.alerts.length > 0;
    if (hasAlerts) {
      await page.getByRole("dialog", { name: "빈자리를 찾았어요!" }).waitFor();
      assert.ok(
        await page
          .getByRole("dialog")
          .getByRole("link", { name: "코레일에서 예매하기" })
          .isVisible(),
      );
      await page.screenshot({
        path: "/tmp/binjari-check/live-alert.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "알림 닫기", exact: true })
        .click();
    }
    await page.getByText("탐색 일시정지", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByText("체험 모드 · 아래 열차와 좌석은 가상 정보예요.")
        .count(),
      0,
    );
    await page.screenshot({
      path: "/tmp/binjari-check/live-results.png",
      fullPage: true,
    });
    const evidence = {
      checkedAt: new Date().toISOString(),
      config: result.config,
      successfulChecks: result.successfulChecks,
      trainCount: result.trains.length,
      alertCount: result.alerts.length,
      popupVerified: hasAlerts,
      trains: result.trains,
    };
    await writeFile(
      "/tmp/binjari-check/live-result.json",
      JSON.stringify(evidence, null, 2),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        source: "korail-live",
        checks: result.successfulChecks,
        trainCount: result.trains.length,
        alerts: result.alerts.length,
        popupVerified: hasAlerts,
        date: result.config.date,
        intervalSeconds: 2,
      }),
    );
  } finally {
    if (id)
      await page.request
        .patch(`${baseURL}/api/monitor/${id}`, { data: { action: "stop" } })
        .catch(() => {});
    await context.close();
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
