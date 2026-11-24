"use client";

import * as React from "react";
import { Lock } from "lucide-react";
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
  const [info, setInfo] = React.useState<RecipientInfo | null>(null);
  React.useEffect(() => {
    if (!draftId) return;
    let off = false;
    fetch(`/api/drafts/${encodeURIComponent(draftId)}/send`)
      .then((r) => (r.ok ? (r.json() as Promise<RecipientInfo>) : null))
      .then((j) => !off && setInfo(j))
      .catch(() => !off && setInfo(null));
    return () => {
      off = true;
    };
  }, [draftId, refreshKey]);
  return info;
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
  const info = useRecipient(draftId);
  if (!info) {
    return (
      <Button variant="cta" disabled>
        {sendLabel}
      </Button>
    );
  }
  if (info.sendable) {
    return (
      <>
        <Button variant="cta" onClick={() => onSend({ standIn: false })} disabled={disabled || done} title={`Sends to ${info.to} (our inbox)`}>
          {sendLabel}
        </Button>
        <span className="text-[12px] text-muted">
          to <span className="font-mono text-charcoal">{info.to}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <span title={DRAFT_ONLY_TIP} className="inline-flex">
        <Button
          variant="raised"
          disabled
          aria-label={`Draft only. ${DRAFT_ONLY_TIP}`}
          className="border border-dashed border-hairline-strong bg-paper text-charcoal disabled:opacity-100"
        >
          <Lock />
          Draft only
        </Button>
      </span>
      {info.standIn ? (
        <Button variant="cta" onClick={() => onSend({ standIn: true })} disabled={disabled || done} title={`Delivers this draft to stand-in ${info.standIn.name} at ${info.standIn.address}, not to the lead`}>
          Send to stand-in
        </Button>
      ) : null}
      {info.standIn ? (
        <span className="text-[12px] text-muted">
          stand-in <span className="font-semibold text-charcoal">{info.standIn.name}</span> · <span className="font-mono">{info.standIn.address}</span>
        </span>
      ) : (
        <span className="text-[12px] text-muted">No stand-in inbox set.</span>
      )}
    </>
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
