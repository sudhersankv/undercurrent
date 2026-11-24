"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { EventDept } from "@/lib/contracts";
import { useRunStream, type RunStore, type StreamStatus } from "@/lib/client/run-store";

/** A chat line that lives only in this tab (your message, a direct reply, or a send error). */
export interface LocalItem {
  id: string;
  kind: "you" | "reply" | "error";
  text: string;
  dept?: EventDept;
  /** Rendered after the event with this seq. */
  afterSeq: number;
  at: string;
}

interface RunCtx {
  runId: string;
  store: RunStore;
  status: StreamStatus;
  local: LocalItem[];
  addLocal: (item: Omit<LocalItem, "id" | "afterSeq" | "at">) => void;
}

const Ctx = createContext<RunCtx | null>(null);

/** One SSE subscription per run, shared by every page under /runs/[runId]. */
export function RunProvider({ runId, children }: { runId: string; children: React.ReactNode }) {
  const { store, status } = useRunStream(runId);
  const [local, setLocal] = useState<LocalItem[]>([]);
  const lastSeq = store.lastSeq;

  const addLocal = useCallback<RunCtx["addLocal"]>(
    (item) =>
      setLocal((l) => [...l, { ...item, id: `${Date.now()}-${l.length}`, afterSeq: lastSeq, at: new Date().toISOString() }]),
    [lastSeq],
  );

  const value = useMemo(() => ({ runId, store, status, local, addLocal }), [runId, store, status, local, addLocal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRun(): RunCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRun must be used inside <RunProvider>");
  return v;
}

/** Run is finished (no department should pulse). */
export function isRunOver(store: RunStore): boolean {
  if (store.state === "DONE" || store.state === "FAILED" || store.state === "CANCELLED") return true;
  const last = store.events[store.events.length - 1];
  return last?.type === "run.fake_done" || last?.type === "run.done";
}
