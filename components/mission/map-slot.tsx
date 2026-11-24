"use client";

import { MarketMap } from "@/components/market-map";
import { WakePanel } from "@/components/wake";
import { useRun } from "./run-context";

/** Market map hero (#14), fed by mission control's single SSE subscription. */
export function MapSlot() {
  const { runId, store } = useRun();
  return <MarketMap runId={runId} store={store} className="h-full min-h-[320px]" />;
}

const WAKE_STATES = new Set(["TIDE", "OUTREACH_REVIEW", "WAKE", "DONE"]);

/** Wake dashboard (#17), shown once outreach exists. Shares mission control's store. */
export function WakeSlot() {
  const { runId, store } = useRun();
  const live = (store.state && WAKE_STATES.has(store.state)) || Object.keys(store.drafts).length > 0 || store.replies.length > 0;
  if (!live) return null;
  return <WakePanel runId={runId} store={store} />;
}
