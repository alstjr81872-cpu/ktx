export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host"))
    throw new Error("허용되지 않은 요청입니다.");
}
export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
