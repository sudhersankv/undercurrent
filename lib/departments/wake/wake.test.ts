import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryGraph } from "@/lib/graph";
import { bus } from "@/lib/events/bus";
import { calibrateSegment, globalError, isSmallSample, stageForReply } from "@/lib/scoring/wake";
import { demoFooter, resolveRecipient, send } from "@/lib/tools/agentmail";
import { SafeModeBlocked } from "@/lib/tools/types";
import { lichenSegments } from "@/lib/dev/lichen";
import { heuristicClassify } from "./classify";
import { pollRun } from "./engine";
import { getCalibration, getLead, listLeads, rememberSegments, stageChanges } from "./store";
import { listDrafts } from "../tide/store";

describe("§9.8 stage transitions", () => {
  it.each([
    ["contacted", "interested", "replied"],
    ["contacted", "question", "replied"],
    ["contacted", "referral", "replied"],
    ["contacted", "not_relevant", "lost"],
    ["replied", "unsubscribe", "lost"],
    ["contacted", "not_now", null],
    ["contacted", "auto_reply", null],
    ["discovered", "interested", null],
  ] as const)("%s + %s → %s", (from, intent, to) => {
    expect(stageForReply(from, intent)).toBe(to);
  });
});

describe("§9.9 calibration", () => {
  it.each([
    // predicted, positives, negatives, alpha, beta, observed, factor
    [0.5, 0, 0, 2, 2, 0.5, 1],
    [0.64, 1, 0, 3.56, 1.44, 0.712, 1.112],
    [0.2, 3, 0, 3.8, 3.2, 0.543, 2], // clamped to 2
    [0.8, 0, 4, 3.2, 4.8, 0.4, 0.5], // clamped to 0.5
    [0.01, 0, 0, 0.04, 3.96, 0.01, 0.5], // predicted floor 0.05 → 0.2 → clamp 0.5
  ])("predicted %f, +%i, -%i", (p, pos, neg, alpha, beta, observed, factor) => {
    const c = calibrateSegment(p, pos, neg);
    expect(c.alpha).toBeCloseTo(alpha, 3);
    expect(c.beta).toBeCloseTo(beta, 3);
    expect(c.observedRate).toBeCloseTo(observed, 3);
    expect(c.factor).toBeCloseTo(factor, 3);
    expect(c.n).toBe(pos + neg);
    expect(isSmallSample(c.n)).toBe(true);
  });

  it("globalError averages |predicted − raw observed| over segments with outcomes", () => {
    expect(globalError([])).toBe(0);
    expect(
      globalError([
        { predicted: 0.6, positives: 1, negatives: 0 }, // 0.4
        { predicted: 0.5, positives: 1, negatives: 1 }, // 0
        { predicted: 0.9, positives: 0, negatives: 0 }, // skipped
      ]),
    ).toBeCloseTo(0.2, 3);
    expect(isSmallSample(10)).toBe(false);
  });
});

describe("AgentMail safe mode", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.DEMO_SAFE_MODE = "true";
    process.env.SEND_ALLOWLIST = "standin@team.dev, other@team.dev";
    process.env.STANDIN_NAME = "Sam";
    delete process.env.SAFE_MODE_REDIRECT;
    delete process.env.AGENTMAIL_API_KEY;
    delete process.env.AGENTMAIL_INBOX_ID;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("redirects a real developer's address to the stand-in", async () => {
    const r = await send({ to: "dev@realcompany.com", subject: "hi", body: "body" });
    expect(r.deliveredTo).toBe("standin@team.dev");
    expect(r.safeModeRedirected).toBe(true);
    expect(r.standIn).toBe("Sam");
    expect(r.threadId).toMatch(/^fixture-thread-/);
  });

  it("delivers allowlisted addresses as-is", () => {
    expect(resolveRecipient("Other@Team.dev")).toEqual({ deliveredTo: "other@team.dev", redirected: false });
  });

  it("blocks non-allowlisted 'to' inside send() when redirect is disabled", async () => {
    process.env.SAFE_MODE_REDIRECT = "false";
    await expect(send({ to: "dev@realcompany.com", subject: "hi", body: "x" })).rejects.toBeInstanceOf(SafeModeBlocked);
  });

  it("blocks everything when the allowlist is empty", async () => {
    process.env.SEND_ALLOWLIST = "";
    await expect(send({ to: "dev@realcompany.com", subject: "hi", body: "x" })).rejects.toBeInstanceOf(SafeModeBlocked);
  });

  it("footer carries the demo disclosure, opt-out and address", () => {
    const f = demoFooter();
    expect(f).toContain("This is a demo by Undercurrent (HackwithBay 4.0), not an official message from Lichen.");
    expect(f).toMatch(/unsubscribe/i);
    expect(f).toMatch(/Placeholder St/);
  });
});

describe("Wake referral loop", () => {
  it("classifies the rehearsed Priya reply as referral", () => {
    const c = heuristicClassify("Not me, talk to Priya (priya@example.com), she runs our search infra.");
    expect(c.intent).toBe("referral");
    expect(c.referredPerson).toMatchObject({ name: "Priya", email: "priya@example.com", role: "search infra" });
    expect(c.nextAction).toBe("draft_referral_outreach");
    expect(heuristicClassify("please unsubscribe me").intent).toBe("unsubscribe");
    expect(heuristicClassify("how does it handle 100k docs?").intent).toBe("question");
  });

  it("demo poll: referral → replied (agent:wake), Person + REFERRED_BY, new lead, referral draft queued, calibration", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.NEON_AI_GATEWAY_TOKEN;
    const graph = new MemoryGraph();
    (globalThis as unknown as { __ucGraph?: MemoryGraph }).__ucGraph = graph;
    const runId = `T-${Date.now()}`;
    rememberSegments(lichenSegments(runId, { scored: true }));
    const events: string[] = [];
    bus.subscribe(runId, (e) => events.push(e.type));

    const outcomes = await pollRun(runId, true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].reply.intent).toBe("referral");

    const original = await getLead(outcomes[0].leadId);
    expect(original?.stage).toBe("replied");
    const changes = stageChanges(runId);
    expect(changes.find((c) => c.leadId === original?.id && c.to === "replied")?.actor).toBe("agent:wake");
    const leads = await listLeads(runId);
    const priya = leads.find((l) => l.displayName.startsWith("Priya"));
    expect(priya?.stage).toBe("discovered");
    expect(priya?.segmentId).toBe(original?.segmentId);

    const g = await graph.runGraph(runId);
    expect(g.nodes.find((n) => n.id === priya?.personId)?.props.email).toBe("priya@example.com");
    expect(g.edges.some((e) => e.type === "REFERRED_BY" && e.from === priya?.personId && e.to === original?.personId)).toBe(true);

    const drafts = await listDrafts(runId);
    const ref = drafts.find((d) => d.leadId === priya?.id);
    expect(ref?.status).toBe("pending_review");
    expect(ref?.body.toLowerCase()).toContain("mentioned you handle");

    const cal = getCalibration(runId);
    const row = cal?.perSegment[original?.segmentId ?? ""];
    expect(row?.n).toBe(1);
    expect(isSmallSample(row?.n)).toBe(true);
    expect(events).toEqual(expect.arrayContaining(["wake.reply_received", "wake.classified", "wake.stage_changed", "wake.referral_created", "tide.draft_created", "wake.calibration_updated"]));

    // Second demo poll does not double-count.
    expect(await pollRun(runId, true)).toHaveLength(0);
  });
});
