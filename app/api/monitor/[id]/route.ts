import { checkOrigin, jsonError } from "@/lib/http";
import { getMonitor } from "@/lib/monitor";
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
