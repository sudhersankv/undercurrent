import type { EdgeType, GraphEdge, GraphNode, NodeLabel } from "@/lib/graph/types";
import type { RunStore } from "@/lib/client/run-store";

/** Node colors by label, all drawn from the forest + lichen token palette. */
export const LABEL_COLOR: Record<NodeLabel, string> = {
  Company: "#F4FAF5", // text-strong
  Product: "#F4FAF5",
  Capability: "#CFF5D6", // cta-via
  Competitor: "#D9A08F", // danger / hype
  Segment: "#D8F5A2", // lichen
  Persona: "#6F7F74", // muted
  Evidence: "#E9DDB0", // promising
  Person: "#F1E6FF", // cta-to
  Repo: "#B3C4B8", // text-body
  Tech: "#B3C4B8",
  Draft: "#2E7D4F", // cta-from
  Outcome: "#D8F5A2",
};

export const LABEL_SIZE: Partial<Record<NodeLabel, number>> = { Company: 7, Segment: 6, Person: 4.5, Capability: 4.5, Competitor: 4, Evidence: 3, Persona: 2.5 };

/**
 * Mirrors what departments write to graph_nodes/edges, derived from the event stream.
 * Lets the Chart work before (or without) a graph-writing backend, e.g. the fake run. Ids match `payload.nodeIds`.
 */
export function deriveGraph(s: RunStore): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const runId = s.runId;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (id: string, label: NodeLabel, props: Record<string, unknown>) => nodes.set(id, { runId, id, label, props: { ...(nodes.get(id)?.props ?? {}), ...props } });
  const edge = (type: EdgeType, from: string, to: string, props: Record<string, unknown> = {}) => {
    const id = `${type}:${from}->${to}`;
    edges.set(id, { runId, id, type, from, to, props });
  };

  const companyId = `${runId}-company`;
  if (s.profile) {
    node(companyId, "Company", { name: s.profile.name, url: s.profile.url ?? undefined, oneLiner: s.profile.oneLiner });
    for (const c of s.profile.capabilities) {
      node(c.id, "Capability", { name: c.statement, confidence: c.confidence, url: c.sourceUrls[0] });
      edge("HAS_CAPABILITY", companyId, c.id);
    }
    for (const c of s.profile.competitors) {
      node(c.id, "Competitor", { name: c.name, kind: c.kind, url: c.url, positioning: c.positioning });
      edge("COMPETES_WITH", companyId, c.id);
    }
  }
  for (const seg of Object.values(s.segments)) {
    node(seg.id, "Segment", { name: seg.name, verdict: seg.verdict, simInterest: seg.simInterest, evidenceStrength: seg.evidenceStrength, round: seg.round, origin: seg.origin });
    if (seg.mechanism?.capabilityId && nodes.has(seg.mechanism.capabilityId)) edge("SOLVED_BY", seg.id, seg.mechanism.capabilityId);
    if (seg.parentId) edge("CHILD_OF", seg.id, seg.parentId);
  }
  for (const p of Object.values(s.personas)) {
    node(p.id, "Persona", { name: p.label, simulated: true });
    edge("MEMBER_OF", p.id, p.segmentId);
  }
  for (const list of Object.values(s.evidence))
    for (const e of list) {
      node(e.id, "Evidence", { name: e.title, url: e.url, source: e.source, stance: e.stance, quote: e.quote });
      edge(e.stance === "contradicts" ? "CONTRADICTS" : "SUPPORTS", e.id, e.segmentId);
    }
  for (const l of Object.values(s.leads)) {
    node(l.personId, "Person", { name: l.displayName, github: l.handles.github, fitScore: l.fitScore, tier: l.tier, leadId: l.id });
    edge("MATCHED_TO", l.personId, l.segmentId);
    if (l.primaryRepo) {
      const rid = `${runId}-repo-${l.primaryRepo}`;
      node(rid, "Repo", { name: l.primaryRepo, url: `https://github.com/${l.primaryRepo}` });
      edge("OWNS", l.personId, rid);
    }
  }
  const personOfLead = (leadId: string) => s.leads[leadId]?.personId;
  for (const d of Object.values(s.drafts)) {
    node(d.id, "Draft", { name: `Draft · ${s.leads[d.leadId]?.displayName ?? d.leadId}`, status: d.status, channel: d.channel });
    const pid = personOfLead(d.leadId);
    if (pid) edge("TO", d.id, pid);
  }
  for (const r of s.replies) {
    const id = `${runId}-outcome-${r.draftId}`;
    node(id, "Outcome", { name: `Reply · ${r.intent}`, intent: r.intent, summary: r.summary });
    if (nodes.has(r.draftId)) edge("REPLY_TO", id, r.draftId);
  }
  for (const e of s.events) {
    if (e.type !== "wake.referral_created") continue;
    const p = e.payload as { fromLeadId: string; lead: { personId: string } };
    const from = personOfLead(p.fromLeadId);
    if (from) edge("REFERRED_BY", p.lead.personId, from);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Server graph wins on props; derived fills gaps. Edges to missing nodes are dropped. */
export function mergeGraphs(a: { nodes: GraphNode[]; edges: GraphEdge[] }, b: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const nodes = new Map<string, GraphNode>();
  for (const n of [...b.nodes, ...a.nodes]) nodes.set(n.id, { ...n, props: { ...(nodes.get(n.id)?.props ?? {}), ...n.props } });
  const edges = new Map<string, GraphEdge>();
  for (const e of [...b.edges, ...a.edges]) if (nodes.has(e.from) && nodes.has(e.to)) edges.set(e.id, e);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
