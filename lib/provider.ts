import { getKorailBridge, KorailBridgeError } from "./korail-bridge";
import { SearchConfig, Train, TrainType, SeatState } from "./types";
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = true,
  ) {
    super(message);
  }
}
export type TrainProvider = (
  config: SearchConfig,
  signal: AbortSignal,
) => Promise<Train[]>;
function seat(code: unknown): SeatState {
  if (code === "11") return "available";
  if (code === "13") return "sold-out";
  if (code === "00") return "unavailable";
  return "unknown";
}
function classify(name: string, group: string): TrainType | null {
  if (name.includes("KTX") || group === "100") return "KTX";
  if (name.includes("ITX") || name.includes("청춘")) return "ITX";
  if (name.includes("새마을")) return "새마을";
  if (name.includes("누리로")) return "누리로";
  if (name.includes("무궁화")) return "무궁화";
  return null;
}
type RawRow = Record<string, unknown>;
export function parseResponse(data: unknown): RawRow[] {
  if (!data || typeof data !== "object")
    throw new ProviderError("코레일 응답을 확인할 수 없습니다.");
  const d = data as Record<string, unknown>;
  if (d.strResult !== "SUCC") {
    if (
      String(d.h_msg_cd)
        .toUpperCase()
        .replace(/[\s_-]/g, "") === "MACROERROR"
    )
      throw new ProviderError(
        "코레일에서 자동 조회를 제한해 탐색을 멈췄습니다. 현재 연결 방식으로 실제 좌석을 조회할 수 없습니다. (MACROERROR)",
        false,
      );
    if (
      ["P100", "WRG000000", "WRD000061", "WRT300005"].includes(
        String(d.h_msg_cd),
      )
    )
      return [];
    if (d.h_msg_cd === "P058")
      throw new ProviderError(
        "코레일에서 로그인을 요구하고 있어 조회를 멈췄습니다. 현재 연결 방식으로는 조회할 수 없습니다.",
        false,
      );
    const code = String(d.h_msg_cd ?? "unknown")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 30);
    throw new ProviderError(
      `코레일이 조회를 완료하지 못했습니다. 잠시 후 다시 시도합니다. (${code})`,
    );
  }
  const rows = (d.trn_infos as { trn_info?: unknown } | undefined)?.trn_info;
  if (!Array.isArray(rows))
    throw new ProviderError(
      "코레일 열차 정보 형식이 변경되어 조회를 멈췄습니다.",
      false,
    );
  if (
    !rows.every(
      (r) =>
        r &&
        typeof r === "object" &&
        /^\d{6}$/.test(r.h_dpt_tm) &&
        /^\d{8}$/.test(r.h_dpt_dt) &&
        typeof r.h_trn_no === "string",
    )
  )
    throw new ProviderError("코레일 열차 정보가 불완전하여 다시 조회합니다.");
  return rows;
}
export function normalizeTrain(r: RawRow): Train | null {
  const name = String(r.h_trn_clsf_nm ?? "");
  const type = classify(name, String(r.h_trn_gp_cd ?? ""));
  if (!type) return null;
  const time = (s: unknown) =>
    String(s ?? "").slice(0, 2) + ":" + String(s ?? "").slice(2, 4);
  const date = String(r.h_dpt_dt);
  return {
    id: `${date}-${r.h_trn_no}-${r.h_dpt_rs_stn_cd}-${r.h_arv_rs_stn_cd}`,
    number: String(r.h_trn_no).replace(/^0+(?=\d)/, ""),
    name,
    type,
    departure: String(r.h_dpt_rs_stn_nm ?? ""),
    arrival: String(r.h_arv_rs_stn_nm ?? ""),
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    departureTime: time(r.h_dpt_tm),
    arrivalTime: time(r.h_arv_tm),
    general: seat(r.h_gen_rsv_cd),
    special: seat(r.h_spe_rsv_cd),
  };
}
export type FetchPage = (
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<unknown>;
const fetchPage: FetchPage = async (params, signal) => {
  try {
    return await getKorailBridge().request(params, signal);
  } catch (error) {
    if (error instanceof KorailBridgeError)
      throw new ProviderError(error.message, error.retryable);
    throw error;
  }
};
export function createLiveProvider(
  load: FetchPage = fetchPage,
  now = Date.now,
): TrainProvider {
  return async (config, signal) => {
    const date = config.date.replaceAll("-", "");
    const end = config.endTime.replace(":", "") + "59";
    let cursor = config.startTime.replace(":", "") + "00";
    const kstNow = new Date(now() + 9 * 3600000).toISOString();
    const today = kstNow.slice(0, 10).replaceAll("-", "");
    if (date < today) return [];
    if (date === today)
      cursor = [cursor, kstNow.slice(11, 19).replaceAll(":", "")]
        .sort()
        .at(-1)!;
    if (cursor > end) return [];
    const trains = new Map<string, Train>();
    for (let page = 0; page < 12; page++) {
      signal.throwIfAborted();
      const params = new URLSearchParams({
        radJobId: "1",
        selGoTrain: "109",
        txtTrnGpCd: "109",
        txtGoAbrdDt: date,
        txtGoStart: config.departure,
        txtGoEnd: config.arrival,
        txtGoHour: cursor,
        txtPsgFlg_1: String(config.passengers),
        txtPsgFlg_2: "0",
        txtPsgFlg_3: "0",
        txtPsgFlg_4: "0",
        txtPsgFlg_5: "0",
        txtMenuId: "11",
        txtSeatAttCd_2: "000",
        txtSeatAttCd_3: "000",
        txtSeatAttCd_4: "015",
      });
      const rows = parseResponse(await load(params, signal));
      if (!rows.length) return [...trains.values()];
      for (const r of rows) {
        const train = normalizeTrain(r);
        if (
          train &&
          train.date === config.date &&
          train.departureTime >= config.startTime &&
          train.departureTime <= config.endTime &&
          config.trainTypes.includes(train.type)
        )
          trains.set(train.id, train);
      }
      const sorted = [...rows].sort((a, b) =>
        `${a.h_dpt_dt}${a.h_dpt_tm}`.localeCompare(
          `${b.h_dpt_dt}${b.h_dpt_tm}`,
        ),
      );
      const last = sorted.at(-1)!;
      if (String(last.h_dpt_dt) > date || String(last.h_dpt_tm) > end)
        return [...trains.values()];
      const lastTime = String(last.h_dpt_tm);
      // Re-read the boundary second: coupled KTX services can depart together,
      // and the second train may be on the next ten-result page.
      if (lastTime === cursor && rows.length < 10) return [...trains.values()];
      const next = lastTime;
      if (next <= cursor)
        throw new ProviderError(
          "코레일의 다음 열차 목록을 불러오지 못했습니다. 시간 범위를 좁혀 다시 시도해 주세요.",
          false,
        );
      cursor = next;
    }
    throw new ProviderError(
      "열차가 많아 전체 조회를 완료하지 못했습니다. 시간 범위를 좁혀 주세요.",
      false,
    );
  };
}
export const liveProvider = createLiveProvider();
export function createDemoProvider(): TrainProvider {
  let count = 0;
  return async (config, signal) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 350);
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    });
    count++;
    const start =
      Number(config.startTime.slice(0, 2)) * 60 +
      Number(config.startTime.slice(3));
    const end =
      Number(config.endTime.slice(0, 2)) * 60 + Number(config.endTime.slice(3));
    const time = (n: number) =>
      `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    return [0, 35, 70]
      .filter((offset) => start + offset <= end)
      .map((offset, index) => ({
        id: `demo-${index}`,
        number: String(101 + index * 2),
        name: config.trainTypes[0],
        type: config.trainTypes[0],
        departure: config.departure,
        arrival: config.arrival,
        date: config.date,
        departureTime: time(start + offset),
        arrivalTime: time(start + offset + 160),
        general: count >= 3 && index === 0 ? "available" : "sold-out",
        special: count >= 3 && index === 0 ? "available" : "sold-out",
      }));
  };
}
