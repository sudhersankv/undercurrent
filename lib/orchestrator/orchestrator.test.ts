import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LICHEN_ALIAS, LICHEN_INTAKE, type RunEvent } from "@/lib/contracts";
import { bus } from "@/lib/events";
import { setCallStructuredOverride } from "@/lib/llm";
import { MemoryGraph } from "@/lib/graph";
import { departments } from "@/lib/departments/shared";
import { keywordRoute, parseMention, routeChat } from "@/lib/departments/shared/chat-router";
import { approveLead, getRunSnapshot, notifyDraftSent, startRun } from "@/lib/orchestrator";
import { stubDepartments } from "@/lib/orchestrator/test-stubs";
import { companySlug, loadRecording } from "@/lib/replay";

// Hermetic: no network tools, no gateway. The state-machine tests use stub departments;
// the "offline" test runs the real departments on fixtures + LLM fallbacks.
const realDepartments = { ...departments };
const offlineLlm = async () => {
  throw new Error("LLM offline (test)");
};

const ctx = { graph: new MemoryGraph() };
const states = (evs: RunEvent[]) => evs.filter((e) => e.type === "run.state_changed").map((e) => (e.payload as { to: string }).to);
const handoffs = (evs: RunEvent[]) => evs.filter((e) => e.type === "helm.handoff");

let dir: string;
const prevDb = process.env.DATABASE_URL;
const prevTools = process.env.TOOLS_MODE;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uc-replay-"));
  process.env.REPLAY_FIXTURES_DIR = dir;
  process.env.TOOLS_MODE = "fixture";
  delete process.env.DATABASE_URL; // memory-only
});
afterAll(async () => {
  delete process.env.REPLAY_FIXTURES_DIR;
  if (prevTools === undefined) delete process.env.TOOLS_MODE;
  else process.env.TOOLS_MODE = prevTools;
  if (prevDb) process.env.DATABASE_URL = prevDb;
  Object.assign(departments, realDepartments);
  setCallStructuredOverride(null);
  await rm(dir, { recursive: true, force: true });
});

describe("orchestrator (stub departments)", () => {
  beforeAll(() => {
    Object.assign(departments, stubDepartments);
    setCallStructuredOverride(offlineLlm);
  });
  afterAll(() => {
    Object.assign(departments, realDepartments);
    setCallStructuredOverride(null);
  });

  it("walks every state with a handoff per department transition, then Tide/Wake on approval", async () => {
    const { runId, done } = await startRun({ url: LICHEN_INTAKE.url, notes: LICHEN_INTAKE.notes }, LICHEN_ALIAS, { mode: "record", ctx });
    await done;
    let evs = await bus.history(runId);
    expect(states(evs)).toEqual(["SONAR", "SWARM_R1", "SOUNDING_R1", "SWARM_R2", "SOUNDING_R2", "PILOT", "BRIEF_REVIEW"]);
    const hs = handoffs(evs).map((e) => e.message);
    expect(hs.length).toBeGreaterThanOrEqual(6);
    expect(hs.some((m) => m.startsWith("Sounding → Pilot:") && m.includes("VERIFIED"))).toBe(true);
    expect(hs[0]).toMatch(/^Sonar → Swarm:/);

    const snap = await getRunSnapshot(runId);
    expect(snap?.state).toBe("BRIEF_REVIEW");
    expect(snap?.leads.length).toBeGreaterThan(0);

    const lead = snap!.leads[0];
    const tide = await approveLead(runId, lead.id);
    expect(tide?.drafts.length).toBeGreaterThan(0);
    expect(await approveLead(runId, lead.id)).toBeNull(); // idempotent
    await notifyDraftSent(runId, { ...tide!.drafts[0], status: "sent" });
    evs = await bus.history(runId);
    expect(states(evs).slice(-3)).toEqual(["TIDE", "OUTREACH_REVIEW", "WAKE"]);
    expect(handoffs(evs).some((e) => e.message.startsWith("Tide → Wake:"))).toBe(true);

    // record mode saved the run up to BRIEF_REVIEW
    const rec = await loadRecording(companySlug({ displayAlias: LICHEN_ALIAS }));
    expect(rec?.sourceRunId).toBe(runId);
    expect(rec?.finalState).toBe("BRIEF_REVIEW");
  });

  it("replays a recorded run under a new runId and restores rows", async () => {
    const rec = (await loadRecording(companySlug({ displayAlias: LICHEN_ALIAS })))!;
    const t0 = Date.now();
    const { runId, done } = await startRun({ notes: "anything" }, LICHEN_ALIAS, { mode: "replay", replay: { minMs: 0, maxMs: 2 }, ctx });
    await done;
    expect(Date.now() - t0).toBeLessThan(90_000);
    const evs = await bus.history(runId);
    expect(evs.length).toBe(rec.events.length + 1); // + "Replay restored" note
    expect(states(evs)).toContain("SOUNDING_R2");
    expect(JSON.stringify(evs)).not.toContain(rec.sourceRunId);
    const snap = (await getRunSnapshot(runId))!;
    expect(snap.replayed).toBe(true);
    expect(snap.state).toBe("BRIEF_REVIEW");
    expect(snap.segments.every((s) => s.id.startsWith(runId))).toBe(true);
    // Tide stays live after replay
    const out = await approveLead(runId, snap.leads[0].id);
    expect(out?.drafts.length).toBeGreaterThan(0);
  });

  it("cancel marks the run CANCELLED", async () => {
    const { cancelRun } = await import("@/lib/orchestrator");
    const { runId, done } = await startRun({ notes: "x" }, null, { mode: "off", ctx });
    cancelRun(runId);
    await done;
    expect((await getRunSnapshot(runId))?.state).toBe("CANCELLED");
  });
});

