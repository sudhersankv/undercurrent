import { bigserial, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// SPEC §14 + AMENDMENTS (graph_nodes / graph_edges replace Neo4j). jsonb for every json column, timestamptz for times.

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  companyUrl: text("company_url"),
  companyName: text("company_name"),
  state: text("state").notNull().default("INTAKE"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  intake: jsonb("intake").notNull(),
  profile: jsonb("profile"),
  calibration: jsonb("calibration"),
  error: text("error"),
});

export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    round: integer("round").notNull(),
    parentId: text("parent_id"),
    json: jsonb("json").notNull(),
  },
  (t) => [index("segments_run_idx").on(t.runId)],
);

export const personas = pgTable(
  "personas",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    segmentId: text("segment_id").notNull(),
    json: jsonb("json").notNull(),
  },
  (t) => [index("personas_run_idx").on(t.runId)],
);

export const reactions = pgTable(
  "reactions",
  {
    personaId: text("persona_id").primaryKey(),
    runId: text("run_id").notNull(),
    json: jsonb("json").notNull(),
  },
  (t) => [index("reactions_run_idx").on(t.runId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    segmentId: text("segment_id").notNull(),
    url: text("url").notNull(),
    json: jsonb("json").notNull(),
  },
  (t) => [index("evidence_run_idx").on(t.runId), uniqueIndex("evidence_seg_url_uq").on(t.segmentId, t.url)],
);

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    segmentId: text("segment_id").notNull(),
    json: jsonb("json").notNull(),
    stage: text("stage").notNull().default("discovered"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("leads_run_idx").on(t.runId)],
);

export const briefs = pgTable("briefs", {
  leadId: text("lead_id").primaryKey(),
  json: jsonb("json").notNull(),
});

export const styleProfiles = pgTable("style_profiles", {
  leadId: text("lead_id").primaryKey(),
  json: jsonb("json").notNull(),
});

export const drafts = pgTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    leadId: text("lead_id").notNull(),
    json: jsonb("json").notNull(),
    status: text("status").notNull().default("pending_review"),
    threadId: text("thread_id"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("drafts_run_idx").on(t.runId), index("drafts_thread_idx").on(t.threadId)],
);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  segmentId: text("segment_id").notNull(),
  json: jsonb("json").notNull(),
});

export const outcomes = pgTable(
  "outcomes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    draftId: text("draft_id").notNull(),
    leadId: text("lead_id").notNull(),
    json: jsonb("json").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("outcomes_run_idx").on(t.runId)],
);

export const stageChanges = pgTable(
  "stage_changes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    leadId: text("lead_id").notNull(),
    from: text("from"),
    to: text("to").notNull(),
    actor: text("actor").notNull(),
    cause: text("cause").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("stage_changes_lead_idx").on(t.leadId)],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    at: ts("at").notNull(),
    dept: text("dept").notNull(),
    type: text("type").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").notNull(),
    toDept: text("to_dept"),
  },
  (t) => [uniqueIndex("events_run_seq_uq").on(t.runId, t.seq)],
);

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id"),
    dept: text("dept"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    ms: integer("ms").notNull(),
    cacheKey: text("cache_key"),
    ok: integer("ok").notNull().default(1),
    error: text("error"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("llm_calls_run_idx").on(t.runId)],
);

// Undercurrent Chart (AMENDMENTS: no Neo4j). Ids are unique per run.
export const graphNodes = pgTable(
  "graph_nodes",
  {
    runId: text("run_id").notNull(),
    id: text("id").notNull(),
    label: text("label").notNull(), // Company | Product | Capability | Competitor | Segment | Persona | Evidence | Person | Repo | Tech | Draft | Outcome
    props: jsonb("props").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.id] }), index("graph_nodes_label_idx").on(t.runId, t.label)],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    runId: text("run_id").notNull(),
    id: text("id").notNull(), // `${type}:${from}->${to}`
    type: text("type").notNull(), // MAKES | HAS_CAPABILITY | SUPPORTS | REFERRED_BY | ...
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    props: jsonb("props").notNull(),
    weight: real("weight"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.id] }),
    index("graph_edges_from_idx").on(t.runId, t.fromId),
    index("graph_edges_to_idx").on(t.runId, t.toId),
  ],
);
