import { edgeId, type EdgeInput, type EdgeType, type GraphClient, type GraphEdge, type GraphNode, type NeighborQuery } from "./types";

/** In-memory GraphClient (tests, no-DB dev). Same semantics as the Postgres one. */
export class MemoryGraph implements GraphClient {
  nodes = new Map<string, GraphNode>(); // key runId|id
  edges = new Map<string, GraphEdge>();

  private k(runId: string, id: string) {
    return `${runId}|${id}`;
  }

  async upsertNode(n: GraphNode) {
    const key = this.k(n.runId, n.id);
    const prev = this.nodes.get(key);
    this.nodes.set(key, { ...n, props: { ...(prev?.props ?? {}), ...n.props } });
  }
  async upsertNodes(ns: GraphNode[]) {
    for (const n of ns) await this.upsertNode(n);
  }
  async upsertEdge(e: EdgeInput) {
    const id = e.id ?? edgeId(e.type, e.from, e.to);
    const key = this.k(e.runId, id);
    const prev = this.edges.get(key);
    this.edges.set(key, { ...e, id, props: { ...(prev?.props ?? {}), ...e.props } });
    return id;
  }
  async upsertEdges(es: EdgeInput[]) {
    const ids: string[] = [];
    for (const e of es) ids.push(await this.upsertEdge(e));
    return ids;
  }
  async getNode(runId: string, id: string) {
    return this.nodes.get(this.k(runId, id)) ?? null;
  }
  async nodesByLabel(runId: string, label: GraphNode["label"]) {
    return [...this.nodes.values()].filter((n) => n.runId === runId && n.label === label);
  }
  private runEdges(runId: string) {
    return [...this.edges.values()].filter((e) => e.runId === runId);
  }
  async edgesFrom(runId: string, id: string, types?: EdgeType[]) {
    return this.runEdges(runId).filter((e) => e.from === id && (!types || types.includes(e.type)));
  }
  async edgesTo(runId: string, id: string, types?: EdgeType[]) {
    return this.runEdges(runId).filter((e) => e.to === id && (!types || types.includes(e.type)));
  }
  async neighbors(runId: string, id: string, q: NeighborQuery = {}) {
    const dir = q.direction ?? "both";
    const ids = new Set<string>();
    if (dir !== "in") (await this.edgesFrom(runId, id, q.types)).forEach((e) => ids.add(e.to));
    if (dir !== "out") (await this.edgesTo(runId, id, q.types)).forEach((e) => ids.add(e.from));
    const out: GraphNode[] = [];
    for (const nid of ids) {
      const n = await this.getNode(runId, nid);
      if (n && (!q.labels || q.labels.includes(n.label))) out.push(n);
    }
    return out;
  }
  async runGraph(runId: string) {
    return { nodes: [...this.nodes.values()].filter((n) => n.runId === runId), edges: this.runEdges(runId) };
  }
  async paths(runId: string, fromIds: string[], toId: string, opts: { types?: EdgeType[]; maxHops?: number; limit?: number } = {}) {
    const maxHops = opts.maxHops ?? 3;
    const limit = opts.limit ?? 3;
    const edges = this.runEdges(runId).filter((e) => !opts.types || opts.types.includes(e.type));
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
      adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
    }
    const results: string[][] = [];
    for (const start of fromIds) {
      const queue: string[][] = [[start]];
      const seen = new Set([start]);
      while (queue.length) {
        const p = queue.shift()!;
        const last = p[p.length - 1];
        if (last === toId) {
          results.push(p);
          break;
        }
        if (p.length - 1 >= maxHops) continue;
        for (const nx of adj.get(last) ?? []) {
          if (seen.has(nx)) continue;
          seen.add(nx);
          queue.push([...p, nx]);
        }
      }
    }
    return results.sort((a, b) => a.length - b.length).slice(0, limit);
  }
}