describe("orchestrator (real departments, fixtures, no LLM)", () => {
  beforeAll(() => setCallStructuredOverride(offlineLlm));
  afterAll(() => setCallStructuredOverride(null));

  it("reaches BRIEF_REVIEW with a coherent map, leads, and drafts on approval", async () => {
    const { runId, done } = await startRun({ url: LICHEN_INTAKE.url, notes: LICHEN_INTAKE.notes }, LICHEN_ALIAS, { mode: "off", ctx });
    await done;
    const snap = (await getRunSnapshot(runId))!;
    expect(snap.state).toBe("BRIEF_REVIEW");
    const verdicts = snap.segments.map((s) => s.verdict);
    expect(verdicts).toContain("VERIFIED");
    expect(verdicts.some((v) => v === "HYPE" || v === "KILLED")).toBe(true);
    expect(verdicts).not.toContain("PENDING");
    expect(snap.leads.length).toBeGreaterThan(0);
    const tide = await approveLead(runId, snap.leads[0].id);
    expect(tide?.drafts.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("chat router", () => {
  beforeAll(() => Object.assign(departments, stubDepartments));
  afterAll(() => Object.assign(departments, realDepartments));
  afterEach(() => setCallStructuredOverride(null));

  it("parses @mentions", () => {
    expect(parseMention("@Sounding why is ecom HYPE?")).toEqual({ dept: "sounding", message: "why is ecom HYPE?" });
    expect(parseMention("hello").dept).toBeNull();
    expect(keywordRoute("rewrite the draft shorter")).toBe("tide");
  });

  it("routes via the fast model without a mention and emits the reply as a feed event", async () => {
    setCallStructuredOverride(async () => ({ dept: "pilot", reason: "about leads" }) as never);
    const runId = "chat-test-run";
    const res = await routeChat({ runId, message: "who should I email first?", ctx });
    expect(res).toMatchObject({ dept: "pilot", routedBy: "helm" });
    const res2 = await routeChat({ runId, message: "@wake any replies?", ctx });
    expect(res2).toMatchObject({ dept: "wake", routedBy: "mention" });
    const replies = (await bus.history(runId)).filter((e) => e.type === "helm.chat_reply");
    expect(replies.map((e) => e.dept)).toEqual(["pilot", "wake"]);
  });
});
