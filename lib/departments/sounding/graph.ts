import type { Evidence, SegmentHypothesis } from "@/lib/contracts";
import type { EdgeInput, GraphNode } from "@/lib/graph/types";
import type { DeptContext } from "../shared/types";
import { ghPersonId, hnPersonId, parseGithubUrl, repoNodeId } from "./ids";

/** SPEC §5.3 graph writes. Returns the node ids touched (chart trace mode). Failures → warning event. */
export async function writeSoundingGraph(ctx: DeptContext, segment: SegmentHypothesis, evidence: Evidence[]): Promise<string[]> {
  const runId = ctx.runId;
  const nodes: GraphNode[] = [
    {
      runId,
      id: segment.id,
      label: "Segment",
      props: {
        name: segment.name,
        domain: segment.domain,
        origin: segment.origin,
        round: segment.round,
        simInterest: segment.simInterest,
        evidenceStrength: segment.evidenceStrength,
        verdict: segment.verdict,
      },
    },
  ];
  const edges: EdgeInput[] = [];
  for (const e of evidence) {
    nodes.push({
      runId,
      id: e.id,
      label: "Evidence",
      props: { url: e.url, source: e.source, type: e.type, stance: e.stance, strength: e.strength, quote: e.quote, title: e.title, createdAt: e.createdAt },
    });
    if (e.stance !== "neutral") {
      edges.push({ runId, type: e.stance === "supports" ? "SUPPORTS" : "CONTRADICTS", from: e.id, to: segment.id, props: { strength: e.strength } });
    }
    const isGh = e.source === "github_issue" || e.source === "github_repo";
    const isHn = e.source === "hn_comment" || e.source === "hn_story";
    if (e.author && (isGh || isHn)) {
      const pid = isGh ? ghPersonId(runId, e.author) : hnPersonId(runId, e.author);
      nodes.push({
        runId,
        id: pid,
        label: "Person",
        props: isGh ? { displayName: e.author, githubLogin: e.author } : { displayName: e.author, hnHandle: e.author },
      });
      edges.push({ runId, type: "AUTHORED", from: pid, to: e.id, props: {} });
    }
    if (isGh) {
      const gh = parseGithubUrl(e.url);
      if (gh?.repo) {
        const fullName = `${gh.owner}/${gh.repo}`;
        const rid = repoNodeId(runId, fullName);
        const ownerId = ghPersonId(runId, gh.owner);
        nodes.push({ runId, id: rid, label: "Repo", props: { fullName, ...(e.source === "github_repo" && e.metrics?.stars != null ? { stars: e.metrics.stars } : {}) } });
        nodes.push({ runId, id: ownerId, label: "Person", props: { displayName: gh.owner, githubLogin: gh.owner } });
        edges.push({ runId, type: "OWNS", from: ownerId, to: rid, props: {} });
        if (e.stance === "supports") edges.push({ runId, type: "EVIDENCE_OF", from: rid, to: segment.id, props: {} });
      }
    }
  }
  try {
    await ctx.graph.upsertNodes(nodes);
    await ctx.graph.upsertEdges(edges);
  } catch (err) {
    ctx.emit({
      dept: "sounding",
      type: "sounding.graph_failed",
      level: "warning",
      message: `Chart write failed for ${segment.name}`,
      payload: { segmentId: segment.id, error: String(err).slice(0, 200) },
    });
  }
  return [...new Set(nodes.map((n) => n.id))];
}
