"use client";

import { useRun } from "./run-context";

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] border border-hairline-strong bg-paper px-1 font-sans text-[10px] font-semibold text-charcoal">{children}</kbd>;
}

export function TelemetryFooter() {
  const { runId, store } = useRun();
  const r = store.retrieval;
  const u = store.usage;
  return (
    <footer className="flex h-8 shrink-0 items-center gap-x-5 border-t border-hairline bg-paper px-4 text-[12px] text-muted tabular md:px-6">
      <span className="whitespace-nowrap">
        Retrieval <span className="font-medium text-body">{r ? `Moss · ${Math.round(r.p50Ms)} ms p50` : "Moss"}</span>
      </span>
      <span className="whitespace-nowrap">
        <span className="font-medium text-body">{u ? fmtTokens(u.inputTokens + u.outputTokens) : "0"}</span> tokens ·{" "}
        <span className="font-medium text-body">${u ? u.estCostUsd.toFixed(2) : "0.00"}</span>
      </span>
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
