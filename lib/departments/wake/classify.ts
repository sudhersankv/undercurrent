import { z } from "zod";
import { ReplyIntent, type ReplyClass } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { llmAvailable } from "../tide/llm";

/** SPEC §5.6 (2): reply classification with MODEL_FAST, deterministic fallback without a gateway. */

export const ClassifyOut = z.object({
  intent: ReplyIntent,
  referredPerson: z.object({ name: z.string(), email: z.string().nullable(), handle: z.string().nullable(), role: z.string().nullable() }).nullable(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string(),
  nextAction: z.enum(["draft_reply", "draft_referral_outreach", "schedule_followup", "close_lost", "stop"]),
});

export const CLASSIFY_SYSTEM = `You classify a reply to a cold developer outreach email.
intent: interested | referral (they point us to someone else) | not_now | not_relevant | unsubscribe | question | auto_reply.
If referral, fill referredPerson (name, email if given, handle if given, role = what that person handles, e.g. "search infra").
nextAction: interested/question → draft_reply; referral → draft_referral_outreach; not_now → schedule_followup; not_relevant → close_lost; unsubscribe/auto_reply → stop.
summary ≤200 chars.`;

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

const NEXT: Record<ReplyClass["intent"], ReplyClass["nextAction"]> = {
  interested: "draft_reply",
  question: "draft_reply",
  referral: "draft_referral_outreach",
  not_now: "schedule_followup",
  not_relevant: "close_lost",
  unsubscribe: "stop",
  auto_reply: "stop",
};

/** Regex classifier (no LLM). Good enough for the rehearsed replies. */
export function heuristicClassify(text: string): Omit<ReplyClass, "draftId" | "leadId"> {
  const t = text.toLowerCase();
  const email = EMAIL_RE.exec(text)?.[0];
  const nameM = /(?:talk to|ask|ping|try|contact|loop in|reach out to|email|cc(?:'?ing)?)\s+([A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)/.exec(text);
  const roleM = /(?:she|he|they|who)\s+(?:runs|owns|handles|leads|manages|works on)\s+(?:our\s+|the\s+)?([^.,;\n)]+)/i.exec(text);
  let intent: ReplyClass["intent"];
  if (/unsubscribe|stop emailing|remove me|don't email/.test(t)) intent = "unsubscribe";
  else if (/out of (the )?office|auto(matic)?[- ]?reply|on vacation|on leave/.test(t)) intent = "auto_reply";
  else if ((nameM || email) && /not me|talk to|ask|ping|better person|right person|contact|loop in|handles|runs/.test(t)) intent = "referral";
  else if (/not relevant|not interested|no thanks|not a fit|don't need|we use something else/.test(t)) intent = "not_relevant";
  else if (/not now|later|next (quarter|month|year)|busy|circle back|in a few/.test(t)) intent = "not_now";
  else if (/\?/.test(t)) intent = "question";
  else intent = "interested";

  const name = nameM?.[1] ?? (email ? email.split("@")[0].replace(/^\w/, (c) => c.toUpperCase()) : null);
  const referredPerson =
    intent === "referral" && name ? { name, ...(email ? { email } : {}), ...(roleM ? { role: roleM[1].trim() } : {}) } : null;
  const sentiment: ReplyClass["sentiment"] = intent === "interested" || intent === "referral" ? "positive" : intent === "not_relevant" || intent === "unsubscribe" ? "negative" : "neutral";
  const summary = (intent === "referral" && referredPerson ? `Not the right person; points to ${referredPerson.name}${referredPerson.role ? `, who runs ${referredPerson.role}` : ""}.` : text.replace(/\s+/g, " ").trim()).slice(0, 200);
  return { intent, referredPerson, sentiment, summary, nextAction: NEXT[intent] };
}

export async function classifyReply(args: { text: string; draftId: string; leadId: string; sentBody?: string; runId: string }): Promise<ReplyClass> {
  const base = { draftId: args.draftId, leadId: args.leadId };
  if (llmAvailable()) {
    try {
      const out = await callStructured({
        model: "fast",
        system: CLASSIFY_SYSTEM,
        user: `${args.sentBody ? `Our email:\n"""${args.sentBody.slice(0, 1500)}"""\n\n` : ""}Their reply:\n"""${args.text.slice(0, 3000)}"""`,
        schema: ClassifyOut,
        runId: args.runId,
        dept: "wake",
        temperature: 0,
      });
      const rp = out.referredPerson;
      const emailOk = rp?.email && EMAIL_RE.test(rp.email) ? rp.email : undefined;
      return {
        ...base,
        intent: out.intent,
        referredPerson: rp ? { name: rp.name, ...(emailOk ? { email: emailOk } : {}), ...(rp.handle ? { handle: rp.handle } : {}), ...(rp.role ? { role: rp.role } : {}) } : null,
        sentiment: out.sentiment,
        summary: out.summary.slice(0, 200),
        nextAction: out.nextAction,
      };
    } catch (err) {
      console.warn("[wake] classify failed, using heuristic:", err instanceof Error ? err.message : err);
    }
  }
  return { ...base, ...heuristicClassify(args.text) };
}
