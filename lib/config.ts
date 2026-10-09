import { SearchConfig, TRAIN_TYPES } from "./types";
export const kstDate = (now = Date.now()) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export function endOfSearch(config: SearchConfig): number {
  return Date.parse(`${config.date}T${config.endTime}:59+09:00`);
}
export function parseConfig(input: unknown, now = Date.now()): SearchConfig {
  if (!input || typeof input !== "object")
    throw new Error("탐색 조건을 입력해 주세요.");
  const c = input as Record<string, unknown>;
  const station = (key: string) => {
    const value = c[key];
    if (
      typeof value !== "string" ||
      !/^[가-힣a-zA-Z0-9()·.\s-]{1,30}$/.test(value.trim())
    )
      throw new Error("올바른 역 이름을 입력해 주세요.");
    return value.trim();
  };
  const departure = station("departure"),
    arrival = station("arrival");
  if (departure === arrival)
    throw new Error("출발역과 도착역을 다르게 선택해 주세요.");
  if (
    typeof c.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
    !Number.isFinite(Date.parse(c.date)) ||
    new Date(c.date).toISOString().slice(0, 10) !== c.date
  )
    throw new Error("올바른 출발 날짜를 선택해 주세요.");
  if (c.date < kstDate(now) || c.date > kstDate(now + 31 * 86400000))
    throw new Error("출발 날짜는 오늘부터 31일 이내로 선택해 주세요.");
  const validTime = (t: unknown): t is string =>
    typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (
    !validTime(c.startTime) ||
    !validTime(c.endTime) ||
    c.startTime > c.endTime
  )
    throw new Error("종료 시각은 시작 시각 이후로 선택해 주세요.");
  const minutes = (t: string) =>
    Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  if (minutes(c.endTime) - minutes(c.startTime) > 360)
    throw new Error("한 번에 최대 6시간 범위를 탐색할 수 있어요.");
  if (
    !Number.isInteger(c.passengers) ||
    Number(c.passengers) < 1 ||
    Number(c.passengers) > 6
  )
    throw new Error("인원은 성인 1명부터 6명까지 선택해 주세요.");
  if (
    !Array.isArray(c.trainTypes) ||
    !c.trainTypes.length ||
    c.trainTypes.length > 5 ||
    !c.trainTypes.every((t) => TRAIN_TYPES.includes(t))
  )
    throw new Error("열차 종류를 하나 이상 선택해 주세요.");
  if (!["general", "special", "any"].includes(String(c.seatClass)))
    throw new Error("좌석 등급을 선택해 주세요.");
  if (
    !Number.isInteger(c.intervalSeconds) ||
    Number(c.intervalSeconds) < 2 ||
    Number(c.intervalSeconds) > 60
  )
    throw new Error("조회 간격은 2초부터 60초까지 설정할 수 있어요.");
  if (c.mode !== "live" && c.mode !== "demo")
    throw new Error("탐색 모드를 확인해 주세요.");
  const config = {
    ...c,
    departure,
    arrival,
    trainTypes: [...new Set(c.trainTypes)],
  } as SearchConfig;
  if (endOfSearch(config) < now)
    throw new Error("이미 지난 시간대예요. 출발 날짜와 시간을 확인해 주세요.");
  return {
    departure,
    arrival,
    date: config.date,
    startTime: config.startTime,
    endTime: config.endTime,
    passengers: config.passengers,
    trainTypes: config.trainTypes,
    seatClass: config.seatClass,
    intervalSeconds: config.intervalSeconds,
    mode: config.mode,
  };
}
export function defaultConfig(): SearchConfig {
  return {
    departure: "서울",
    arrival: "부산",
    date: kstDate(Date.now() + 86400000),
    startTime: "08:00",
    endTime: "11:00",
    passengers: 1,
    trainTypes: ["KTX"],
    seatClass: "general",
    intervalSeconds: 3,
    mode: "live",
  };
}
