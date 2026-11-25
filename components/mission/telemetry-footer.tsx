"use client";

import * as React from "react";
import { SHOWCASE_ID } from "@/components/demo/use-runs";
import { useRun } from "./run-context";

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border border-hairline-strong bg-paper px-1 font-sans text-[10px] font-semibold text-charcoal">{children}</kbd>;
}

/** Replayed runs (the showcase, REPLAY_MODE) re-emit a capture without its llm.usage, so there is no cost to show. */
function useReplayed(runId: string, skip: boolean) {
  const [replayed, setReplayed] = React.useState(runId === SHOWCASE_ID);
  React.useEffect(() => {
    if (skip || runId === SHOWCASE_ID) return setReplayed(runId === SHOWCASE_ID);
    let off = false;
    fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { replayed?: boolean } | null) => !off && setReplayed(!!j?.replayed))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [runId, skip]);
  return replayed;
}

export function TelemetryFooter() {
  const { runId, store } = useRun();
  const r = store.retrieval;
  const u = store.usage;
  const replayed = useReplayed(runId, !!u);
  return (
    <footer className="flex h-8 shrink-0 items-center gap-x-5 border-t border-hairline bg-paper px-4 text-[12px] text-muted tabular md:px-6">
      <span className="whitespace-nowrap">
        Retrieval <span className="font-medium text-body">{r ? `Moss · ${Math.round(r.p50Ms)} ms p50` : "Moss"}</span>
      </span>
      {!u && replayed ? (
        <span className="whitespace-nowrap" title="Replayed from a captured live run. Token usage wasn't recorded.">
          <span className="font-medium text-body">Replayed run</span>
        </span>
      ) : (
        <span className="whitespace-nowrap">
          <span className="font-medium text-body">{u ? fmtTokens(u.inputTokens + u.outputTokens) : "0"}</span> tokens ·{" "}
          <span className="font-medium text-body">${u ? u.estCostUsd.toFixed(2) : "0.00"}</span>
        </span>
      )}
      <span className="ml-auto hidden items-center gap-3 whitespace-nowrap lg:flex" aria-label="Keyboard shortcuts">
        <span className="flex items-center gap-1">
          <Kbd>/</Kbd> ask
        </span>
        <span className="flex items-center gap-1">
          <Kbd>g</Kbd>
          <Kbd>s</Kbd> showcase
        </span>
        <span className="flex items-center gap-1">
          <Kbd>g</Kbd>
          <Kbd>l</Kbd> live
        </span>
      </span>
      <span className="truncate lg:ml-0 ml-auto" title={runId}>
        Run <span className="font-mono text-[11px] text-body">{runId}</span>
      </span>
    </footer>
  );
}
