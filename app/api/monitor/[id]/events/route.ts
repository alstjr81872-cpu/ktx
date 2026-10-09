import { getMonitor } from "@/lib/monitor";
import { jsonError } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const monitor = getMonitor((await context.params).id);
  if (!monitor) return jsonError("탐색을 찾을 수 없습니다.", 404);
  let cleanup = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = monitor.subscribe((snapshot) =>
        send(`data: ${JSON.stringify(snapshot)}\n\n`),
      );
      const heartbeat = setInterval(() => {
        monitor.touch();
        send(": keep-alive\n\n");
      }, 15000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      send(`data: ${JSON.stringify(monitor.snapshot())}\n\n`);
      if (request.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
