import type { DeptId, RunState } from "@/lib/contracts";

export type StatusTone = "working" | "waiting" | "done" | "failed" | "idle";

export interface RunStatus {
  /** Human label, e.g. "Sounding markets…". */
  label: string;
  /** Short label for compact chips, e.g. "Sounding". */
  short: string;
  tone: StatusTone;
  dept: DeptId | null;
}

const MAP: Record<RunState, RunStatus> = {
  INTAKE: { label: "Starting…", short: "Starting", tone: "working", dept: null },
  SONAR: { label: "Reading the product…", short: "Reading", tone: "working", dept: "sonar" },
  SWARM_R1: { label: "Simulating developers…", short: "Simulating", tone: "working", dept: "swarm" },
  SOUNDING_R1: { label: "Sounding markets…", short: "Sounding", tone: "working", dept: "sounding" },
  SWARM_R2: { label: "Exploring neighbors…", short: "Exploring", tone: "working", dept: "swarm" },
  SOUNDING_R2: { label: "Testing neighbors…", short: "Testing", tone: "working", dept: "sounding" },
  PILOT: { label: "Finding people…", short: "Finding people", tone: "working", dept: "pilot" },
  BRIEF_REVIEW: { label: "Briefs to review", short: "Needs review", tone: "waiting", dept: "pilot" },
  TIDE: { label: "Drafting outreach…", short: "Drafting", tone: "working", dept: "tide" },
  OUTREACH_REVIEW: { label: "Drafts to review", short: "Needs review", tone: "waiting", dept: "tide" },
  WAKE: { label: "Watching replies…", short: "Watching", tone: "working", dept: "wake" },
  DONE: { label: "Done", short: "Done", tone: "done", dept: null },
  FAILED: { label: "Failed", short: "Failed", tone: "failed", dept: null },
  CANCELLED: { label: "Cancelled", short: "Cancelled", tone: "idle", dept: null },
};

export const STATE_ORDER: RunState[] = [
  "INTAKE",
  "SONAR",
  "SWARM_R1",
  "SOUNDING_R1",
  "SWARM_R2",
  "SOUNDING_R2",
  "PILOT",
  "BRIEF_REVIEW",
  "TIDE",
  "OUTREACH_REVIEW",
  "WAKE",
  "DONE",
];

export function stateIndex(s: RunState | null | undefined): number {
  return s ? STATE_ORDER.indexOf(s) : -1;
}

export function runStatus(state: RunState | null | undefined, over = false): RunStatus {
  if (over && state !== "FAILED" && state !== "CANCELLED") return MAP.DONE;
  return state ? MAP[state] : MAP.INTAKE;
}

/** Stage headers in the activity timeline. */
export const STAGE_LABEL: Partial<Record<RunState, { title: string; sub?: string; dept: DeptId | "helm" }>> = {
  SONAR: { title: "Sonar", sub: "Understanding the product", dept: "sonar" },
  SWARM_R1: { title: "Swarm", sub: "Round 1", dept: "swarm" },
  SOUNDING_R1: { title: "Sounding", sub: "Round 1", dept: "sounding" },
  SWARM_R2: { title: "Swarm", sub: "Round 2", dept: "swarm" },
  SOUNDING_R2: { title: "Sounding", sub: "Round 2", dept: "sounding" },
  PILOT: { title: "Pilot", sub: "Finding people", dept: "pilot" },
  BRIEF_REVIEW: { title: "Review", sub: "Briefs", dept: "helm" },
  TIDE: { title: "Tide", sub: "Drafting", dept: "tide" },
  OUTREACH_REVIEW: { title: "Review", sub: "Outreach", dept: "helm" },
  WAKE: { title: "Wake", sub: "Replies", dept: "wake" },
  DONE: { title: "Done", dept: "helm" },
};

/** "now", "45s ago", "3m ago", "2h ago", "Mar 4". */
export function relTime(at: string | number, now: number): string {
  const t = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
