import { ReportBody, generateSegmentReport } from "@/lib/departments/pilot/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reports/:segmentId → markdown segment report (SPEC §5.4 "Generate detailed report").
 * Data: optional JSON body { segment, evidence?, leads?, briefs?, companyName?, competitors? },
 * else the run's Pilot/Sounding memory, else Postgres.
 * `?format=json` → { segmentId, markdown }. `?narrative=0` skips the LLM summary.
 */
export async function POST(req: Request, ctx: { params: Promise<{ segmentId: string }> }) {
  const { segmentId } = await ctx.params;
  const url = new URL(req.url);

  let body = null;
  const text = await req.text().catch(() => "");
  if (text.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const parsed = ReportBody.safeParse(json);
    if (parsed.success) body = parsed.data;
    else if (json && typeof json === "object" && "segment" in json) {
      return Response.json({ error: "Invalid report body", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
    }
  }

  try {
    const markdown = await generateSegmentReport(segmentId, body, { narrative: url.searchParams.get("narrative") !== "0" });
    if (!markdown) return Response.json({ error: `No data for segment ${segmentId}` }, { status: 404 });
    if (url.searchParams.get("format") === "json") return Response.json({ segmentId, markdown });
    return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch (err) {
    return Response.json({ error: "Report failed", detail: String(err).slice(0, 300) }, { status: 500 });
  }
}
