import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, defaultConfig, kstDate } from "../lib/config";
import { searchStations } from "../lib/stations";
import { SearchConfig, Train, availableSeats } from "../lib/types";
import {
  createLiveProvider,
  parseResponse,
  normalizeTrain,
  ProviderError,
  TrainProvider,
} from "../lib/provider";
import { Monitor } from "../lib/monitor";
const now = Date.parse("2026-10-09T12:00:00+09:00");
const config: SearchConfig = {
  ...defaultConfig(),
  date: "2026-10-10",
  mode: "demo",
  intervalSeconds: 3,
};
const train = (
  general: Train["general"] = "sold-out",
  special: Train["special"] = "sold-out",
): Train => ({
  id: "a",
  number: "101",
  name: "KTX",
  type: "KTX",
  departure: "서울",
  arrival: "부산",
  date: config.date,
  departureTime: "08:30",
  arrivalTime: "11:10",
  general,
  special,
});
const row = (time: string, overrides: Record<string, unknown> = {}) => ({
  h_dpt_dt: "20261010",
  h_dpt_tm: time,
  h_arv_tm: "111000",
  h_trn_no: "00101",
  h_trn_clsf_nm: "KTX",
  h_trn_gp_cd: "100",
  h_dpt_rs_stn_cd: "0001",
  h_arv_rs_stn_cd: "0020",
  h_dpt_rs_stn_nm: "서울",
  h_arv_rs_stn_nm: "부산",
  h_gen_rsv_cd: "13",
  h_spe_rsv_cd: "11",
  ...overrides,
});
const response = (rows: Record<string, unknown>[]) => ({
  strResult: "SUCC",
  trn_infos: { trn_info: rows },
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("KST date and search bounds reject bad dates, routes, ranges and intervals", () => {
  assert.equal(kstDate(Date.parse("2026-10-09T16:00:00Z")), "2026-10-10");
  assert.deepEqual(parseConfig(config, now), config);
  for (const patch of [
    { arrival: "서울" },
    { date: "2026-02-30" },
    { date: "2026-10-08" },
    { date: "2026-12-01" },
    { startTime: "12:00", endTime: "11:00" },
    { startTime: "00:00", endTime: "23:59" },
    { intervalSeconds: 1 },
    { intervalSeconds: 61 },
    { intervalSeconds: 2.5 },
    { passengers: 0 },
    { trainTypes: [] },
    { mode: "fake" },
    { seatClass: "fake" },
  ])
    assert.throws(
      () => parseConfig({ ...config, ...patch }, now),
      JSON.stringify(patch),
    );
  assert.throws(() =>
    parseConfig({ ...config, date: "2026-10-09", endTime: "11:00" }, now),
  );
  assert.equal(
    parseConfig(
      { ...config, intervalSeconds: 2, trainTypes: ["KTX", "KTX"] },
      now,
    ).trainTypes.length,
    1,
  );
});
test("station suggestions support Korean initials", () => {
  assert.ok(searchStations("ㅅㅇ").includes("서울"));
  assert.ok(searchStations("ㅂㅅ").includes("부산"));
});
test("seat status does not confuse waitlist, missing or unknown codes with availability", () => {
  assert.equal(normalizeTrain(row("083000"))?.general, "sold-out");
  assert.equal(normalizeTrain(row("083000"))?.special, "available");
  assert.equal(
    normalizeTrain(row("083000", { h_gen_rsv_cd: "09" }))?.general,
    "unknown",
  );
  assert.equal(
    normalizeTrain(row("083000", { h_gen_rsv_cd: undefined }))?.general,
    "unknown",
  );
  assert.equal(
    normalizeTrain(row("083000", { h_gen_rsv_cd: "00" }))?.general,
    "unavailable",
  );
  assert.deepEqual(
    availableSeats(train("sold-out", "available"), "general"),
    [],
  );
  assert.deepEqual(availableSeats(train("sold-out", "available"), "any"), [
    "특실",
  ]);
});
test("API errors cannot become a successful sold-out response", () => {
  assert.throws(
    () => parseResponse({ strResult: "FAIL", h_msg_cd: "P058" }),
    (e: unknown) => e instanceof ProviderError && !e.retryable,
  );
  assert.throws(() => parseResponse("<html>blocked</html>"));
  assert.throws(() => parseResponse({ strResult: "SUCC" }));
  assert.throws(() => parseResponse(response([row("bad")])));
  assert.deepEqual(parseResponse({ strResult: "FAIL", h_msg_cd: "P100" }), []);
});
test("live adapter paginates and applies route time, train class and passenger filters", async () => {
  const calls: URLSearchParams[] = [];
  const provider = createLiveProvider(async (params) => {
    calls.push(params);
    if (calls.length === 1)
      return response([
        row("083000"),
        row("090000", {
          h_trn_no: "00201",
          h_trn_clsf_nm: "무궁화호",
          h_trn_gp_cd: "102",
        }),
      ]);
    return response([
      row("103000", { h_trn_no: "00103" }),
      row("113000", { h_trn_no: "00105" }),
    ]);
  });
  const results = await provider(
    { ...config, passengers: 2 },
    new AbortController().signal,
  );
  assert.deepEqual(
    results.map((t) => t.departureTime),
    ["08:30", "10:30"],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].get("txtGoHour"), "090000");
  assert.equal(calls[0].get("txtPsgFlg_1"), "2");
  assert.equal(calls[0].get("txtGoStart"), "서울");
  assert.equal(calls[0].get("txtGoEnd"), "부산");
});
test("pagination must not silently return incomplete data", async () => {
  const provider = createLiveProvider(async () =>
    response(
      Array.from({ length: 10 }, (_, index) =>
        row("083000", { h_trn_no: String(100 + index) }),
      ),
    ),
  );
  await assert.rejects(
    provider(config, new AbortController().signal),
    /다음 열차/,
  );
});
test("seat discovery alerts only on availability edges and honors seat class", async () => {
  let result = [train()];
  const monitor = new Monitor(
    config,
    async () => result,
    () => now,
    false,
  );
  monitor.resume();
  await settle();
  assert.equal(monitor.snapshot().alerts.length, 0);
  result = [train("available")];
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().alerts.length, 1);
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().alerts.length, 1);
  result = [train()];
  await monitor.pollOnce();
  result = [train("available")];
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().alerts.length, 2);
  assert.equal(monitor.snapshot().successfulChecks, 5);
  monitor.dispose();
  const special = new Monitor(
    { ...config, seatClass: "special" },
    async () => [train("available")],
    () => now,
    false,
  );
  special.resume();
  await settle();
  assert.equal(special.snapshot().alerts.length, 0);
  special.dispose();
});
test("errors back off and retain last successful results without re-alerting", async () => {
  let failure = false;
  const monitor = new Monitor(
    config,
    async () => {
      if (failure) throw new ProviderError("unavailable");
      return [train("available")];
    },
    () => now,
    false,
  );
  monitor.resume();
  await settle();
  failure = true;
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().status, "retrying");
  assert.equal(monitor.snapshot().nextCheckAt, now + 10000);
  assert.equal(monitor.snapshot().trains.length, 1);
  assert.equal(monitor.snapshot().successfulChecks, 1);
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().nextCheckAt, now + 20000);
  failure = false;
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().alerts.length, 1);
  assert.equal(monitor.snapshot().nextCheckAt, now + 3000);
  monitor.dispose();
});
test("blocked requests pause instead of hammering the provider", async () => {
  const monitor = new Monitor(
    config,
    async () => {
      throw new ProviderError("blocked", false);
    },
    () => now,
    false,
  );
  monitor.resume();
  await settle();
  assert.equal(monitor.snapshot().status, "paused");
  assert.equal(monitor.snapshot().nextCheckAt, null);
  monitor.dispose();
});
test("requests never overlap and stop discards in-flight results", async () => {
  let complete!: (trains: Train[]) => void;
  let calls = 0;
  let signal: AbortSignal | undefined;
  const provider: TrainProvider = async (_, s) => {
    calls++;
    signal = s;
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const monitor = new Monitor(config, provider, () => now, false);
  monitor.resume();
  await monitor.pollOnce();
  await monitor.pollOnce();
  assert.equal(calls, 1);
  monitor.stop();
  assert.equal(signal?.aborted, true);
  complete([train("available")]);
  await settle();
  assert.equal(monitor.snapshot().status, "stopped");
  assert.equal(monitor.snapshot().alerts.length, 0);
  assert.equal(monitor.snapshot().nextCheckAt, null);
});
test("pause and resume retain state, disconnected sessions expire", async () => {
  let clock = now;
  let calls = 0;
  const monitor = new Monitor(
    config,
    async () => {
      calls++;
      return [train()];
    },
    () => clock,
    false,
  );
  monitor.resume();
  await settle();
  monitor.pause();
  await monitor.pollOnce();
  assert.equal(calls, 1);
  monitor.resume();
  await settle();
  assert.equal(calls, 2);
  clock += 91000;
  await monitor.pollOnce();
  assert.equal(calls, 2);
  assert.equal(monitor.snapshot().status, "expired");
});
test("departure-window expiry stops querying even with a connected browser", async () => {
  let clock = now;
  const monitor = new Monitor(
    config,
    async () => [train()],
    () => clock,
    false,
  );
  monitor.resume();
  await settle();
  clock = Date.parse("2026-10-10T11:01:00+09:00");
  monitor.touch();
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().status, "expired");
  assert.equal(monitor.snapshot().attempts, 1);
});

