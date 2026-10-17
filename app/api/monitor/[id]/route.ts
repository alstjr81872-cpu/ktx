import { checkOrigin, jsonError } from "@/lib/http";
import { parseConfig } from "@/lib/config";
import { getMonitor, restoreMonitor } from "@/lib/monitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  const monitor = getMonitor((await context.params).id);
  return monitor
    ? Response.json(monitor.snapshot())
    : jsonError(
        "탐색이 종료되었거나 서버가 재시작되었습니다. 다시 시작해 주세요.",
        404,
      );
}
export async function PATCH(request: Request, context: Context) {
  try {
    checkOrigin(request);
  } catch {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  const monitor = getMonitor((await context.params).id);
  if (!monitor)
    return jsonError("탐색을 찾을 수 없습니다. 다시 시작해 주세요.", 404);
  try {
    const { action } = await request.json();
    if (["expired", "stopped"].includes(monitor.snapshot().status))
      return jsonError("종료된 탐색입니다. 새 탐색을 시작해 주세요.", 409);
    if (action === "pause") monitor.pause();
    else if (action === "resume") monitor.resume();
    else if (action === "stop") monitor.stop();
    else return jsonError("알 수 없는 요청입니다.");
    return Response.json(monitor.snapshot());
  } catch {
    return jsonError("요청을 확인해 주세요.");
  }
}

export async function PUT(request: Request, context: Context) {
  try { checkOrigin(request); } catch { return jsonError("허용되지 않은 요청입니다.", 403); }
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    return jsonError("올바르지 않은 탐색 ID입니다.");
  try {
    const body = await request.json();
    const config = parseConfig(body.config);
    if (typeof body.paused !== "boolean") return jsonError("복구 상태를 확인해 주세요.");
    try {
      return Response.json(restoreMonitor(id, config, body.paused).snapshot());
    } catch (e) { return jsonError(e instanceof Error ? e.message : "복구하지 못했습니다.", 409); }
  } catch (e) { return jsonError(e instanceof Error ? e.message : "조건을 확인해 주세요."); }
}
