import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bus } from "@/lib/events";
import { setCallStructuredOverride } from "@/lib/llm";
import { listOutcomes } from "@/lib/departments/wake/store";
import { getRunSnapshot } from "@/lib/orchestrator";
import { emptyRunData, runs, type RunRecord } from "@/lib/orchestrator/store";
import { ensureShowcase, SHOWCASE_RUN_ID, showcaseFixturePath, type ShowcaseFixture } from "./showcase";

// Hermetic: no DB, no LLM gateway, no AgentMail (tests/setup.ts strips the keys too).
const ENV_KEYS = ["DATABASE_URL", "DATABASE_URL_DIRECT", "NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN", "AGENTMAIL_API_KEY", "AGENTMAIL_INBOX_ID", "SEND_ALLOWLIST", "SHOWCASE_FIXTURE"];
const prev: Record<string, string | undefined> = {};
let fixture: ShowcaseFixture;
let dir: string;

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  process.env.SEND_ALLOWLIST = "undercurrent-sam@example.com,undercurrent-priya@example.com";
  setCallStructuredOverride(null);
  fixture = JSON.parse(await readFile(showcaseFixturePath(), "utf8")) as ShowcaseFixture;
  dir = await mkdtemp(path.join(os.tmpdir(), "uc-showcase-"));
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
  await rm(dir, { recursive: true, force: true });
});

async function snapshot() {
  const snap = await getRunSnapshot(SHOWCASE_RUN_ID);
  expect(snap).not.toBeNull();
  return snap!;
}

function expectPopulated(snap: NonNullable<Awaited<ReturnType<typeof getRunSnapshot>>>) {
  const people = snap.drafts.filter((d) => !d.leadId.startsWith("campaign:"));
  expect(people.filter((d) => d.channel === "x_dm" || d.channel === "x_reply").length).toBeGreaterThanOrEqual(2);
  expect(people.filter((d) => d.channel === "email").length).toBeGreaterThanOrEqual(2);
  const sent = snap.drafts.filter((d) => d.status === "sent");
  expect(sent).toHaveLength(1);
  expect(sent[0].channel).toBe("email");
  expect(sent[0].history.some((h) => h.action === "sent")).toBe(true);
  expect(snap.campaigns.length).toBeGreaterThan(0);
  expect(snap.calibration).not.toBeNull();
  expect(snap.state).toBe("WAKE");
  // Wake handled the stand-in's referral: a new lead, an intro draft, the replied lead moved on.
  expect(snap.leads.some((l) => l.id.includes("-lead-ref-"))).toBe(true);
  expect(snap.leads.find((l) => l.id === sent[0].leadId)?.stage).toBe("replied");
  expect(snap.leads.filter((l) => ["approved", "contacted", "replied"].includes(l.stage)).length).toBeGreaterThanOrEqual(6);
}

