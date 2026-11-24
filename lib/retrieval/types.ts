/** Retrieval interface (SPEC §3.5 + AMENDMENTS). Callers never import the Moss SDK directly. */

export type RetrievalKind = "corpus" | "evidence" | "segment" | "persona" | "project" | "voice";

export interface RetrievalMeta {
  runId: string;
  kind: RetrievalKind;
  leadId?: string;
  /** Optional extras (segmentId, url, source...). Filterable only on runId/kind/leadId. */
  [key: string]: string | undefined;
}

export interface RetrievalDoc {
  /** Stable id (e.g. evidence id, url hash). Re-adding the same id replaces it. */
  id: string;
  text: string;
  metadata: RetrievalMeta;
}

/** Equality filters (Moss `$eq`). `kind` may be a list (OR). */
export interface RetrievalFilter {
  runId: string;
  kind?: RetrievalKind | RetrievalKind[];
  leadId?: string;
}

export interface RetrievalHit {
  id: string;
  text: string;
  score: number;
  metadata: RetrievalMeta;
}

export interface RetrievalStats {
  backend: "moss" | "memory";
  p50Ms: number;
  count: number;
}

export interface Retrieval {
  add(docs: RetrievalDoc[]): Promise<void>;
  query(text: string, k: number, filter: RetrievalFilter): Promise<RetrievalHit[]>;
  stats(): RetrievalStats;
}
