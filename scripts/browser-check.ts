import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
  page.on("pageerror", (error) => errors.push(error.message));
  let sessionId: string | null = null;
  await mkdir("/tmp/binjari-check", { recursive: true });
  try {
    await page.goto(baseURL);
    await page.getByRole("heading", { name: /매진이어도/ }).waitFor();
    await page.screenshot({
      path: "/tmp/binjari-check/desktop.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole("button", { name: "출발역과 도착역 바꾸기" }).click();
    assert.equal(
      await page.getByRole("combobox", { name: "출발역" }).inputValue(),
      "부산",
    );
    await page.getByRole("button", { name: "출발역과 도착역 바꾸기" }).click();
    await page.getByRole("combobox", { name: "출발역" }).fill("ㅅㅇ");
    await page.getByRole("option", { name: "서울", exact: true }).click();
    await page.getByRole("button", { name: /^오후/ }).click();
    assert.equal(
      await page.locator('input[aria-label="시작 시간"]').inputValue(),
      "12:00",
    );
    await page.locator('input[aria-label="시작 시간"]').fill("08:00");
    await page.locator('input[aria-label="종료 시간"]').fill("11:00");
    await page
      .getByRole("group", { name: "조회 간격" })
      .getByRole("button", { name: "2초" })
      .click();
    await page.getByRole("button", { name: "소리 테스트" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "알림음을 재생" })
      .waitFor();
    await page.getByRole("button", { name: /체험해 보기/ }).click();
    await page
      .getByText("체험 모드 · 아래 열차와 좌석은 가상 정보예요.")
      .waitFor();
    sessionId = await page.evaluate(() =>
      localStorage.getItem("binjari-v1-session"),
    );
    assert.ok(sessionId);
    await page
      .getByRole("dialog", { name: "이렇게 알려드려요!" })
      .waitFor({ timeout: 15000 });
    await page.screenshot({
      path: "/tmp/binjari-check/alert.png",
      fullPage: true,
    });
    assert.ok(
      await page.getByRole("dialog").getByText("일반실 좌석 발견").isVisible(),
    );
    await page.getByRole("button", { name: "확인했어요" }).click();
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    let response = await page.request.get(
      `${baseURL}/api/monitor/${sessionId}`,
    );
    let snapshot = await response.json();
    assert.equal(snapshot.status, "paused");
    assert.equal(snapshot.alerts.length, 1);
    const stoppedCount = snapshot.successfulChecks;
    await page.screenshot({
      path: "/tmp/binjari-check/results.png",
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "다시 시작", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "다시 시작", exact: true }).click();
    await page.waitForFunction(
      async ({ baseURL, sessionId, stoppedCount }) => {
        const r = await fetch(`${baseURL}/api/monitor/${sessionId}`);
        const s = await r.json();
        return s.successfulChecks > stoppedCount;
      },
      { baseURL, sessionId, stoppedCount },
    );
    response = await page.request.get(`${baseURL}/api/monitor/${sessionId}`);
    snapshot = await response.json();
    assert.equal(snapshot.alerts.length, 1);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "종료 · 조건 변경" }).click();
    await page.getByRole("button", { name: "빈자리 탐색 시작" }).waitFor();
    response = await page.request.get(`${baseURL}/api/monitor/${sessionId}`);
    assert.equal((await response.json()).status, "stopped");
    sessionId = null;
    const rejected = await page.request.post(`${baseURL}/api/monitor`, {
      data: { bad: true },
    });
    assert.equal(rejected.status(), 400);
    const crossOrigin = await page.request.post(`${baseURL}/api/monitor`, {
      headers: { Origin: "https://example.com" },
      data: {},
    });
    assert.equal(crossOrigin.status(), 403);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("heading", { name: /매진이어도/ }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "/tmp/binjari-check/mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "이용 안내" }).click();
    await page
      .getByRole("dialog", { name: "기다리는 방법은 간단해요." })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: desktop/mobile layout, station initials/swap, time and interval controls, audio, SSE demo alert, deduplication, pause/resume, reload restoration, stop, API validation and origin checks.",
    );
    console.log(
      "Screenshots: /tmp/binjari-check/{desktop,alert,results,mobile}.png",
    );
  } finally {
    if (sessionId)
      await page.request
        .patch(`${baseURL}/api/monitor/${sessionId}`, {
          data: { action: "stop" },
        })
        .catch(() => {});
    await context.close();
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
