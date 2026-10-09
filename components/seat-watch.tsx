"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Coffee,
  ExternalLink,
  MapPin,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Ticket,
  TrainFront,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { defaultConfig, kstDate, parseConfig } from "@/lib/config";
import { searchStations } from "@/lib/stations";
import {
  availableSeats,
  isActive,
  MonitorSnapshot,
  SearchConfig,
  SeatAlert,
  SeatState,
  TRAIN_TYPES,
} from "@/lib/types";

const BOOKING_URL = "https://www.korail.com/";
const STORAGE = "binjari-v1";
const timeText = (stamp: number) =>
  new Date(stamp).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
const dateText = (date: string) =>
  new Date(`${date}T12:00:00+09:00`).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
const seatLabels: Record<SeatState, string> = {
  available: "좌석 있음",
  "sold-out": "매진",
  unavailable: "운영 없음",
  unknown: "확인 불가",
};
function readStorage(key: string) {
  try {
    return localStorage.getItem(`${STORAGE}-${key}`);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(`${STORAGE}-${key}`, value);
  } catch {
    /* Private browsing may disable storage. */
  }
}
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "서버에 연결하지 못했습니다.");
  return body as MonitorSnapshot;
}
function StationInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);
  const options = searchStations(value);
  const id = label === "출발역" ? "departure" : "arrival";
  return (
    <div className="station-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-icon">
        <MapPin size={17} />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            onChange(e.target.value);
            setIndex(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setIndex((i) => Math.min(i + 1, options.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && open && index >= 0) {
              e.preventDefault();
              onChange(options[index]);
              setOpen(false);
            }
          }}
        />
        <ChevronDown size={14} />
      </div>
      {open && options.length > 0 && (
        <ul id={`${id}-options`} role="listbox" className="station-options">
          {options.map((s, i) => (
            <li
              role="option"
              aria-selected={index === i}
              id={`${id}-${i}`}
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
              className={index === i ? "focused" : ""}
            >
              <MapPin size={14} />
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function JourneyArt() {
  return (
    <div className="journey-art" aria-hidden="true">
      <span className="art-cloud cloud-one" />
      <span className="art-cloud cloud-two" />
      <div className="art-hill hill-one" />
      <div className="art-hill hill-two" />
      <span className="art-tree tree-one" />
      <span className="art-tree tree-two" />
      <div className="art-track" />
      <div className="art-train">
        <span />
        <span />
        <span />
        <span />
        <i />
      </div>
      <div className="art-pin">
        <MapPin size={25} fill="currentColor" strokeWidth={1.5} />
      </div>
      <span className="art-spark spark-one">✦</span>
      <span className="art-spark spark-two">✧</span>
    </div>
  );
}
export default function SeatWatch() {
  const [config, setConfig] = useState<SearchConfig>(defaultConfig);
  const [monitor, setMonitor] = useState<MonitorSnapshot | null>(null);
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sound, setSound] = useState(true);
  const [notificationPermission, setNotificationPermission] =
    useState<string>("default");
  const [notice, setNotice] = useState<string | null>(null);
  const [popup, setPopup] = useState<SeatAlert | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [restored, setRestored] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(true);
  const seenRef = useRef(new Set<string>());
  const popupCloseRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const active = monitor && isActive(monitor.status);
  const editable =
    !monitor || monitor.status === "stopped" || monitor.status === "expired";
  const liveConfig = monitor?.config ?? config;
  const countdown = monitor?.nextCheckAt
    ? Math.max(0, Math.ceil((monitor.nextCheckAt - now) / 1000))
    : 0;
  const patchConfig = <K extends keyof SearchConfig>(
    key: K,
    value: SearchConfig[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));

  const primeAudio = useCallback(async () => {
    try {
      audioRef.current ??= new AudioContext();
      if (audioRef.current.state === "suspended")
        await audioRef.current.resume();
      return true;
    } catch {
      setNotice(
        "이 브라우저에서 소리를 켤 수 없습니다. 화면 알림을 확인해 주세요.",
      );
      return false;
    }
  }, []);
  const playSound = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== "running") return;
    [659.25, 830.61, 987.77, 830.61, 987.77].forEach((frequency, i) => {
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.45);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }, []);

  useEffect(() => {
    const saved = readStorage("config");
    if (saved) {
      try {
        setConfig(parseConfig(JSON.parse(saved)));
      } catch {
        /* Old dates use defaults. */
      }
    }
    const preference = readStorage("sound") !== "off";
    setSound(preference);
    soundRef.current = preference;
    try {
      seenRef.current = new Set(JSON.parse(readStorage("seen") ?? "[]"));
    } catch {
      /* Use empty history. */
    }
    setMonitorId(readStorage("session"));
    if ("Notification" in window)
      setNotificationPermission(Notification.permission);
    else setNotificationPermission("unsupported");
    setRestored(true);
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(timer);
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (restored) writeStorage("config", JSON.stringify(config));
  }, [config, restored]);
  useEffect(() => {
    if (popup) popupCloseRef.current?.focus();
  }, [popup]);

  const receive = useCallback(
    (snapshot: MonitorSnapshot) => {
      setMonitor(snapshot);
      setConfig(snapshot.config);
      const fresh = snapshot.alerts.filter((a) => !seenRef.current.has(a.id));
      if (fresh.length) {
        for (const a of fresh) seenRef.current.add(a.id);
        seenRef.current = new Set([...seenRef.current].slice(-100));
        writeStorage("seen", JSON.stringify([...seenRef.current]));
        const alert = fresh[0];
        setPopup(alert);
        if (soundRef.current) {
          playSound();
          if (audioRef.current?.state !== "running")
            setNotice("소리 알림을 다시 켜려면 ‘소리 테스트’를 눌러 주세요.");
        }
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const notification = new Notification(
              `${snapshot.config.mode === "demo" ? "[체험] " : ""}빈자리를 찾았어요!`,
              {
                body: `${alert.train.name} ${alert.train.number} · ${alert.train.departureTime} ${alert.train.departure} → ${alert.train.arrival} · ${alert.seats.join("·")}`,
                tag: alert.id,
              },
            );
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          } catch {
            /* In-page alerts remain available. */
          }
        }
      }
      if (["stopped", "expired"].includes(snapshot.status))
        writeStorage("session", "");
    },
    [playSound],
  );
  useEffect(() => {
    if (!monitorId) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    const events = new EventSource(`/api/monitor/${monitorId}/events`);
    events.onopen = () => {
      if (!cancelled) setConnected(true);
    };
    events.onmessage = (event) => {
      if (cancelled) return;
      try {
        const snapshot = JSON.parse(event.data) as MonitorSnapshot;
        receive(snapshot);
        if (["stopped", "expired"].includes(snapshot.status)) {
          events.close();
          setConnected(false);
        }
      } catch {
        setError("탐색 상태를 읽지 못했습니다. 새로고침해 주세요.");
      }
    };
    const verify = async () => {
      try {
        const snapshot = await api(`/api/monitor/${monitorId}`);
        if (!cancelled) receive(snapshot);
      } catch (e) {
        if (cancelled) return;
        // A missing session is permanent; a temporary network outage is retried by EventSource.
        if (e instanceof Error && e.message.includes("서버가 재시작")) {
          events.close();
          setMonitorId(null);
          setMonitor(null);
          writeStorage("session", "");
          setError(e.message);
        }
      }
    };
    events.onerror = () => {
      if (!cancelled) {
        setConnected(false);
        void verify();
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void verify();
    };
    document.addEventListener("visibilitychange", visible);
    void verify();
    return () => {
      cancelled = true;
      events.close();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [monitorId, receive]);

  async function start(mode = config.mode) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const next = parseConfig({ ...config, mode });
      if (soundRef.current) await primeAudio();
      const snapshot = await api("/api/monitor", {
        method: "POST",
        body: JSON.stringify(next),
      });
      setPopup(null);
      receive(snapshot);
      setMonitorId(snapshot.id);
      writeStorage("session", snapshot.id);
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "탐색을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function control(action: "pause" | "resume" | "stop") {
    if (!monitor) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "resume" && soundRef.current) await primeAudio();
      receive(
        await api(`/api/monitor/${monitor.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action }),
        }),
      );
      if (action === "stop") {
        setMonitorId(null);
        setPopup(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotice(
        "이 브라우저는 시스템 알림을 지원하지 않습니다. 화면 알림과 소리를 이용해 주세요.",
      );
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      setNotice(
        result === "granted"
          ? "브라우저 알림이 켜졌어요. 다른 탭을 보고 있어도 알려드릴게요."
          : "브라우저 설정에서 알림을 허용할 수 있어요. 화면 알림은 계속 표시됩니다.",
      );
    } catch {
      setNotice("브라우저 알림을 켜지 못했습니다. 화면 알림을 이용해 주세요.");
    }
  }
  const statusLabel = !monitor
    ? "탐색 준비"
    : {
        searching: "빈자리 탐색 중",
        waiting: "빈자리 탐색 중",
        retrying: "연결 재시도 중",
        paused: "탐색 일시정지",
        stopped: "탐색 종료",
        expired: "탐색 종료",
      }[monitor.status];
  const selectedSeat = { general: "일반실", special: "특실", any: "모든 좌석" }[
    liveConfig.seatClass
  ];

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="빈자리 홈">
            <span className="brand-icon">
              <TrainFront size={23} strokeWidth={2.2} />
            </span>
            <span>
              빈자리<span className="brand-dot">.</span>
            </span>
          </a>
          <span className="header-caption">
            기다림은 맡기고, 여행을 생각하세요.
          </span>
          <button className="guide-button" onClick={() => setShowGuide(true)}>
            <CircleHelp size={17} />
            <span>이용 안내</span>
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> YOUR NEXT JOURNEY
            </div>
            <h1>
              매진이어도,
              <br className="mobile-break" /> 기회는 <span>다시 와요.</span>
            </h1>
            <p>원하는 기차를 골라두세요. 빈자리가 생기는 순간 알려드릴게요.</p>
          </div>
          <div className="intro-ticket">
            <Ticket size={23} />
            <span>
              다음 여행의
              <br />
              <strong>빈 한 자리</strong>
            </span>
            <span className="ticket-star">✦</span>
          </div>
        </section>
        <div className="workspace">
          <section className="search-card" aria-labelledby="search-title">
            <div className="card-heading">
              <div>
                <span className="section-number">01</span>
                <h2 id="search-title">어디로 떠나시나요?</h2>
              </div>
              <SlidersHorizontal size={18} />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void start("live");
              }}
            >
              <fieldset disabled={!editable || busy}>
                <div className="stations-row">
                  <StationInput
                    label="출발역"
                    value={config.departure}
                    onChange={(v) => patchConfig("departure", v)}
                    disabled={!editable || busy}
                  />
                  <button
                    type="button"
                    className="swap-button"
                    aria-label="출발역과 도착역 바꾸기"
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        departure: c.arrival,
                        arrival: c.departure,
                      }))
                    }
                  >
                    <ArrowDownUp size={17} />
                  </button>
                  <StationInput
                    label="도착역"
                    value={config.arrival}
                    onChange={(v) => patchConfig("arrival", v)}
                    disabled={!editable || busy}
                  />
                </div>
                <p className="field-hint">
                  역 이름 또는 초성으로 검색할 수 있어요.
                </p>
                <div className="two-fields">
                  <div>
                    <label htmlFor="date">출발 날짜</label>
                    <div className="input-icon">
                      <CalendarDays size={17} />
                      <input
                        id="date"
                        type="date"
                        value={config.date}
                        min={kstDate()}
                        max={kstDate(Date.now() + 31 * 86400000)}
                        onChange={(e) => patchConfig("date", e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="passengers">인원</label>
                    <div className="input-icon">
                      <Users size={17} />
                      <select
                        id="passengers"
                        value={config.passengers}
                        onChange={(e) =>
                          patchConfig("passengers", Number(e.target.value))
                        }
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>
                            성인 {n}명
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="field-group">
                  <div className="label-row">
                    <span className="field-label" id="train-label">
                      열차 종류
                    </span>
                    <span>여러 개 선택 가능</span>
                  </div>
                  <div
                    className="train-chips"
                    role="group"
                    aria-labelledby="train-label"
                  >
                    {TRAIN_TYPES.map((type) => (
                      <button
                        type="button"
                        key={type}
                        aria-pressed={config.trainTypes.includes(type)}
                        className={
                          config.trainTypes.includes(type)
                            ? "chip selected"
                            : "chip"
                        }
                        onClick={() =>
                          patchConfig(
                            "trainTypes",
                            config.trainTypes.includes(type)
                              ? config.trainTypes.filter((t) => t !== type)
                              : [...config.trainTypes, type],
                          )
                        }
                      >
                        {type === "KTX" && <Zap size={13} />} {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field-group">
                  <div className="label-row">
                    <span className="field-label">출발 시간대</span>
                    <span>최대 6시간</span>
                  </div>
                  <div className="time-inputs">
                    <div className="input-icon">
                      <Clock3 size={16} />
                      <input
                        aria-label="시작 시간"
                        type="time"
                        value={config.startTime}
                        onChange={(e) =>
                          patchConfig("startTime", e.target.value)
                        }
                        required
                      />
                    </div>
                    <span>—</span>
                    <div className="input-icon">
                      <Clock3 size={16} />
                      <input
                        aria-label="종료 시간"
                        type="time"
                        value={config.endTime}
                        onChange={(e) => patchConfig("endTime", e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="time-presets">
                    {[
                      { label: "오전", start: "06:00", end: "12:00" },
                      { label: "오후", start: "12:00", end: "18:00" },
                      { label: "저녁", start: "18:00", end: "23:59" },
                    ].map((t) => (
                      <button
                        type="button"
                        key={t.label}
                        className={
                          config.startTime === t.start &&
                          config.endTime === t.end
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          setConfig((c) => ({
                            ...c,
                            startTime: t.start,
                            endTime: t.end,
                          }))
                        }
                      >
                        {t.label}{" "}
                        <span>
                          {t.start}–{t.end}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field-group">
                  <span className="field-label" id="seat-label">
                    좌석 등급
                  </span>
                  <div
                    className="segmented"
                    role="group"
                    aria-labelledby="seat-label"
                  >
                    {(
                      [
                        ["general", "일반실"],
                        ["special", "특실"],
                        ["any", "상관없음"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={config.seatClass === value}
                        className={config.seatClass === value ? "selected" : ""}
                        onClick={() => patchConfig("seatClass", value)}
                      >
                        {config.seatClass === value && <Check size={14} />}{" "}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="interval-box">
                  <div className="label-row">
                    <span className="field-label">
                      <RotateCcw size={15} /> 조회 간격
                    </span>
                    <span className="personal-tag">나만의 탐색 속도</span>
                  </div>
                  <div
                    className="interval-options"
                    role="group"
                    aria-label="조회 간격"
                  >
                    {[2, 3, 5, 10, 30].map((n) => (
                      <button
                        type="button"
                        key={n}
                        aria-pressed={config.intervalSeconds === n}
                        className={
                          config.intervalSeconds === n ? "selected" : ""
                        }
                        onClick={() => patchConfig("intervalSeconds", n)}
                      >
                        {n}
                        <span>초</span>
                        {n === 3 && <i />}
                      </button>
                    ))}
                  </div>
                  <p>
                    <Zap size={12} /> 조회 완료 후 {config.intervalSeconds}초 뒤
                    다시 확인해요.
                  </p>
                </div>
              </fieldset>
              {error && (
                <div className="inline-error" role="alert">
                  {error}
                  <button
                    type="button"
                    aria-label="오류 닫기"
                    onClick={() => setError(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {editable ? (
                <button className="start-button" type="submit" disabled={busy}>
                  {busy ? <span className="spinner" /> : <Search size={18} />}{" "}
                  {busy ? "탐색을 준비하고 있어요" : "빈자리 탐색 시작"}
                  <ArrowRight size={18} />
                </button>
              ) : (
                <div className="monitor-controls">
                  <button
                    type="button"
                    className="pause-button"
                    disabled={busy}
                    onClick={() => void control(active ? "pause" : "resume")}
                  >
                    {active ? <Pause size={17} /> : <Play size={17} />}{" "}
                    {active ? "일시정지" : "다시 시작"}
                  </button>
                  <button
                    type="button"
                    className="stop-button"
                    disabled={busy}
                    onClick={() => void control("stop")}
                  >
                    <Square size={15} /> 종료 · 조건 변경
                  </button>
                </div>
              )}
              <p className="under-button">
                <ShieldCheck size={13} /> 예매는 알림을 확인한 뒤 코레일에서
                직접 진행해요.
              </p>
            </form>
          </section>
          <div className="right-column">
            <section
              className={`monitor-card ${active ? "is-active" : ""}`}
              aria-labelledby="monitor-title"
            >
              <div className="card-heading">
                <div>
                  <span className="section-number">02</span>
                  <h2 id="monitor-title" tabIndex={-1} ref={statusRef}>
                    나의 탐색 현황
                  </h2>
                </div>
                <span className={`status-badge ${active ? "running" : ""}`}>
                  <span />
                  {statusLabel}
                </span>
              </div>
              {liveConfig.mode === "demo" && monitor && (
                <div className="demo-banner">
                  <Sparkles size={14} /> 체험 모드 · 아래 열차와 좌석은 가상
                  정보예요.
                </div>
              )}
              {!monitor ? (
                <div className="empty-state">
                  <JourneyArt />
                  <span className="small-pill">
                    <Coffee size={13} /> 기다림은 저희가 할게요
                  </span>
                  <h3>
                    당신의 다음 여행을
                    <br />
                    기다리고 있어요.
                  </h3>
                  <p>
                    왼쪽에서 여행 조건을 선택하고 탐색을 시작하세요.
                    <br />
                    취소표가 나오는 순간, 바로 알려드릴게요.
                  </p>
                  <div className="empty-route">
                    <span>{config.departure || "출발역"}</span>
                    <span className="route-dots">
                      <i />
                      <i />
                      <TrainFront size={18} />
                      <i />
                      <i />
                    </span>
                    <span>{config.arrival || "도착역"}</span>
                  </div>
                </div>
              ) : (
                <div className="active-panel">
                  <div className="route-summary">
                    <div>
                      <span className="route-date">
                        {dateText(liveConfig.date)} · 성인{" "}
                        {liveConfig.passengers}명
                      </span>
                      <h3>
                        {liveConfig.departure}
                        <ArrowRight size={22} />
                        {liveConfig.arrival}
                      </h3>
                      <p>
                        {liveConfig.startTime} – {liveConfig.endTime}
                        <span>·</span>
                        {liveConfig.trainTypes.join(" · ")}
                        <span>·</span>
                        {selectedSeat}
                      </p>
                    </div>
                    <div className={`radar ${active ? "scanning" : ""}`}>
                      <Radio size={29} />
                    </div>
                  </div>
                  <div className="stats-row">
                    <div>
                      <span>완료한 조회</span>
                      <strong>
                        {monitor.successfulChecks}
                        <small>회</small>
                      </strong>
                    </div>
                    <div>
                      <span>다음 조회</span>
                      <strong>
                        {monitor.status === "searching" ? (
                          <span className="scanning-label">
                            조회 중<span className="animated-dots">···</span>
                          </span>
                        ) : monitor.nextCheckAt ? (
                          <>
                            {countdown}
                            <small>초 후</small>
                          </>
                        ) : (
                          "—"
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>발견한 알림</span>
                      <strong
                        className={monitor.alerts.length ? "mint-text" : ""}
                      >
                        {monitor.alerts.length}
                        <small>건</small>
                      </strong>
                    </div>
                  </div>
                  <div
                    className={`connection-line ${!connected && active ? "disconnected" : ""}`}
                  >
                    {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
                    <span>
                      {!connected && active
                        ? "화면 연결이 끊겼어요. 다시 연결하는 중입니다."
                        : monitor.lastCheckedAt
                          ? `마지막 확인 ${timeText(monitor.lastCheckedAt)}`
                          : "아직 완료된 조회가 없어요."}
                    </span>
                    {connected && (
                      <span className="connection-label">실시간 연결</span>
                    )}
                  </div>
                  {monitor.error && (
                    <div className="provider-error" role="alert">
                      <strong>
                        {monitor.status === "retrying"
                          ? "연결이 잠시 지연되고 있어요"
                          : "연결을 확인해 주세요"}
                      </strong>
                      <p>{monitor.error}</p>
                      {monitor.status === "retrying" && (
                        <span>
                          {countdown}초 후 재시도 · 이전 결과는 마지막 성공
                          시점의 정보입니다.
                        </span>
                      )}
                    </div>
                  )}
                  {monitor.status === "expired" && (
                    <div className="provider-error">
                      <p>
                        선택한 출발 시간이 지났거나 화면 연결이 오래 끊겨 탐색을
                        종료했어요. 조건을 확인하고 다시 시작해 주세요.
                      </p>
                    </div>
                  )}
                  <div className="results-heading">
                    <h4>
                      탐색 중인 열차 <span>{monitor.trains.length}</span>
                    </h4>
                    <span>
                      {liveConfig.mode === "demo"
                        ? "가상 열차"
                        : "직통 열차 기준"}
                    </span>
                  </div>
                  <div className="train-results">
                    {monitor.trains.length ? (
                      monitor.trains.map((train) => {
                        const available =
                          availableSeats(train, liveConfig.seatClass).length >
                          0;
                        return (
                          <article
                            key={train.id}
                            className={`train-result ${available ? "has-seat" : ""}`}
                          >
                            <div className="train-result-top">
                              <span className="train-name">
                                <TrainFront size={14} />
                                {train.name} <b>{train.number}</b>
                              </span>
                              {available && (
                                <span className="found-label">
                                  <span /> 빈자리 발견
                                </span>
                              )}
                            </div>
                            <div className="train-schedule">
                              <strong>{train.departureTime}</strong>
                              <span className="schedule-line">
                                <ArrowRight size={16} />
                              </span>
                              <strong>{train.arrivalTime}</strong>
                              <div className="seat-states">
                                <span
                                  className={
                                    train.general === "available"
                                      ? "available"
                                      : ""
                                  }
                                >
                                  일반실 <b>{seatLabels[train.general]}</b>
                                </span>
                                <span
                                  className={
                                    train.special === "available"
                                      ? "available"
                                      : ""
                                  }
                                >
                                  특실 <b>{seatLabels[train.special]}</b>
                                </span>
                              </div>
                            </div>
                            {available && liveConfig.mode === "live" && (
                              <a
                                href={BOOKING_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="book-link"
                              >
                                코레일에서 직접 예매하기{" "}
                                <ArrowUpRight size={15} />
                              </a>
                            )}
                          </article>
                        );
                      })
                    ) : (
                      <div className="no-results">
                        <Search size={23} />
                        <p>
                          {monitor.successfulChecks
                            ? "선택한 조건에 해당하는 열차가 없어요."
                            : monitor.status === "searching"
                              ? "조건에 맞는 열차를 확인하고 있어요."
                              : "조회가 완료되면 열차가 표시됩니다."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="monitor-footer">
                <span>
                  <span className="tiny-dot" /> 이 창을 열어두면 계속 탐색해요
                </span>
                <span>자동 예매 없이, 알림만</span>
              </div>
            </section>
            <section className="notification-card">
              <div className="notification-heading">
                <div className="bell-icon">
                  <Bell size={20} />
                </div>
                <div>
                  <h3>놓치지 않도록, 알림 설정</h3>
                  <p>빈자리 소식을 가장 먼저 받아보세요.</p>
                </div>
              </div>
              <div className="notification-options">
                <div>
                  <span>
                    <Volume2 size={16} /> 소리 알림
                  </span>
                  <button
                    className={`toggle ${sound ? "on" : ""}`}
                    role="switch"
                    aria-label="소리 알림"
                    aria-checked={sound}
                    onClick={async () => {
                      const next = !sound;
                      setSound(next);
                      soundRef.current = next;
                      writeStorage("sound", next ? "on" : "off");
                      if (next) await primeAudio();
                    }}
                  >
                    <span />
                  </button>
                </div>
                <button
                  className="sound-test"
                  onClick={async () => {
                    if (await primeAudio()) {
                      playSound();
                      setNotice(
                        "알림음을 재생했어요. 기기의 음량도 확인해 주세요.",
                      );
                    }
                  }}
                >
                  {sound ? <Volume2 size={14} /> : <VolumeX size={14} />} 소리
                  테스트
                </button>
                <div className="notification-divider" />
                <div>
                  <span>
                    <Bell size={16} /> 브라우저 알림
                  </span>
                  <button
                    className={`permission-button ${notificationPermission === "granted" ? "granted" : ""}`}
                    onClick={() => void enableNotifications()}
                  >
                    {notificationPermission === "granted" ? (
                      <>
                        <Check size={13} /> 켜짐
                      </>
                    ) : notificationPermission === "denied" ? (
                      "차단됨"
                    ) : (
                      "허용하기"
                    )}
                  </button>
                </div>
              </div>
              {notice && (
                <p className="notice" role="status">
                  {notice}
                  <button
                    aria-label="안내 닫기"
                    onClick={() => setNotice(null)}
                  >
                    <X size={14} />
                  </button>
                </p>
              )}
            </section>
            {monitor?.alerts.length ? (
              <section className="history-card">
                <div className="history-heading">
                  <h3>
                    <BellRing size={16} /> 발견 기록
                  </h3>
                  <span>최근 50건까지</span>
                </div>
                {monitor.alerts.slice(0, 5).map((alert) => (
                  <button
                    key={alert.id}
                    className="history-row"
                    onClick={() => setPopup(alert)}
                  >
                    <span className="history-dot" />
                    <span>
                      <strong>
                        {alert.train.name} {alert.train.number} ·{" "}
                        {alert.train.departureTime}
                      </strong>
                      <small>{alert.seats.join(" · ")} 발견</small>
                    </span>
                    <time>{timeText(alert.foundAt)}</time>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </section>
            ) : (
              <div className="little-note">
                <Sparkles size={17} />
                <p>
                  취소표는 예고 없이 찾아와요.
                  <br />
                  <strong>반복 확인은 빈자리에 맡겨두세요.</strong>
                </p>
                <span className="note-line" />
              </div>
            )}
            {editable && (
              <button
                className="demo-button"
                disabled={busy}
                onClick={() => void start("demo")}
              >
                <Play size={13} /> 알림이 어떻게 오는지 궁금하다면{" "}
                <span>
                  체험해 보기 <ArrowRight size={13} />
                </span>
              </button>
            )}
          </div>
        </div>
        <footer className="site-footer">
          <span>
            <TrainFront size={14} /> 빈자리와 함께, 가벼운 기다림.
          </span>
          <p>
            좌석은 발견 후에도 매진될 수 있어요. 실제 예매 가능 여부는
            코레일에서 확인해 주세요.
          </p>
          <span className="footer-small">개인용 좌석 알리미 · KST</span>
        </footer>
      </main>
      {popup && (
        <div className="modal-backdrop" onClick={() => setPopup(null)}>
          <section
            className="alert-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPopup(null);
              if (e.key === "Tab") {
                const elements =
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button, a[href]",
                  );
                const first = elements[0],
                  last = elements[elements.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              ref={popupCloseRef}
              className="modal-close"
              aria-label="알림 닫기"
              onClick={() => setPopup(null)}
            >
              <X size={20} />
            </button>
            <div className="alert-bell">
              <BellRing size={31} />
            </div>
            <span className="eyebrow">
              {liveConfig.mode === "demo"
                ? "DEMO NOTIFICATION"
                : "YOUR SEAT IS HERE"}
            </span>
            <h2 id="alert-title">
              {liveConfig.mode === "demo"
                ? "이렇게 알려드려요!"
                : "빈자리를 찾았어요!"}
            </h2>
            <p>
              {liveConfig.mode === "demo"
                ? "알림 체험용 가상 좌석입니다."
                : "기다리던 여행, 지금 확인해 보세요."}
            </p>
            <div className="alert-ticket">
              <span>
                {dateText(popup.train.date)} · {popup.train.name}{" "}
                {popup.train.number}
              </span>
              <h3>
                {popup.train.departure} <ArrowRight size={19} />{" "}
                {popup.train.arrival}
              </h3>
              <strong>{popup.train.departureTime} 출발</strong>
              <div>
                {popup.seats.map((s) => (
                  <span key={s}>
                    <Check size={13} />
                    {s} 좌석 발견
                  </span>
                ))}
              </div>
            </div>
            <p className="alert-found-time">
              {timeText(popup.foundAt)} 발견 · 현재 상태는 달라질 수 있어요.
            </p>
            {liveConfig.mode === "live" ? (
              <a
                className="start-button"
                href={BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                코레일에서 예매하기 <ExternalLink size={17} />
              </a>
            ) : (
              <button className="start-button" onClick={() => setPopup(null)}>
                확인했어요 <Check size={17} />
              </button>
            )}
            <button className="continue-button" onClick={() => setPopup(null)}>
              닫고 탐색 화면 보기
            </button>
          </section>
        </div>
      )}
      {showGuide && (
        <div className="modal-backdrop" onClick={() => setShowGuide(false)}>
          <section
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowGuide(false);
              if (e.key === "Tab") {
                e.preventDefault();
                e.currentTarget.querySelector("button")?.focus();
              }
            }}
          >
            <button
              autoFocus
              className="modal-close"
              aria-label="이용 안내 닫기"
              onClick={() => setShowGuide(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">HOW IT WORKS</span>
            <h2 id="guide-title">기다리는 방법은 간단해요.</h2>
            <ol>
              <li>
                <strong>원하는 여정을 선택하세요.</strong>
                <p>역, 날짜, 시간대와 좌석 등급을 고르고 조회 간격을 정해요.</p>
              </li>
              <li>
                <strong>탐색을 시작하고 창을 열어두세요.</strong>
                <p>
                  다른 탭을 보고 있어도 연결이 유지되면 서버에서 계속 확인해요.
                  오류가 나면 간격을 늘려 재시도합니다.
                </p>
              </li>
              <li>
                <strong>알림이 오면 코레일에서 예매하세요.</strong>
                <p>
                  좌석이 생기면 화면과 소리로 알려드려요. 좌석 확보와 결제는
                  코레일에서 직접 해주세요.
                </p>
              </li>
            </ol>
            <div className="guide-note">
              창을 모두 닫으면 연결 종료 후 약 90초와 현재 조회 주기 이내에
              탐색이 끝나요. 기기가 절전 상태이면 알림이 늦어질 수 있어요.
              새로고침 후에는 소리 테스트로 알림음을 다시 켜주세요. 탐색 조건과
              세션은 이 브라우저에 저장되며, 서버 재시작 시 탐색을 다시 시작해야
              해요.
            </div>
          </section>
        </div>
      )}
    </>
  );
}