describe("showcase", () => {
  it("hydrates the run with the real leads, segments and evidence from the fixture", async () => {
    await ensureShowcase();
    const snap = await snapshot();
    expect(snap.runId).toBe("showcase");
    expect(snap.companyName).toBe("Lichen");
    expect(snap.segments.map((s) => s.name)).toEqual(fixture.data.segments.map((s) => s.name));
    expect(snap.evidence.length).toBe(fixture.data.evidence.length);
    expect(snap.segments.every((s) => s.id.startsWith("showcase-"))).toBe(true);
    const names = snap.leads.map((l) => l.displayName);
    for (const l of fixture.data.leads) expect(names).toContain(l.displayName);
    expect(snap.leads.some((l) => l.handles.github === "cyanheads")).toBe(true);
    // never the invented fake-run people
    expect(JSON.stringify(snap.leads)).not.toMatch(/Minitour|semlocal/);
    expect(JSON.stringify(snap)).not.toContain(fixture.sourceRunId);
    const evs = await bus.history(SHOWCASE_RUN_ID);
    expect(evs.length).toBeGreaterThan(fixture.events.length);
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
  });

  it("has Tide drafts (X-first and email), one sent email and one Wake reply", async () => {
    const snap = await snapshot();
    expectPopulated(snap);
    const outcomes = await listOutcomes(SHOWCASE_RUN_ID);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].reply.intent).toBe("referral");
    // approvals are attributed stage moves, like the leads stage route
    const approvals = (await bus.history(SHOWCASE_RUN_ID)).filter((e) => e.type === "wake.stage_changed" && (e.payload as { to?: string }).to === "approved");
    expect(approvals.length).toBeGreaterThanOrEqual(6);
    // drafts cite real evidence URLs from the run
    const urls = new Set([...fixture.data.evidence.map((e) => e.url), ...fixture.data.briefs.flatMap((b) => b.evidence.map((e) => e.url))]);
    const cited = snap.drafts.flatMap((d) => d.noticed.map((n) => n.sourceUrl));
    expect(cited.some((u) => urls.has(u))).toBe(true);
  });

  it("commits no unmasked third-party emails, and masked addresses are never deliverable", async () => {
    const raw = await readFile(showcaseFixturePath(), "utf8");
    const emails = [...new Set(raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [])];
    expect(emails.filter((e) => !/^undercurrent-[a-z0-9-]+@agentmail\.to$/i.test(e))).toEqual([]);
    expect(/[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+\./i.test(raw)).toBe(false);
    const leadEmails = fixture.data.leads.flatMap((l) => (l.email ? [l.email as { address: string; masked?: boolean }] : []));
    expect(leadEmails.length).toBeGreaterThan(0);
    for (const e of leadEmails) {
      expect(e.address).toMatch(/^.•••@/);
      expect(e.masked).toBe(true);
    }

    const { resolveRecipient, send } = await import("@/lib/tools/agentmail");
    const { SafeModeBlocked } = await import("@/lib/tools/types");
    const { lockedRecipient, SendLocked } = await import("@/lib/helm-agent/send");
    const masked = leadEmails[0].address;
    expect(() => resolveRecipient(masked)).toThrow(SafeModeBlocked);
    expect(() => lockedRecipient(masked, masked)).toThrow(SendLocked);
    await expect(send({ to: masked, subject: "x", body: "x" })).rejects.toBeInstanceOf(SafeModeBlocked);
  });

  it("is idempotent and instant on repeat calls", async () => {
    const rec = runs.get(SHOWCASE_RUN_ID);
    const n = (await bus.history(SHOWCASE_RUN_ID)).length;
    const drafts = rec!.data.drafts.length;
    const t0 = performance.now();
    await Promise.all([ensureShowcase(), ensureShowcase(), getRunSnapshot(SHOWCASE_RUN_ID)]);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(runs.get(SHOWCASE_RUN_ID)).toBe(rec);
    expect((await bus.history(SHOWCASE_RUN_ID)).length).toBe(n);
    expect(rec!.data.drafts.length).toBe(drafts);
  });

  it("GET /api/runs lists runs newest first with the showcase pinned first", async () => {
    const mk = (runId: string, createdAt: string, companyName: string): RunRecord => ({
      runId,
      state: "BRIEF_REVIEW",
      createdAt,
      error: null,
      replayed: false,
      data: { ...emptyRunData({ notes: "x" }), companyName },
      abort: new AbortController(),
      tideLeads: new Set(),
      sentDrafts: new Set(),
    });
    runs.set("test-old", mk("test-old", "2020-01-01T00:00:00.000Z", "Old"));
    runs.set("test-new", mk("test-new", "2099-01-01T00:00:00.000Z", "New"));
    try {
      const { GET } = await import("@/app/api/runs/route");
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runs: Array<Record<string, unknown>> };
      expect(Object.keys(body)).toEqual(["runs"]);
      expect(body.runs[0]).toMatchObject({ runId: "showcase", companyName: "Lichen", state: "WAKE", showcase: true });
      for (const r of body.runs) {
        expect(Object.keys(r).sort()).toEqual(["companyName", "createdAt", "runId", "showcase", "state"]);
        expect(typeof r.createdAt).toBe("string");
        expect(Number.isNaN(Date.parse(r.createdAt as string))).toBe(false);
      }
      expect(body.runs.filter((r) => r.showcase)).toHaveLength(1);
      const ids = body.runs.map((r) => r.runId);
      expect(ids.indexOf("test-new")).toBeLessThan(ids.indexOf("test-old"));
      expect(body.runs.length).toBeLessThanOrEqual(21);
    } finally {
      runs.delete("test-old");
      runs.delete("test-new");
    }
  });

  it("falls back to deterministic template drafts without cached extras or an LLM", async () => {
    const file = path.join(dir, "no-extras.json");
    const { extras: _drop, ...base } = fixture;
    await writeFile(file, JSON.stringify(base), "utf8");
    process.env.SHOWCASE_FIXTURE = file;
    runs.delete(SHOWCASE_RUN_ID);
    try {
      await ensureShowcase();
      const snap = await snapshot();
      expectPopulated(snap);
      const people = snap.drafts.filter((d) => !d.leadId.startsWith("campaign:") && !d.leadId.includes("-lead-ref-"));
      expect(people.every((d) => d.history.some((h) => h.action === "template_fallback"))).toBe(true);
      // the rebuild replaced the earlier hydration instead of piling onto it
      const evs = await bus.history(SHOWCASE_RUN_ID);
      expect(evs.filter((e) => e.type === "run.created")).toHaveLength(1);
      expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
      expect(await listOutcomes(SHOWCASE_RUN_ID)).toHaveLength(1);
    } finally {
      delete process.env.SHOWCASE_FIXTURE;
    }
  });
});
