import { parseConfig } from "@/lib/config";
import { checkOrigin, jsonError } from "@/lib/http";
import { startMonitor } from "@/lib/monitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
  } catch {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }
  try {
    const config = parseConfig(await request.json());
    try {
      return Response.json(startMonitor(config).snapshot(), { status: 201 });
    } catch (e) {
      return jsonError(
        e instanceof Error ? e.message : "탐색을 시작하지 못했습니다.",
        409,
      );
    }
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "조건을 확인해 주세요.");
  }
}
