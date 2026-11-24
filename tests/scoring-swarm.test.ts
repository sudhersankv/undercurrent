import { describe, expect, it } from "vitest";
import type { Persona, PersonaReaction, SegmentHypothesis } from "@/lib/contracts";
import { calibrate, pickExplorationTargets, simInterest, swarmReliability, ucb } from "@/lib/scoring/swarm";

const persona = (id: string, skepticism: Persona["skepticism"] = "normal"): Persona => ({
  id,
  segmentId: "s",
  synthetic: true,
  label: `Persona: ${id}`,
  role: "dev",
  companyType: "startup",
  seniority: "senior",
  stack: [],
  dailyPains: [],
  currentTools: [],
  budgetAuthority: "none",
  skepticism,
});
const reaction = (personaId: string, wouldTry: number, wouldPay: number, solved = true): PersonaReaction => ({
  personaId,
  wouldTry,
  wouldPay,
  painSolved: solved ? "pain" : null,
  currentSolution: null,
  switchingCost: "low",
  budgetOwner: null,
  topObjection: "x",
  killerUseCase: null,
  searchPhrases: ["a", "b", "c"],
  confidence: 0.5,
  oneLineReaction: "ok",
});
const seg = (o: Partial<SegmentHypothesis>): SegmentHypothesis => ({
  id: "s",
  runId: "R",
  round: 1,
  parentId: null,
  name: "s",
  domain: "gaming",
  origin: "explore",
  mechanism: { capabilityId: "c", pain: "p", whyNonObvious: null },
  simInterest: null,
  simInterestCalibrated: null,
  personaCount: 3,
  evidenceStrength: null,
  verdict: "PENDING",
  topObjections: [],
  killerUseCases: [],
  ...o,
});

describe("§9.1 simInterest", () => {
  const cases: Array<[string, Persona[], PersonaReaction[], number]> = [
    ["no reactions", [persona("a")], [], 0],
    ["uniform agreement", [persona("a"), persona("b")], [reaction("a", 0.5, 0.5), reaction("b", 0.5, 0.5)], 0.5],
    ["spread penalty", [persona("a"), persona("b"), persona("c")], [reaction("a", 1, 1), reaction("b", 0.5, 0.5), reaction("c", 0, 0)], 0.5 - 0.5 * Math.sqrt(1 / 6)],
    ["vague interest gated at 0.3", [persona("a")], [reaction("a", 1, 0, false)], 0.18],
    ["skeptic weighs 1.5", [persona("a"), persona("b", "high")], [reaction("a", 1, 1), reaction("b", 0, 0)], 0.4 - 0.25],
    ["clamped at 0", [persona("a"), persona("b")], [reaction("a", 0, 0), reaction("b", 0.2, 0.2, false)], 0],
    ["ignores personas without reaction", [persona("a"), persona("z")], [reaction("a", 0.8, 0.3)], 0.6],
  ];
  it.each(cases)("%s", (_n, ps, rs, want) => {
    expect(simInterest(ps, rs)).toBeCloseTo(want, 6);
  });
});

describe("§9.2 swarmReliability", () => {
  const cases: Array<[number[], number, number, boolean]> = [
    [[], 1, 0, false],
    [[0, 0], 1, 0, false],
    [[0.1, 0.2], 1 - 0.15 / 0.35, 0.15, false],
    [[0.35], 0, 0.35, false],
    [[0.4, 0.5], 0, 0.45, true],
  ];
  it.each(cases)("%j → reliability %d", (xs, rel, mean, warn) => {
    const r = swarmReliability(xs);
    expect(r.reliability).toBeCloseTo(rel, 6);
    expect(r.controlMean).toBeCloseTo(mean, 6);
    expect(r.warning).toBe(warn);
  });
});

describe("§9.3 ucb + exploration targets", () => {
  const cases: Array<[string, Partial<SegmentHypothesis>, number, number]> = [
    ["full formula", { simInterestCalibrated: 0.5, personaCount: 3, evidenceStrength: 0.5 }, 30, 0.5 + 0.3 * Math.sqrt(Math.log(30) / 3) + 0.1],
    ["falls back to raw simInterest", { simInterest: 0.4, personaCount: 3 }, 30, 0.4 + 0.3 * Math.sqrt(Math.log(30) / 3)],
    ["no bonus with one persona total", { simInterestCalibrated: 0.7, personaCount: 1 }, 1, 0.7],
    ["unscored segment counts as 1 persona", { personaCount: 0 }, 10, 0.3 * Math.sqrt(Math.log(10))],
  ];
  it.each(cases)("%s", (_n, o, total, want) => {
    expect(ucb(seg(o), total)).toBeCloseTo(want, 6);
  });

  it("excludes KILLED and controls, sorts by UCB, caps at n", () => {
    const ss = [
      seg({ id: "a", simInterest: 0.9, verdict: "KILLED" }),
      seg({ id: "b", simInterest: 0.95, origin: "control_negative" }),
      seg({ id: "c", simInterest: 0.3 }),
      seg({ id: "d", simInterest: 0.6 }),
      seg({ id: "e", simInterest: 0.5, evidenceStrength: 1 }),
      seg({ id: "f", simInterest: 0.1 }),
    ];
    expect(pickExplorationTargets(ss, 18).map((s) => s.id)).toEqual(["e", "d", "c"]);
    expect(pickExplorationTargets(ss, 18, 2).map((s) => s.id)).toEqual(["e", "d"]);
  });

  it("calibrate clamps sim·factor", () => {
    expect(calibrate(0.4, 2)).toBeCloseTo(0.8);
    expect(calibrate(0.8, 2)).toBe(1);
    expect(calibrate(0.4, undefined)).toBe(0.4);
  });
});
