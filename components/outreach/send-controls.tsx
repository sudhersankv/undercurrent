"use client";

import * as React from "react";
import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Send lock UI. The server only delivers to our AgentMail inboxes; this mirrors it:
 * - recipient is ours (stand-in / referral to a stand-in) → "Approve & send"
 * - real lead → disabled "Draft only" + a separate, explicit "Send to stand-in"
 */
export interface RecipientInfo {
  to: string | null;
  sendable: boolean;
  standIn: { name: string; address: string } | null;
  standIns: Array<{ name: string; address: string }>;
}

export function useRecipient(draftId: string | null, refreshKey?: unknown): RecipientInfo | null {
  return useRecipientLookup(draftId, refreshKey).info;
}

/** Same lookup, but tells "still checking" apart from "couldn't check" (which stays locked). */
function useRecipientLookup(draftId: string | null, refreshKey?: unknown): { info: RecipientInfo | null; loading: boolean } {
  const [state, setState] = React.useState<{ info: RecipientInfo | null; loading: boolean }>({ info: null, loading: true });
  React.useEffect(() => {
    if (!draftId) return;
    let off = false;
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/drafts/${encodeURIComponent(draftId)}/send`)
      .then((r) => (r.ok ? (r.json() as Promise<RecipientInfo>) : null))
      .then((j) => !off && setState({ info: j, loading: false }))
      .catch(() => !off && setState({ info: null, loading: false }));
    return () => {
      off = true;
    };
  }, [draftId, refreshKey]);
  return state;
}

export const DRAFT_ONLY_TIP = "Real leads are never emailed. Copy the draft, or send it to a stand-in inbox.";

export function SendControls({
  draftId,
  disabled,
  done,
  onSend,
  sendLabel = "Approve & send",
}: {
  draftId: string;
  disabled?: boolean;
  done?: boolean;
  onSend: (opts: { standIn: boolean }) => void;
  sendLabel?: string;
}) {
  const { info, loading } = useRecipientLookup(draftId);
  if (!info && loading) {
    return (
      <span className="inline-flex h-9 w-36 animate-pulse rounded-pill bg-raised" aria-label="Checking recipient">
        <span className="sr-only">{sendLabel}</span>
      </span>
    );
  }
  if (!info) {
    return (
      <>
        <DraftOnlyBadge />
        <span className="text-[12px] text-muted">Recipient not verified, so this stays a draft.</span>
      </>
    );
  }
  if (info.sendable) {
    return (
      <>
        <Button variant="cta" onClick={() => onSend({ standIn: false })} disabled={disabled || done} title={`Sends to ${info.to} (our inbox)`} className="cursor-pointer">
          {sendLabel}
        </Button>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5 shrink-0 text-forest" />
          our inbox <span className="truncate font-mono text-charcoal">{info.to}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <DraftOnlyBadge />
      {info.standIn ? (
        <Button
          variant="cta"
          onClick={() => onSend({ standIn: true })}
          disabled={disabled || done}
          title={`Delivers this draft to stand-in ${info.standIn.name} at ${info.standIn.address}, not to the lead`}
          className="cursor-pointer"
        >
          Send to stand-in
        </Button>
      ) : null}
      {info.standIn ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-[12px] text-muted" title={info.standIn.address}>
          <ArrowRight className="size-3 shrink-0" />
          <span className="font-semibold text-charcoal">{info.standIn.name}</span>
          <span className="truncate font-mono">{info.standIn.address}</span>
        </span>
      ) : (
        <span className="text-[12px] text-muted">No stand-in inbox set.</span>
      )}
    </>
  );
}

function DraftOnlyBadge() {
  return (
    <span
      title={DRAFT_ONLY_TIP}
      aria-label={`Draft only. ${DRAFT_ONLY_TIP}`}
      className="inline-flex h-9 shrink-0 cursor-help items-center gap-1.5 rounded-pill bg-raised pl-1.5 pr-3.5 text-[13px] font-semibold text-charcoal"
    >
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-paper text-forest">
        <Lock className="size-3" strokeWidth={2.5} />
      </span>
      Draft only
    </span>
  );
}

/** Fire the send route. Never throws. */
export async function postSend(draftId: string, standIn: boolean): Promise<{ ok: boolean; text: string; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "reviewer", standIn: standIn || undefined }),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const text = typeof json?.banner === "string" ? json.banner : typeof json?.error === "string" ? json.error : `Failed (${res.status})`;
    return { ok: res.ok, text, json };
  } catch {
    return { ok: false, text: "Network error. Try again.", json: null };
  }
}
