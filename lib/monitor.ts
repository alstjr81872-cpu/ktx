import { randomUUID } from "node:crypto";
import { endOfSearch } from "./config";
import {
  ProviderError,
  TrainProvider,
  createDemoProvider,
  liveProvider,
} from "./provider";
import {
  MonitorSnapshot,
  SearchConfig,
  availableSeats,
  isActive,
} from "./types";

type Listener = (snapshot: MonitorSnapshot) => void;
export class Monitor {
  private state: MonitorSnapshot;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private available = new Set<string>();
  private lastSeen: number;
  private generation = 0;
  private disposed = false;
  constructor(
    config: SearchConfig,
    private provider: TrainProvider,
    private now = Date.now,
    private autoSchedule = true,
    id: string = randomUUID(),
  ) {
    this.lastSeen = now();
    this.state = {
      id,
      config,
      status: "paused",
      startedAt: now(),
      lastCheckedAt: null,
      nextCheckAt: null,
      attempts: 0,
      successfulChecks: 0,
      consecutiveErrors: 0,
      error: null,
      trains: [],
      alerts: [],
    };
  }
  snapshot(): MonitorSnapshot {
    return structuredClone(this.state);
  }
  touch() {
    this.lastSeen = this.now();
  }
  subscribe(listener: Listener) {
    this.touch();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.generation++;
  }
  resume() {
    if (this.disposed || isActive(this.state.status)) return;
    this.clear();
    this.touch();
    this.state.status = "waiting";
    this.state.error = null;
    this.state.consecutiveErrors = 0;
    this.state.nextCheckAt = this.now();
    this.emit();
    void this.pollOnce();
  }
  pause() {
    if (this.disposed) return;
    this.clear();
    this.state.status = "paused";
    this.state.nextCheckAt = null;
    this.emit();
  }
  stop(status: "stopped" | "expired" = "stopped") {
    this.clear();
    this.state.status = status;
    this.state.nextCheckAt = null;
    this.disposed = true;
    this.emit();
  }
  async pollOnce() {
    if (this.disposed || this.controller || !isActive(this.state.status))
      return;
    if (this.now() > endOfSearch(this.state.config)) {
      this.stop("expired");
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    this.state.status = "searching";
    this.state.nextCheckAt = null;
    this.state.attempts++;
    this.emit();
    let delay = this.state.config.intervalSeconds * 1000;
    try {
      const trains = await this.provider(this.state.config, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      const foundAt = this.now();
      if (foundAt > endOfSearch(this.state.config)) {
        this.stop("expired");
        return;
      }
      const currentAvailable = new Set<string>();
      for (const train of trains) {
        if (
          Date.parse(`${train.date}T${train.departureTime}:00+09:00`) < foundAt
        )
          continue;
        // An unknown response is not evidence that a previously available seat sold out.
        for (const [field, label] of [
          ["general", "일반실"],
          ["special", "특실"],
        ] as const) {
          const key = `${train.id}:${label}`;
          if (train[field] === "unknown" && this.available.has(key))
            currentAvailable.add(key);
        }
        const seats = availableSeats(train, this.state.config.seatClass);
        const freshSeats = seats.filter(
          (s) => !this.available.has(`${train.id}:${s}`),
        );
        for (const s of seats) currentAvailable.add(`${train.id}:${s}`);
        if (freshSeats.length)
          this.state.alerts.unshift({
            id: randomUUID(),
            train,
            seats: freshSeats,
            foundAt,
          });
      }
      this.available = currentAvailable;
      this.state.alerts = this.state.alerts.slice(0, 50);
      this.state.trains = trains;
      this.state.lastCheckedAt = foundAt;
      this.state.successfulChecks++;
      this.state.consecutiveErrors = 0;
      this.state.error = null;
      this.state.status = "waiting";
    } catch (e) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.state.consecutiveErrors++;
      this.state.error =
        e instanceof ProviderError
          ? e.message
          : "조회 중 문제가 발생했습니다. 잠시 후 다시 시도합니다.";
      if (e instanceof ProviderError && !e.retryable)
        this.state.status = "paused";
      else {
        this.state.status = "retrying";
        delay = Math.max(
          delay,
          Math.min(
            120000,
            10000 * 2 ** Math.min(this.state.consecutiveErrors - 1, 4),
          ),
        );
      }
    } finally {
      if (generation === this.generation) {
        this.controller = undefined;
        this.state.nextCheckAt = isActive(this.state.status)
          ? this.now() + delay
          : null;
        this.emit();
        if (this.autoSchedule && isActive(this.state.status)) {
          this.timer = setTimeout(() => {
            void this.pollOnce();
          }, delay);
          this.timer.unref?.();
        }
      }
    }
  }
  dispose() {
    this.stop();
    this.listeners.clear();
  }
}

type Registry = { current?: Monitor };
const globalRegistry = globalThis as typeof globalThis & {
  seatWatchRegistry?: Registry;
};
const registry = (globalRegistry.seatWatchRegistry ??= {});
export function startMonitor(config: SearchConfig) {
  if (registry.current && isActive(registry.current.snapshot().status))
    throw new Error(
      "이미 실행 중인 탐색이 있습니다. 기존 탐색을 종료한 뒤 시작해 주세요.",
    );
  registry.current?.dispose();
  const monitor = new Monitor(
    config,
    config.mode === "demo" ? createDemoProvider() : liveProvider,
  );
  registry.current = monitor;
  monitor.resume();
  return monitor;
}
export function getMonitor(id: string) {
  const monitor = registry.current;
  if (!monitor || monitor.snapshot().id !== id) return undefined;
  monitor.touch();
  return monitor;
}

// Idempotent recovery: multiple tabs may restore the same session concurrently.
export function restoreMonitor(id: string, config: SearchConfig, paused: boolean) {
  const current = registry.current;
  if (current?.snapshot().id === id) return current;
  if (current && !["stopped", "expired"].includes(current.snapshot().status))
    throw new Error("다른 탐색이 실행 중입니다. 기존 탐색을 확인해 주세요.");
  current?.dispose();
  const monitor = new Monitor(config,
    config.mode === "demo" ? createDemoProvider() : liveProvider,
    Date.now, true, id);
  registry.current = monitor;
  if (!paused) monitor.resume();
  return monitor;
}