test("MACROERROR is a terminal provider failure, not an empty train list", () => {
  assert.throws(
    () => parseResponse({ strResult: "FAIL", h_msg_cd: "MACROERROR" }),
    (e: unknown) =>
      e instanceof ProviderError &&
      !e.retryable &&
      e.message.includes("MACROERROR"),
  );
});

test("unknown seat states do not trigger duplicate discovery alerts", async () => {
  let result = [train("available")];
  const monitor = new Monitor(
    config,
    async () => result,
    () => now,
    false,
  );
  monitor.resume();
  await settle();
  result = [train("unknown")];
  await monitor.pollOnce();
  result = [train("available")];
  await monitor.pollOnce();
  assert.equal(monitor.snapshot().alerts.length, 1);
  monitor.dispose();
});

test("late provider responses cannot alert for departed trains or an expired search", async () => {
  let clock = Date.parse("2026-10-10T09:00:00+09:00");
  const monitor = new Monitor(
    config,
    async () => [train("available")],
    () => clock,
    false,
  );
  monitor.resume();
  await settle();
  assert.equal(monitor.snapshot().alerts.length, 0);
  monitor.dispose();
  let complete!: (trains: Train[]) => void;
  clock = Date.parse("2026-10-10T10:59:59+09:00");
  const late = new Monitor(
    config,
    async () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    () => clock,
    false,
  );
  late.resume();
  clock = Date.parse("2026-10-10T11:01:00+09:00");
  complete([train("available")]);
  await settle();
  assert.equal(late.snapshot().alerts.length, 0);
  assert.equal(late.snapshot().status, "expired");
});

