"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, X } from "lucide-react";
import type { RunEvent } from "@/lib/contracts";
import type { GraphEdge, GraphNode, NodeLabel } from "@/lib/graph/types";
import { useRunStream } from "@/lib/client/run-store";
import { Button, DeptGlyph, Eyebrow, Pill } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LABEL_COLOR, deriveGraph, mergeGraphs } from "./derive";
import type { FLink, FNode } from "./force-canvas";

const ForceCanvas = dynamic(() => import("./force-canvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">Loading graph…</div>,
});

type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };
const EMPTY: Graph = { nodes: [], edges: [] };

function useServerGraph(runId: string) {
  const [g, setG] = useState<Graph>(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/graph`, { cache: "no-store" });
        if (r.ok && alive) setG((await r.json()) as Graph);
      } catch {
        /* keep last graph */
      }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId]);
  return g;
}

function nodeName(n: GraphNode) {
  const p = n.props as Record<string, unknown>;
  return String(p.name ?? p.title ?? p.label ?? p.displayName ?? n.id);
}

function nodeIdsOf(e: RunEvent): string[] {
  const ids = (e.payload as { nodeIds?: unknown }).nodeIds;
  return Array.isArray(ids) ? (ids.filter((x) => typeof x === "string") as string[]) : [];
}

export function ChartView({ runId }: { runId: string }) {
  const { store, connected } = useRunStream(runId);
  const server = useServerGraph(runId);
  const derived = useMemo(() => deriveGraph(store), [store]);
  const graph = useMemo(() => mergeGraphs(server, derived), [server, derived]);

  const [segment, setSegment] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trace, setTrace] = useState(false);
  const [traceEventId, setTraceEventId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const segments = useMemo(() => graph.nodes.filter((n) => n.label === "Segment"), [graph.nodes]);

  // Segment filter: the segment plus everything within two hops, without crossing into other segments.
  const visible = useMemo(() => {
    if (segment === "all") return null;
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
      adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
    }
    const seen = new Set([segment]);
    let frontier = [segment];
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const id of frontier)
        for (const nb of adj.get(id) ?? []) {
          if (seen.has(nb) || byId.get(nb)?.label === "Segment") continue;
          seen.add(nb);
          next.push(nb);
        }
      frontier = next;
    }
    return seen;
  }, [segment, graph.edges, byId]);

  // Stable node objects so the simulation keeps positions across updates.
  const objs = useRef(new Map<string, FNode>());
  const shapeKey = `${segment}|${graph.nodes.length}|${graph.edges.length}`;
  const data = useMemo(() => {
    const nodes: FNode[] = [];
    for (const n of graph.nodes) {
      if (visible && !visible.has(n.id)) continue;
      let o = objs.current.get(n.id);
      if (!o) {
        // Spawn new nodes next to an existing neighbor (referrals grow out of their referrer).
        const nb = graph.edges.find((e) => e.from === n.id || e.to === n.id);
        const anchor = nb ? objs.current.get(nb.from === n.id ? nb.to : nb.from) : undefined;
        o = { id: n.id, label: n.label, name: nodeName(n), x: anchor?.x, y: anchor?.y };
        objs.current.set(n.id, o);
      }
      o.name = nodeName(n);
      nodes.push(o);
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links: FLink[] = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: e.id, type: e.type, source: e.from, target: e.to }));
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  const traceEvents = useMemo(() => store.events.filter((e) => nodeIdsOf(e).length > 0).slice().reverse(), [store.events]);
  const traceEvent = traceEvents.find((e) => e.id === traceEventId) ?? null;
  const highlight = useMemo(() => {
    if (trace && traceEvent) return new Set(nodeIdsOf(traceEvent));
    if (selectedId) {
      const s = new Set([selectedId]);
      for (const e of graph.edges) if (e.from === selectedId) s.add(e.to);
      else if (e.to === selectedId) s.add(e.from);
      return s;
    }
    return null;
  }, [trace, traceEvent, selectedId, graph.edges]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const counts = useMemo(() => {
    const c: Partial<Record<NodeLabel, number>> = {};
    for (const n of data.nodes) c[n.label] = (c[n.label] ?? 0) + 1;
    return c;
  }, [data.nodes]);

  return (
    <div className="flex h-dvh flex-col gap-3 px-4 py-4 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="flex items-center gap-2">
            Chart
            <span className={cn("size-1.5 rounded-full", connected ? "bg-lichen" : "bg-muted")} title={connected ? "Live" : "Disconnected"} />
          </Eyebrow>
          <h1 className="mt-1 text-[22px]">
            {data.nodes.length} nodes <span className="text-muted">·</span> <span className="text-body">{data.links.length} edges</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            Segment
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              className="h-8 max-w-[260px] rounded-control border border-hairline-strong bg-recessed px-2 text-[13px] text-strong"
            >
              <option value="all">All segments</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {nodeName(s)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant={trace ? "outline" : "raised"}
            aria-pressed={trace}
            onClick={() => {
              setTrace((t) => !t);
              setTraceEventId(null);
            }}
            className={cn(trace && "border-lichen/50 text-lichen")}
          >
            {trace ? "Trace on" : "Trace"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative min-h-[420px] overflow-hidden rounded-card border border-hairline bg-recessed">
          {data.nodes.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-muted">No graph yet. Sonar starts it.</div>
          ) : (
            <ForceCanvas data={data} highlight={highlight} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          <ul className="pointer-events-none absolute bottom-3 left-3 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1">
            {(Object.keys(counts) as NodeLabel[]).map((l) => (
              <li key={l} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-2 rounded-full" style={{ background: LABEL_COLOR[l] }} />
                {l} <span className="font-mono">{counts[l]}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-card border border-hairline bg-raised">
          {trace ? (
            <TraceFeed events={traceEvents} selectedId={traceEventId} onSelect={setTraceEventId} />
          ) : selected ? (
            <NodePanel node={selected} graph={graph} byId={byId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="p-4 text-[13px] text-muted">Click a node to inspect it. Turn on Trace to see what each event added.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TraceFeed({ events, selectedId, onSelect }: { events: RunEvent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <div className="border-b border-hairline px-4 py-3">
        <Eyebrow>Trace</Eyebrow>
        <p className="mt-0.5 text-[12px] text-muted">Pick an event to light up its nodes.</p>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {events.length === 0 && <li className="p-3 text-[13px] text-muted">No traceable events yet.</li>}
        {events.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelect(e.id)}
              aria-pressed={e.id === selectedId}
              className={cn(
                "flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left text-[12.5px] hover:bg-raised-hover",
                e.id === selectedId && "bg-raised-hover text-strong",
              )}
            >
              <DeptGlyph dept={e.dept} size={14} className="mt-0.5 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-body">{e.message}</span>
                <span className="font-mono text-[10.5px] text-muted">
                  #{e.seq} · {nodeIdsOf(e).length} node{nodeIdsOf(e).length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function isUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//.test(v);
}

function NodePanel({
  node,
  graph,
  byId,
  onSelect,
  onClose,
}: {
  node: GraphNode;
  graph: Graph;
  byId: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const props = Object.entries(node.props).filter(([k, v]) => v !== undefined && v !== null && k !== "name");
  const rels = graph.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => ({ e, other: byId.get(e.from === node.id ? e.to : e.from), out: e.from === node.id }))
    .filter((r) => r.other);

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: LABEL_COLOR[node.label] }} />
            <Eyebrow as="span">{node.label}</Eyebrow>
            {node.props.simulated === true && <Pill tone="muted">Simulated</Pill>}
          </span>
          <h2 className="mt-1 text-[16px] leading-snug">{nodeName(node)}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[12.5px]">
        {props.length > 0 && (
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
            {props.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="truncate text-muted">{k}</dt>
                <dd className="min-w-0 break-words">
                  {isUrl(v) ? (
                    <a href={v} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-strong hover:text-lichen">
                      <span className="truncate">{v.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      <ArrowUpRight className="size-3 shrink-0" />
                    </a>
                  ) : typeof v === "number" ? (
                    <span className="font-mono text-strong">{Number.isInteger(v) ? v : v.toFixed(2)}</span>
                  ) : (
                    <span className="text-body">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <section>
          <Eyebrow className="mb-1.5">Links · {rels.length}</Eyebrow>
          <ul className="space-y-1">
            {rels.map(({ e, other, out }) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(other!.id)} className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-raised-hover">
                  <span className="w-[92px] shrink-0 truncate font-mono text-[10.5px] text-muted">
                    {out ? "" : "← "}
                    {e.type}
                  </span>
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: LABEL_COLOR[other!.label] }} />
                  <span className="truncate text-body">{nodeName(other!)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
