/** Undercurrent Chart (SPEC §7, AMENDMENTS: Postgres tables instead of Neo4j). */

export type NodeLabel =
  | "Company"
  | "Product"
  | "Capability"
  | "Competitor"
  | "Segment"
  | "Persona"
  | "Evidence"
  | "Person"
  | "Repo"
  | "Tech"
  | "Draft"
  | "Outcome";

export type EdgeType =
  | "MAKES"
  | "HAS_CAPABILITY"
  | "COMPETES_WITH"
  | "CHILD_OF"
  | "SOLVED_BY"
  | "MEMBER_OF"
  | "REACTED"
  | "SUPPORTS"
  | "CONTRADICTS"
  | "MENTIONS"
  | "AUTHORED"
  | "OWNS"
  | "USES"
  | "WORKS_AT"
  | "PREVIOUSLY_AT"
  | "MATCHED_TO"
  | "REFERRED_BY"
  | "EVIDENCE_OF"
  | "TO"
  | "REPLY_TO";

export interface GraphNode {
  runId: string;
  id: string;
  label: NodeLabel;
  props: Record<string, unknown>;
}

export interface GraphEdge {
  runId: string;
  /** Deterministic: `${type}:${from}->${to}` (see edgeId). */
  id: string;
  type: EdgeType;
  from: string;
  to: string;
  props: Record<string, unknown>;
}

export type EdgeInput = Omit<GraphEdge, "id"> & { id?: string };

export interface NeighborQuery {
  types?: EdgeType[];
  direction?: "out" | "in" | "both";
  labels?: NodeLabel[];
}

/**
 * Graph client. All writes are idempotent upserts (MERGE semantics: props are shallow-merged).
 * Postgres is the source of truth for UI lists; graph failures should become warning events, not crashes.
 */
export interface GraphClient {
  upsertNode(n: GraphNode): Promise<void>;
  upsertNodes(ns: GraphNode[]): Promise<void>;
  /** Returns the edge id. */
  upsertEdge(e: EdgeInput): Promise<string>;
  upsertEdges(es: EdgeInput[]): Promise<string[]>;

  getNode(runId: string, id: string): Promise<GraphNode | null>;
  nodesByLabel(runId: string, label: NodeLabel): Promise<GraphNode[]>;
  edgesFrom(runId: string, id: string, types?: EdgeType[]): Promise<GraphEdge[]>;
  edgesTo(runId: string, id: string, types?: EdgeType[]): Promise<GraphEdge[]>;
  neighbors(runId: string, id: string, q?: NeighborQuery): Promise<GraphNode[]>;
  /** Whole run graph (Chart view). */
  runGraph(runId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  /** Shortest undirected paths (≤ maxHops) between `fromIds` and `toId` over the given edge types (warm paths). */
  paths(runId: string, fromIds: string[], toId: string, opts?: { types?: EdgeType[]; maxHops?: number; limit?: number }): Promise<string[][]>;
}

export function edgeId(type: EdgeType, from: string, to: string): string {
  return `${type}:${from}->${to}`;
}
