import type { Draft, Lead } from "@/lib/contracts";
import { createDeptContext } from "../shared/context";
import { isOurInbox, standIn, standIns } from "@/lib/tools/agentmail";
import { getLead } from "./store";

/**
 * Who an email draft would go to, and whether the send lock lets it through.
 * Real leads → "draft only" (+ optional "Send to stand-in"). Leads whose address is one of our
 * AgentMail inboxes (e.g. the Priya referral) send normally.
 */
export interface RecipientInfo {
  /** The lead's own address (lead.email, else the Person node's email), or null. */
  to: string | null;
  /** True when `to` is one of our inboxes: the normal send button works. */
  sendable: boolean;
  /** Default stand-in for "Send to stand-in". */
  standIn: { name: string; address: string } | null;
  standIns: Array<{ name: string; address: string }>;
}

export async function leadAddress(runId: string, lead: Lead | null): Promise<string | null> {
  if (!lead) return null;
  if (lead.email?.address) return lead.email.address;
  const person = await createDeptContext(runId)
    .graph.getNode(runId, lead.personId)
    .catch(() => null);
  const e = person?.props.email;
  return typeof e === "string" && e ? e : null;
}

export async function recipientFor(runId: string, draft: Draft): Promise<RecipientInfo & { lead: Lead | null }> {
  const lead = await getLead(draft.leadId);
  const to = await leadAddress(runId, lead);
  return { lead, to, sendable: isOurInbox(to), standIn: standIn(), standIns: standIns() };
}
