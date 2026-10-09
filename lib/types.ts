export const TRAIN_TYPES = [
  "KTX",
  "ITX",
  "새마을",
  "무궁화",
  "누리로",
] as const;
export type TrainType = (typeof TRAIN_TYPES)[number];
export type SeatClass = "general" | "special" | "any";
export type SeatState = "available" | "sold-out" | "unavailable" | "unknown";
export type SearchConfig = {
  departure: string;
  arrival: string;
  date: string;
  startTime: string;
  endTime: string;
  passengers: number;
  trainTypes: TrainType[];
  seatClass: SeatClass;
  intervalSeconds: number;
  mode: "live" | "demo";
};
export type Train = {
  id: string;
  number: string;
  name: string;
  type: TrainType;
  departure: string;
  arrival: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  general: SeatState;
  special: SeatState;
};
export type SeatAlert = {
  id: string;
  train: Train;
  seats: string[];
  foundAt: number;
};
export type MonitorSnapshot = {
  id: string;
  config: SearchConfig;
  status:
    | "searching"
    | "waiting"
    | "retrying"
    | "paused"
    | "stopped"
    | "expired";
  startedAt: number;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  attempts: number;
  successfulChecks: number;
  consecutiveErrors: number;
  error: string | null;
  trains: Train[];
  alerts: SeatAlert[];
};
export function availableSeats(train: Train, seatClass: SeatClass): string[] {
  return [
    seatClass !== "special" && train.general === "available" ? "일반실" : null,
    seatClass !== "general" && train.special === "available" ? "특실" : null,
  ].filter((x): x is string => x !== null);
}
export const isActive = (status: MonitorSnapshot["status"]) =>
  status === "searching" || status === "waiting" || status === "retrying";
