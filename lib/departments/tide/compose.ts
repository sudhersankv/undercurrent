import { ulid } from "ulid";
import type { CompanyProfile, Draft, DraftChannel, Lead, Noticed, StyleProfile } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { CHANNEL_LIMITS, DISCLOSURE_LINE, DraftOut, draftPrompt } from "@/lib/llm/prompts/tide";
import type { DeptContext } from "../shared/types";
import { tryLlm } from "./llm";
import { review, type ReviewOpts } from "./reviewer";
import { saveDraft } from "./store";

/** SPEC §5.5 Steps C (draft), D (review, 1 regeneration), E (queue as pending_review). */

export const DEFAULT_CREDIT_USD = 50;

export interface ComposeArgs {
  company: CompanyProfile;
  lead: Lead;
  channel: DraftChannel;
  noticed: Noticed[];
  style: StyleProfile | null;
  creditUsd: number | null;
  otherLead?: string;
  instruction?: string;
  referral?: { referrerName: string; fromLeadName: string; role?: string };
  followupOf?: string;
}

const clipWords = (s: string, n: number) => {
  const w = s.split(/\s+/);
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : s;
};

function shortName(lead: Lead): string {
  return lead.primaryRepo?.split("/")[1] ?? lead.displayName;
}

/** Deterministic draft when no LLM is available (same spine as the prompt). */
export function fallbackDraft(a: ComposeArgs): { subject: string | null; body: string } {
  const n = a.noticed[0];
  const name = shortName(a.lead);
  const product = a.company.oneLiner.replace(/\.$/, "");
  const lines: string[] = [];
  if (a.channel === "followup_email") {
    lines.push(`one more thing on ${name}: ${clipWords(n.detail, 18)}`);
    lines.push(`${a.company.name} handles that in-process, so there's nothing extra to run.`);
    lines.push("no worries if it's not a fit.");
  } else {
    if (a.referral) lines.push(`${a.referral.referrerName} mentioned you handle ${a.referral.role ?? "this area"}.`);
    lines.push(`saw ${name}. ${clipWords(n.detail, 22)}`);
    lines.push(clipWords(n.relevanceToUs, 20));
    lines.push(`${a.company.name}: ${clipWords(product, 22)}`);
    if (a.creditUsd && (a.channel === "email" || a.channel === "x_dm")) {
      lines.push(`dropped $${a.creditUsd} in credits on your account, no strings.`);
      lines.push(DISCLOSURE_LINE);
    }
    lines.push("if you try it and hit anything weird, i'd like to hear.");
  }
  let body = lines.join("\n");
  const lim = CHANNEL_LIMITS[a.channel];
  if (lim.chars && body.length > lim.chars) body = body.slice(0, lim.chars - 1) + "…";
  if (a.style?.casing === "lowercase") body = body.replace(/(^|\n)([A-Z])(?=[a-z])/g, (_m, p: string, c: string) => p + c.toLowerCase());
  const subject = lim.subjectWords ? (a.referral ? `${a.referral.referrerName} said to ping you` : `${name} + ${a.company.name}`).split(/\s+/).slice(0, 7).join(" ") : null;
  return { subject, body };
}

async function generate(ctx: DeptContext, a: ComposeArgs, previousFailures?: string[]) {
  const p = draftPrompt({ ...a, previousFailures });
  const out = await tryLlm("draft", () =>
    callStructured({ model: "smart", system: p.system, user: p.user, schema: DraftOut, runId: ctx.runId, dept: "tide", temperature: 0.6, abortSignal: ctx.signal }),
  );
  if (!out) return fallbackDraft(a);
  const lim = CHANNEL_LIMITS[a.channel];
  return { subject: lim.subjectWords ? (out.subject ?? fallbackDraft(a).subject)?.slice(0, 60) ?? null : null, body: out.body.trim() };
}

/** Draft → review → (1 regeneration) → pending_review, persisted + events. */
export async function composeDraft(ctx: DeptContext, a: ComposeArgs, opts: ReviewOpts & { draftId?: string; history?: Draft["history"] } = {}): Promise<Draft> {
  const creditOffer = a.creditUsd && (a.channel === "email" || a.channel === "x_dm") ? { amountUsd: a.creditUsd, simulated: true } : null;
  const revInput = (g: { subject: string | null; body: string }) => ({
    channel: a.channel,
    subject: g.subject,
    body: g.body,
    noticed: a.noticed,
    creditOffer,
    lead: a.lead,
    style: a.style,
    otherLead: a.otherLead,
    runId: ctx.runId,
  });
  const id = opts.draftId ?? `draft-${ulid()}`;
  const now = () => new Date().toISOString();
  const history: Draft["history"] = [...(opts.history ?? []), { actor: "agent:tide", action: a.instruction ? "regenerated" : "drafted", at: now(), note: a.instruction }];

  let g = await generate(ctx, a);
  let rev = await review(revInput(g), opts);
  if (!rev.passed) {
    for (const f of rev.failures)
      ctx.emit({ dept: "tide", type: "tide.review_failed", level: "warning", message: `Review failed (${f.check}): ${f.reason}`, payload: { draftId: id, check: f.check, reason: f.reason } });
    const g2 = await generate(ctx, a, rev.failures.map((f) => `${f.check}: ${f.reason}`));
    const rev2 = await review(revInput(g2), opts);
    history.push({ actor: "agent:tide", action: "regenerated", at: now(), note: `reviewer: ${rev.failures.map((f) => f.check).join(", ")}` });
    g = g2;
    rev = rev2;
  }

  const draft: Draft = {
    id,
    leadId: a.lead.id,
    channel: a.channel,
    subject: g.subject ? g.subject.slice(0, 60) : null,
    body: g.body,
    noticed: a.noticed,
    creditOffer,
    review: rev,
    status: "pending_review",
    history: [...history, { actor: "agent:tide", action: "queued", at: now() }],
    threadId: null,
  };
  await saveDraft(ctx.runId, draft);
  ctx.emit({ dept: "tide", type: "tide.draft_created", level: "result", message: `Draft for ${a.lead.displayName} (${a.channel}), specificity ${rev.specificity}`, payload: { draft } });
  ctx.emit({ dept: "tide", type: "tide.queued", level: "action", message: `Queued for review: ${a.lead.displayName}${rev.passed ? "" : ` (${rev.failures.length} flags)`}`, payload: { draftId: draft.id, leadId: draft.leadId } });
  return draft;
}
