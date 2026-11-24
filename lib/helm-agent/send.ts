import type { Draft } from "@/lib/contracts";
import { createDeptContext } from "@/lib/departments/shared/context";
import { getDraft, saveDraft } from "@/lib/departments/tide/store";
import { recordSend } from "@/lib/departments/wake/engine";
import { getLead } from "@/lib/departments/wake/store";
import { notifyDraftSent } from "@/lib/orchestrator";
import { allowlist, resolveRecipient, send, standIn, standInName } from "@/lib/tools/agentmail";
import { SafeModeBlocked } from "@/lib/tools/types";
import { historyActor, type HelmActor } from "./session";

/**
 * The send lock, shared by every Helm-agent surface (Telegram, MCP).
 * Mail goes ONLY to our own AgentMail inboxes: SEND_ALLOWLIST plus AGENTMAIL_INBOX_ID.
 * Real people stay draft-only. Checked here before `send()`, and `send()` itself redirects / blocks
 * via safe mode, so the lock holds even if DEMO_SAFE_MODE is turned off.
 * Mirrors POST /api/drafts/:id/send (record, Wake handoff) without touching that route.
 */

export class SendLocked extends Error {
  constructor(
    public to: string,
    reason = `${to} is not one of our inboxes. Real people stay draft-only.`,
  ) {
    super(reason);
    this.name = "SendLocked";
  }
}

/** Our own inboxes: the stand-in allowlist plus the sender inbox. */
export function ourInboxes(): string[] {
  const own = (process.env.AGENTMAIL_INBOX_ID ?? "").trim().toLowerCase();
  return [...new Set([...allowlist(), ...(own ? [own] : [])])];
}

export function isOurInbox(addr: string): boolean {
  return ourInboxes().includes(addr.trim().toLowerCase());
}

/**
 * Where a draft for `leadAddress` would be delivered. Throws SendLocked unless that is one of our
 * inboxes. `requested` (optional) picks a specific stand-in and must itself be one of ours.
 */
export function lockedRecipient(leadAddress: string, requested?: string | null): string {
  if (requested) {
    if (!isOurInbox(requested)) throw new SendLocked(requested);
    return requested.trim().toLowerCase();
  }
  // The send lock never redirects: a real lead's draft goes to the default stand-in only because we pick it here.
  const fallback = standIn()?.address;
  if (!fallback) throw new SendLocked(leadAddress, "No stand-in inbox configured (SEND_ALLOWLIST). Draft only.");
  let deliveredTo: string;
  try {
    deliveredTo = resolveRecipient(fallback).deliveredTo;
  } catch (err) {
    if (err instanceof SafeModeBlocked) throw new SendLocked(fallback);
    throw err;
  }
  if (!isOurInbox(deliveredTo)) throw new SendLocked(deliveredTo);
  return deliveredTo;
}

export interface StandInSendResult {
  draft: Draft;
  runId: string;
  deliveredTo: string;
  standIn: string | null;
  fixture: boolean;
  banner: string;
}

export async function sendToStandIn(draftId: string, actor: HelmActor, opts: { to?: string | null } = {}): Promise<StandInSendResult> {
  const hit = await getDraft(draftId);
  if (!hit) throw new Error(`draft ${draftId} not found`);
  const { runId, draft } = hit;
  if (draft.status === "sent") throw new Error("draft already sent");
  if (draft.status === "rejected") throw new Error("draft was rejected");
  if (draft.channel !== "email" && draft.channel !== "followup_email") throw new Error(`${draft.channel} drafts are never sent by us. Open or copy it and post by hand.`);

  const dctx = createDeptContext(runId);
  const lead = await getLead(draft.leadId);
  let leadAddress = lead?.email?.address;
  if (!leadAddress && lead) {
    const person = await dctx.graph.getNode(runId, lead.personId).catch(() => null);
    const e = person?.props.email;
    if (typeof e === "string") leadAddress = e;
  }
  leadAddress ??= `${draft.leadId}@lead.invalid`;

  let to: string;
  try {
    to = lockedRecipient(leadAddress, opts.to);
  } catch (err) {
    if (err instanceof SendLocked) {
      dctx.emit({ dept: "helm", type: "helm.send_locked", level: "warning", message: `Send blocked: ${err.to} is not our inbox`, payload: { draftId, to: err.to, actor } });
    }
    throw err;
  }

  try {
    // `to` is already one of ours, so send() delivers as-is (and would redirect/block otherwise).
    const res = await send({ to, subject: draft.subject ?? "hello", body: draft.body, leadId: draft.leadId });
    if (!isOurInbox(res.deliveredTo)) throw new SendLocked(res.deliveredTo); // belt and braces
    const sent = await recordSend(dctx, draft, lead, { ...res, safeModeRedirected: true, standIn: res.standIn ?? standInName() }, historyActor(actor));
    await notifyDraftSent(runId, sent).catch((e) => console.warn("[helm-agent] notifyDraftSent:", e instanceof Error ? e.message : e));
    const standIn = res.standIn ?? standInName();
    return { draft: sent, runId, deliveredTo: res.deliveredTo, standIn, fixture: res.fixture ?? false, banner: `Safe mode: delivered to stand-in ${standIn ?? res.deliveredTo}` };
  } catch (err) {
    if (err instanceof SafeModeBlocked) {
      const blocked: Draft = {
        ...draft,
        status: "send_blocked_safe_mode",
        history: [...draft.history, { actor: "agent:tide", action: "send_blocked_safe_mode", at: new Date().toISOString(), note: err.message }],
      };
      await saveDraft(runId, blocked);
      throw new SendLocked(err.to, "Safe mode: draft only");
    }
    throw err;
  }
}
