import {
  localRehearsalEnabled,
  readLocalReport,
} from "../../../../../../integrations/aqua/local-rehearsal";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!localRehearsalEnabled(request))
    return new Response("Local reports are disabled.", { status: 403 });
  try {
    return new Response(
      await readLocalReport(
        new URL(request.url).searchParams.get("runId") ?? "",
      ),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
      },
    );
  } catch {
    return new Response("Report not found.", { status: 404 });
  }
}
