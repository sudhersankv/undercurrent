import { z } from "zod";

export const SourceUrl = z.string().url();
export const Confidence = z.number().min(0).max(1);
export const Actor = z
  .string()
  .regex(/^(agent:(sonar|swarm|sounding|pilot|tide|wake|helm)|human:.+)$/);
export type Actor = z.infer<typeof Actor>;

export const DEPT_IDS = ["sonar", "swarm", "sounding", "pilot", "tide", "wake"] as const;
export const DeptId = z.enum(DEPT_IDS);
export type DeptId = z.infer<typeof DeptId>;

/** Departments plus the Helm router (event authors). */
export const EventDept = z.enum(["helm", ...DEPT_IDS]);
export type EventDept = z.infer<typeof EventDept>;

export const Verdict = z.enum(["PENDING", "VERIFIED", "PROMISING", "HYPE", "KILLED"]);
export type Verdict = z.infer<typeof Verdict>;

export const LeadStage = z.enum(["discovered", "approved", "contacted", "replied", "meeting", "won", "lost"]);
export type LeadStage = z.infer<typeof LeadStage>;

/** Orchestrator states (SPEC §5.7) plus terminal states. */
export const RunState = z.enum([
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
  "FAILED",
  "CANCELLED",
]);
export type RunState = z.infer<typeof RunState>;
