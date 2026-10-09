import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

export class KorailBridgeError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}
type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};
type Options = {
  python?: string;
  script?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

/** One persistent, read-only worker per app process, preserving the signer session. */
export class KorailBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: Options = {}) {}

  private start() {
    if (this.child) return this.child;
    const python =
      this.options.python ??
      process.env.KORAIL_PYTHON ??
      path.join(
        process.cwd(),
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
    const script =
      this.options.script ??
      path.join(process.cwd(), "scripts", "korail-worker.py");
    // No shell and no network credentials in arguments. Environment proxy settings pass through.
    const child = spawn(python, ["-u", script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env ?? process.env,
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (this.child !== child) return;
      try {
        if (line.length > 2_000_000)
          throw new Error("Oversized worker response");
        const result = JSON.parse(line);
        if (result.type === "ready") {
          if (result.protocol !== 1)
            throw new Error("Unsupported worker protocol");
          return;
        }
        if (result.type === "fatal") {
          this.close(new KorailBridgeError(String(result.message), false));
          return;
        }
        const pending = this.pending.get(result.id);
        if (!pending) return;
        this.pending.delete(result.id);
        pending.cleanup();
        if (result.ok === true) pending.resolve(result.data);
        else if (result.kind === "http") {
          const status = Number(result.status);
          pending.reject(
            new KorailBridgeError(
              status === 401 || status === 403
                ? "코레일에서 접속을 제한해 탐색을 멈췄습니다. 잠시 후 연결을 확인해 주세요."
                : status === 429
                  ? "코레일의 조회 요청 제한으로 간격을 늘려 다시 시도합니다."
                  : `코레일 연결이 지연되고 있습니다. (${status})`,
              status !== 401 && status !== 403,
            ),
          );
        } else
          pending.reject(
            new KorailBridgeError(
              String(result.message ?? "코레일 연결에 실패했습니다."),
              result.kind !== "setup",
            ),
          );
        if (!this.pending.size) {
          this.idleTimer = setTimeout(() => this.close(), 120000);
          this.idleTimer.unref();
        }
      } catch {
        this.close(
          new KorailBridgeError(
            "코레일 연결 모듈의 응답을 읽지 못했습니다.",
            false,
          ),
        );
      }
    });
    // Drain but never log worker stderr, which could contain request context.
    child.stderr.resume();
    child.stdin.on("error", () => {
      if (this.child === child)
        this.close(
          new KorailBridgeError(
            "코레일 연결 모듈이 종료되었습니다. 다시 연결합니다.",
            true,
          ),
        );
    });
    child.once("error", () => {
      if (this.child === child)
        this.close(
          new KorailBridgeError(
            "코레일 연결 모듈을 실행할 수 없습니다. npm run setup:korail을 실행해 주세요.",
            false,
          ),
        );
    });
    child.once("exit", () => {
      lines.close();
      if (this.child === child)
        this.close(
          new KorailBridgeError(
            "코레일 연결 모듈이 종료되었습니다. 다시 연결합니다.",
            true,
          ),
        );
    });
    return child;
  }

  request(params: URLSearchParams, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    clearTimeout(this.idleTimer);
    const child = this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const aborted = () =>
        this.close(new DOMException("The search was aborted", "AbortError"));
      const timer = setTimeout(
        () =>
          this.close(
            new KorailBridgeError(
              "코레일 조회 시간이 초과되었습니다. 간격을 늘려 다시 시도합니다.",
              true,
            ),
          ),
        this.options.timeoutMs ?? 18000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      child.stdin.write(
        JSON.stringify({
          id,
          operation: "search",
          params: Object.fromEntries(params),
        }) + "\n",
      );
    });
  }

  close(
    error: Error = new KorailBridgeError("코레일 연결이 종료되었습니다.", true),
  ) {
    const child = this.child;
    this.child = null;
    clearTimeout(this.idleTimer);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    if (child) {
      child.stdin.destroy();
      child.kill("SIGTERM");
    }
  }
}

const registry = globalThis as typeof globalThis & {
  korailBridge?: KorailBridge;
};
export function getKorailBridge() {
  return (registry.korailBridge ??= new KorailBridge());
}
