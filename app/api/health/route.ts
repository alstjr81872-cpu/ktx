export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    status: "ok",
    app: "seat-watch",
    provider: "korail",
    scope: "application-only",
  });
}
