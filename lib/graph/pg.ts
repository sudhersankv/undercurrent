import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema, withRetry } from "@/lib/db";
import { edgeId, type EdgeInput, type EdgeType, type GraphClient, type GraphEdge, type GraphNode, type NeighborQuery } from "./types";

const { graphNodes: N, graphEdges: E } = schema;

type NodeRow = typeof N.$inferSelect;
type EdgeRow = typeof E.$inferSelect;

const toNode = (r: NodeRow): GraphNode => ({ runId: r.runId, id: r.id, label: r.label as GraphNode["label"], props: r.props as Record<string, unknown> });
const toEdge = (r: EdgeRow): GraphEdge => ({
  runId: r.runId,
  id: r.id,
  type: r.type as EdgeType,
  from: r.fromId,
  to: r.toId,
  props: r.props as Record<string, unknown>,
});

/** Postgres-backed GraphClient over graph_nodes / graph_edges. Upserts merge props (jsonb ||). */
export class PgGraph implements GraphClient {
  constructor(private db: Db) {}

  async upsertNode(n: GraphNode) {
    await this.upsertNodes([n]);
  }

  async upsertNodes(ns: GraphNode[]) {
    if (!ns.length) return;
    await withRetry(() =>
      this.db
        .insert(N)
        .values(ns.map((n) => ({ runId: n.runId, id: n.id, label: n.label, props: n.props })))
        .onConflictDoUpdate({
          target: [N.runId, N.id],
          set: { label: sql`excluded.label`, props: sql`${N.props} || excluded.props`, updatedAt: sql`now()` },
        }),
    );
  }

  async upsertEdge(e: EdgeInput) {
    return (await this.upsertEdges([e]))[0];
  }

  async upsertEdges(es: EdgeInput[]) {
    if (!es.length) return [];
    const rows = es.map((e) => ({
      runId: e.runId,
      id: e.id ?? edgeId(e.type, e.from, e.to),
      type: e.type,
      fromId: e.from,
      toId: e.to,
      props: e.props,
      weight: typeof e.props.strength === "number" ? e.props.strength : null,
    }));
    await withRetry(() =>
      this.db
        .insert(E)
        .values(rows)
        .onConflictDoUpdate({ target: [E.runId, E.id], set: { props: sql`${E.props} || excluded.props`, updatedAt: sql`now()` } }),
    );
    return rows.map((r) => r.id);
  }

  async getNode(runId: string, id: string) {
    const r = await this.db.select().from(N).where(and(eq(N.runId, runId), eq(N.id, id))).limit(1);
    return r[0] ? toNode(r[0]) : null;
  }

  async nodesByLabel(runId: string, label: GraphNode["label"]) {
    return (await this.db.select().from(N).where(and(eq(N.runId, runId), eq(N.label, label)))).map(toNode);
  }

  async edgesFrom(runId: string, id: string, types?: EdgeType[]) {
    const conds = [eq(E.runId, runId), eq(E.fromId, id)];
    if (types?.length) conds.push(inArray(E.type, types));
    return (await this.db.select().from(E).where(and(...conds))).map(toEdge);
  }

  async edgesTo(runId: string, id: string, types?: EdgeType[]) {
    const conds = [eq(E.runId, runId), eq(E.toId, id)];
    if (types?.length) conds.push(inArray(E.type, types));
    return (await this.db.select().from(E).where(and(...conds))).map(toEdge);
  }

  async neighbors(runId: string, id: string, q: NeighborQuery = {}) {
    const dir = q.direction ?? "both";
    const conds = [eq(E.runId, runId)];
    if (q.types?.length) conds.push(inArray(E.type, q.types));
    const side = dir === "out" ? eq(E.fromId, id) : dir === "in" ? eq(E.toId, id) : or(eq(E.fromId, id), eq(E.toId, id))!;
    const edges = await this.db.select().from(E).where(and(...conds, side));
    const ids = [...new Set(edges.map((e) => (e.fromId === id ? e.toId : e.fromId)))];
    if (!ids.length) return [];
    const nconds = [eq(N.runId, runId), inArray(N.id, ids)];
    if (q.labels?.length) nconds.push(inArray(N.label, q.labels));
    return (await this.db.select().from(N).where(and(...nconds))).map(toNode);
  }

  async runGraph(runId: string) {
    const [nodes, edges] = await Promise.all([
      this.db.select().from(N).where(eq(N.runId, runId)),
      this.db.select().from(E).where(eq(E.runId, runId)),
    ]);
    return { nodes: nodes.map(toNode), edges: edges.map(toEdge) };
  }

  /** Recursive CTE over undirected edges (SPEC §7.4 warm paths). */
  async paths(runId: string, fromIds: string[], toId: string, opts: { types?: EdgeType[]; maxHops?: number; limit?: number } = {}) {
    if (!fromIds.length) return [];
    const maxHops = opts.maxHops ?? 3;
    const limit = opts.limit ?? 3;
    const typeFilter = opts.types?.length ? sql`and type in (${sql.join(opts.types.map((t) => sql`${t}`), sql`, `)})` : sql``;
    const res = await this.db.execute(sql`
      with recursive und as (
        select from_id as a, to_id as b from graph_edges where run_id = ${runId} ${typeFilter}
        union all
        select to_id as a, from_id as b from graph_edges where run_id = ${runId} ${typeFilter}
      ),
      walk(node, path, depth) as (
        select b, array[a, b]::text[], 1 from und where a in (${sql.join(fromIds.map((f) => sql`${f}`), sql`, `)})
        union all
        select und.b, walk.path || und.b, walk.depth + 1
        from walk join und on und.a = walk.node
        where walk.depth < ${maxHops} and not (und.b = any(walk.path)) and walk.node <> ${toId}
      )
      select path from walk where node = ${toId} order by depth limit ${limit}
    `);
    return (res.rows as { path: string[] }[]).map((r) => r.path);
  }
}
