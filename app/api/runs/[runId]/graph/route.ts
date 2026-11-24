import { getGraph } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs/:runId/graph → { nodes, edges } for the Chart view. Graph errors return an empty graph, not a 500. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const { nodes, edges } = await getGraph().runGraph(runId);
    return Response.json({ runId, nodes, edges });
  } catch (e) {
    console.warn("[graph] runGraph failed", e);
    return Response.json({ runId, nodes: [], edges: [], error: "graph unavailable" });
  }
}