test("actual spaced MACRO ERROR response is terminal", () => {
  for (const code of ["MACRO ERROR", "MACROERROR", "macro_error"]) {
    assert.throws(
      () => parseResponse({ strResult: "FAIL", h_msg_cd: code }),
      (e: unknown) => e instanceof ProviderError && !e.retryable,
    );
  }
});

test("pagination keeps trains sharing the last departure second of a page", async () => {
  let page = 0;
  const provider = createLiveProvider(async (params) => {
    page++;
    if (page === 1)
      return response([
        row("083000", { h_trn_no: "101" }),
        row("090000", { h_trn_no: "103" }),
      ]);
    assert.equal(params.get("txtGoHour"), "090000");
    return response([
      row("090000", { h_trn_no: "103" }),
      row("090000", { h_trn_no: "9103" }),
      row("113000", { h_trn_no: "105" }),
    ]);
  });
  const trains = await provider(config, new AbortController().signal);
  assert.deepEqual(
    trains.map((t) => t.number),
    ["101", "103", "9103"],
  );
});

test("today's polling advances past the elapsed part of the selected range", async () => {
  const moment = Date.parse("2026-10-10T09:45:12+09:00");
  let actual: string | null = null;
  const provider = createLiveProvider(
    async (params) => {
      actual = params.get("txtGoHour");
      return response([]);
    },
    () => moment,
  );
  await provider(config, new AbortController().signal);
  assert.equal(actual, "094512");
});
