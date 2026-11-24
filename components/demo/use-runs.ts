"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunState } from "@/lib/contracts";

export const LIVE_RUN_KEY = "uc:liveRunId";
export const SHOWCASE_ID = "showcase";

export interface RunListItem {
  runId: string;
  companyName: string | null;
  state: RunState | null;
  createdAt: string | null;
  showcase: boolean;
}

/** GET /api/runs (showcase first). Falls back to a local list when the endpoint isn't there (404/405) or fails. */
export function useRunList(open: boolean, extra: RunListItem[]) {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const extraKey = JSON.stringify(extra);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { runs?: RunListItem[] };
      setRuns(Array.isArray(j.runs) ? j.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open || runs === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // merge: server list first, then anything we know locally that it didn't return; showcase always present and first
  const merged: RunListItem[] = [];
  const seen = new Set<string>();
  const push = (r: RunListItem) => {
    if (seen.has(r.runId)) {
      const i = merged.findIndex((m) => m.runId === r.runId);
      const cur = merged[i];
      merged[i] = { ...cur, companyName: cur.companyName ?? r.companyName, state: cur.state ?? r.state, createdAt: cur.createdAt ?? r.createdAt, showcase: cur.showcase || r.showcase };
      return;
    }
    seen.add(r.runId);
    merged.push(r);
  };
  for (const r of runs ?? []) push(r);
  for (const r of JSON.parse(extraKey) as RunListItem[]) push(r);
  if (!merged.some((r) => r.showcase)) push({ runId: SHOWCASE_ID, companyName: null, state: "DONE", createdAt: null, showcase: true });
  merged.sort((a, b) => Number(b.showcase) - Number(a.showcase) || (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));

  return { runs: merged, loading, ready: runs !== null, reload: load };
}

export function readLiveRunId(): string | null {
  try {
    return localStorage.getItem(LIVE_RUN_KEY);
  } catch {
    return null;
  }
}

/** The live run id from localStorage, kept in sync across tabs. */
export function useLiveRunId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(readLiveRunId());
    const on = (e: StorageEvent) => e.key === LIVE_RUN_KEY && setId(e.newValue);
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(LIVE_RUN_KEY);
    } catch {}
    setId(null);
  }, []);
  return { id, clear };
}

export interface LiveSnapshot {
  state: RunState | null;
  companyName: string | null;
  people: number;
  segments: number;
  verified: number;
  drafts: number;
}

interface RawSnapshot {
  state?: RunState;
  companyName?: string | null;
  profile?: { name?: string } | null;
  intake?: { url?: string | null } | null;
  leads?: Array<{ kind?: string }> | number;
  segments?: Array<{ verdict?: string; origin?: string }> | number;
  drafts?: unknown[] | number;
}

const count = (v: unknown[] | number | undefined) => (typeof v === "number" ? v : Array.isArray(v) ? v.length : 0);

function host(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function toLiveSnapshot(j: RawSnapshot): LiveSnapshot {
  const leads = Array.isArray(j.leads) ? j.leads.filter((l) => l.kind !== "account").length : count(j.leads);
  const segs = Array.isArray(j.segments) ? j.segments.filter((s) => s.origin !== "control_negative") : null;
  return {
    state: j.state ?? null,
    companyName: j.profile?.name ?? j.companyName ?? host(j.intake?.url) ?? null,
    people: leads,
    segments: segs ? segs.length : count(j.segments),
    verified: segs ? segs.filter((s) => s.verdict === "VERIFIED").length : 0,
    drafts: count(j.drafts),
  };
}

/** Polls GET /api/runs/:id every `ms` while `id` is set and the run isn't terminal. */
export function useRunSnapshot(id: string | null, ms = 3000) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const terminal = useRef(false);

  useEffect(() => {
    setSnap(null);
    setMissing(false);
    terminal.current = false;
    if (!id) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (res.status === 404) setMissing(true);
        else if (res.ok) {
          const s = toLiveSnapshot((await res.json()) as RawSnapshot);
          setMissing(false);
          setSnap(s);
          terminal.current = s.state === "DONE" || s.state === "FAILED" || s.state === "CANCELLED";
        }
      } catch {
        /* keep the last snapshot */
      }
      if (!stop && !terminal.current) t = setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [id, ms]);

  return { snap, missing };
}
