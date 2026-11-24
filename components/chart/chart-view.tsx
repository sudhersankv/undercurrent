"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, Building2, Crosshair, FileText, GitBranch, Lightbulb, Maximize2, MessageCircle, MousePointerClick, Package, PanelRightOpen, Send, Share2, Swords, User, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import type { RunEvent, Verdict } from "@/lib/contracts";
import type { GraphEdge, GraphNode, NodeLabel } from "@/lib/graph/types";
import { useRun } from "@/components/mission/run-context";
import { SegmentDrawer } from "@/components/segment-drawer";
import { Button, DeptGlyph, Eyebrow, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LABEL_COLOR, deriveGraph, mergeGraphs } from "./derive";
import type { ChartApi, FLink, FNode, LabelDensity } from "./force-canvas";

const ForceCanvas = dynamic(() => import("./force-canvas"), {
  ssr: false,
  loading: () => <GraphSkeleton />,
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
  const { store, status } = useRun();
  const connected = status === "live";
  const server = useServerGraph(runId);
  const derived = useMemo(() => deriveGraph(store), [store]);
  const graph = useMemo(() => mergeGraphs(server, derived), [server, derived]);

  const [segment, setSegment] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trace, setTrace] = useState(false);
  const [traceEventId, setTraceEventId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [density, setDensity] = useState<LabelDensity>(0);
  const [drawerSeg, setDrawerSeg] = useState<string | null>(null);
  const api = useRef<ChartApi | null>(null);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const segments = useMemo(() => graph.nodes.filter((n) => n.label === "Segment"), [graph.nodes]);
  const verdicts = useMemo(() => Object.fromEntries(segments.map((n) => [n.id, n.props.verdict as Verdict | undefined])), [segments]);

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
    // Hover previews a neighborhood; selection pins one.
    const focus = hoverId ?? selectedId;
    if (focus) {
      const s = new Set([focus]);
      for (const e of graph.edges) if (e.from === focus) s.add(e.to);
      else if (e.to === focus) s.add(e.from);
      return s;
    }
    return null;
  }, [trace, traceEvent, selectedId, hoverId, graph.edges]);


  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const counts = useMemo(() => {
    const c: Partial<Record<NodeLabel, number>> = {};
    for (const n of data.nodes) c[n.label] = (c[n.label] ?? 0) + 1;
    return c;
  }, [data.nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const l of data.links) {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      d.set(s, (d.get(s) ?? 0) + 1);
      d.set(t, (d.get(t) ?? 0) + 1);
    }
    return d;
  }, [data.links]);
  const hubs = useMemo(
    () =>
      data.nodes
        .filter((n) => n.label !== "Company")
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
        .slice(0, 5),
    [data.nodes, degree],
  );

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow className="flex items-center gap-2">
            Chart
            <span className={cn("inline-flex items-center gap-1 normal-case tracking-normal", connected ? "text-forest" : "text-muted")}>
              <span className={cn("size-1.5 rounded-full", connected ? "animate-pulse bg-forest" : "bg-pebble")} />
              {connected ? "Live" : "Offline"}
            </span>
          </Eyebrow>
          <h1 className="tabular mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em] text-strong md:text-[32px]">
            {data.nodes.length} nodes <span className="font-semibold text-muted">· {data.links.length} edges</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="chart-segment">
            Segment
          </label>
          <select
            id="chart-segment"
            value={segment}
            onChange={(e) => {
              setSegment(e.target.value);
              setSelectedId(null);
            }}
            className="h-9 max-w-[240px] cursor-pointer truncate rounded-pill border border-hairline-strong bg-paper pr-8 pl-4 text-[13px] font-semibold text-strong transition-colors duration-150 hover:border-forest focus:border-forest focus:outline-none"
          >
            <option value="all">All segments</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {nodeName(s)}
              </option>
            ))}
          </select>
          <Button
            variant={trace ? "outline" : "raised"}
            aria-pressed={trace}
            onClick={() => {
              setTrace((t) => !t);
              setTraceEventId(null);
            }}
          >
            <Share2 />
            {trace ? "Tracing" : "Trace"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_280px] min-[1400px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-h-[420px] overflow-hidden rounded-card border border-hairline bg-paper">
          {data.nodes.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex max-w-xs flex-col items-center text-center">
                <span className="grid size-10 place-items-center rounded-full bg-raised text-forest">
                  <Share2 className="size-5" />
                </span>
                <p className="mt-3 text-[14px] font-semibold text-strong">No graph yet</p>
                <p className="mt-1 text-[13px] text-muted">Sonar starts it as soon as it reads the company.</p>
              </div>
            </div>
          ) : (
            <ForceCanvas
              data={data}
              highlight={highlight}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={setSelectedId}
              onHover={setHoverId}
              verdicts={verdicts}
              density={density}
              apiRef={api}
            />
          )}

          <div className="absolute top-3 right-3 flex items-center gap-2">
            <div role="group" aria-label="Label density" className="flex items-center gap-0.5 rounded-pill border border-hairline bg-paper p-0.5 shadow-float">
              <span className="pr-1 pl-2.5 text-[11px] font-semibold text-muted">Labels</span>
              {(
                [
                  [0, "Key"],
                  [1, "More"],
                  [2, "All"],
                ] as const
              ).map(([d, l]) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={density === d}
                  onClick={() => setDensity(d)}
                  className={cn(
                    "h-7 cursor-pointer rounded-pill px-2.5 text-[12px] font-semibold transition-colors duration-150 ease-out-soft",
                    density === d ? "bg-forest text-paper" : "text-charcoal hover:bg-raised",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Zoom" className="flex items-center rounded-pill border border-hairline bg-paper p-0.5 shadow-float">
              <IconBtn label="Zoom out" onClick={() => api.current?.zoomOut()}>
                <ZoomOut />
              </IconBtn>
              <IconBtn label="Zoom in" onClick={() => api.current?.zoomIn()}>
                <ZoomIn />
              </IconBtn>
              <span className="mx-0.5 h-4 w-px bg-hairline" aria-hidden />
              <IconBtn label="Fit to view" onClick={() => api.current?.fit()}>
                <Maximize2 />
              </IconBtn>
            </div>
          </div>

          <Legend counts={counts} />
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-card border border-hairline bg-paper">
          {trace ? (
            <TraceFeed events={traceEvents} selectedId={traceEventId} onSelect={setTraceEventId} />
          ) : selected ? (
            <NodePanel
              key={selected.id}
              node={selected}
              graph={graph}
              byId={byId}
              onSelect={setSelectedId}
              onPreview={setHoverId}
              onClose={() => setSelectedId(null)}
              onOpenSegment={setDrawerSeg}
              hasSegment={!!store.segments[selected.id]}
            />
          ) : (
            <EmptyPanel hubs={hubs} degree={degree} onSelect={setSelectedId} onPreview={setHoverId} />
          )}
        </aside>
      </div>

      <SegmentDrawer runId={runId} store={store} segmentId={drawerSeg} onClose={() => setDrawerSeg(null)} />
    </div>
  );
}

const LEGEND_ORDER: NodeLabel[] = ["Company", "Product", "Segment", "Capability", "Competitor", "Persona", "Evidence", "Person", "Repo", "Tech", "Draft", "Outcome"];

const LABEL_ICON: Partial<Record<NodeLabel, React.ComponentType<{ className?: string }>>> = {
  Company: Building2,
  Product: Package,
  Segment: Crosshair,
  Capability: Lightbulb,
  Competitor: Swords,
  Persona: Users,
  Evidence: FileText,
  Person: User,
  Repo: GitBranch,
  Draft: Send,
  Outcome: MessageCircle,
};

function NodeDot({ label, className }: { label: NodeLabel; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full border",
        label === "Persona" ? "border-dashed border-pebble bg-paper" : label === "Segment" ? "border-[1.5px] border-spruce bg-lime" : "border-black/10",
        className,
      )}
      style={label === "Persona" || label === "Segment" ? undefined : { background: LABEL_COLOR[label] }}
    />
  );
}

/** Collapsible legend: open by default on wide screens, a single pill on narrow ones so it never buries the graph. */
function Legend({ counts }: { counts: Partial<Record<NodeLabel, number>> }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(window.matchMedia("(min-width: 1400px)").matches);
  }, []);
  const labels = LEGEND_ORDER.filter((l) => counts[l]);
  if (!labels.length) return null;
  return (
    <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] items-end gap-1.5">
      {open ? (
        <ul aria-label="Legend" className="flex animate-in flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-hairline bg-paper/95 py-2 pr-2 pl-3 duration-150 fade-in-0">
          {labels.map((l) => (
            <li key={l} className="flex items-center gap-1.5 text-[11px] font-semibold text-charcoal">
              <NodeDot label={l} />
              {l}
              {l === "Persona" ? <span className="font-normal text-muted">(simulated)</span> : null}
              <span className="tabular font-normal text-muted">{counts[l]}</span>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setOpen(false)} aria-label="Hide legend" className="grid size-5 cursor-pointer place-items-center rounded-full text-muted hover:bg-raised hover:text-forest">
              <X className="size-3" />
            </button>
          </li>
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-pill border border-hairline bg-paper px-3 text-[12px] font-semibold text-charcoal shadow-float transition-colors duration-150 hover:bg-linen/60"
        >
          <span className="flex -space-x-0.5" aria-hidden>
            {labels.slice(0, 5).map((l) => (
              <NodeDot key={l} label={l} className="ring-2 ring-paper" />
            ))}
          </span>
          Legend
        </button>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-full text-forest transition-colors duration-150 ease-out-soft hover:bg-raised active:scale-95 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function GraphSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center" aria-label="Loading graph">
      <div className="relative size-40 animate-pulse">
        {[
          [50, 50, 14],
          [20, 30, 8],
          [80, 25, 8],
          [75, 78, 8],
          [25, 75, 8],
        ].map(([x, y, s], i) => (
          <span key={i} className="absolute rounded-full bg-raised" style={{ left: `${x}%`, top: `${y}%`, width: s * 2, height: s * 2, transform: "translate(-50%,-50%)" }} />
        ))}
      </div>
    </div>
  );
}

function EmptyPanel({
  hubs,
  degree,
  onSelect,
  onPreview,
}: {
  hubs: FNode[];
  degree: Map<string, number>;
  onSelect: (id: string) => void;
  onPreview: (id: string | null) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <span className="grid size-10 place-items-center rounded-full bg-raised text-forest">
        <MousePointerClick className="size-5" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-strong">Pick a node</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">Every fact the team found, linked to where it came from.</p>
      <ul className="mt-4 space-y-2 text-[12.5px] text-body">
        <li className="flex items-center gap-2.5">
          <Kbd>Hover</Kbd> lights up its neighbors
        </li>
        <li className="flex items-center gap-2.5">
          <Kbd>Click</Kbd> pins it and shows details
        </li>
        <li className="flex items-center gap-2.5">
          <Kbd>Scroll</Kbd> zooms in for more labels
        </li>
      </ul>
      {hubs.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-strong">Most connected</h2>
          <ul className="-mx-2 space-y-0.5">
            {hubs.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onSelect(n.id)}
                  onMouseEnter={() => onPreview(n.id)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(n.id)}
                  onBlur={() => onPreview(null)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-card px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-linen/60"
                >
                  <NodeDot label={n.label} />
                  <span className="min-w-0 flex-1 truncate text-strong" title={n.name}>
                    {n.name}
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted">{degree.get(n.id) ?? 0} links</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-14 items-center justify-center rounded border border-hairline bg-recessed px-1.5 font-sans text-[11px] font-semibold text-charcoal">{children}</kbd>;
}

function TraceFeed({ events, selectedId, onSelect }: { events: RunEvent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-[15px] font-semibold text-strong">Trace</p>
        <p className="mt-0.5 text-[12px] text-muted">Pick an event to light up the nodes it added.</p>
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
                "flex w-full cursor-pointer items-start gap-2.5 rounded-card px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-linen/50",
                e.id === selectedId && "bg-linen text-strong hover:bg-linen",
              )}
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raised text-forest">
                <DeptGlyph dept={e.dept} size={12} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-body">{e.message}</span>
                <span className="tabular text-[11px] text-muted">
                  {nodeIdsOf(e).length} node{nodeIdsOf(e).length === 1 ? "" : "s"}
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

const humanKey = (k: string) => {
  const s = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const humanEdge = (t: string) => humanKey(t.toLowerCase().replace(/_/g, " "));
const SPECIAL = new Set(["name", "quote", "verdict", "simInterest", "evidenceStrength", "url", "simulated", "leadId"]);

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function NodePanel({
  node,
  graph,
  byId,
  onSelect,
  onPreview,
  onClose,
  onOpenSegment,
  hasSegment,
}: {
  node: GraphNode;
  graph: Graph;
  byId: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  onPreview: (id: string | null) => void;
  onClose: () => void;
  onOpenSegment: (id: string) => void;
  hasSegment: boolean;
}) {
  const p = node.props as Record<string, unknown>;
  const props = Object.entries(p).filter(([k, v]) => v !== undefined && v !== null && v !== "" && !SPECIAL.has(k));
  const rels = graph.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => ({ e, other: byId.get(e.from === node.id ? e.to : e.from), out: e.from === node.id }))
    .filter((r): r is { e: GraphEdge; other: GraphNode; out: boolean } => !!r.other);
  const groups = new Map<string, typeof rels>();
  for (const r of rels) groups.set(r.e.type, [...(groups.get(r.e.type) ?? []), r]);
  const Icon = LABEL_ICON[node.label] ?? Share2;
  const url = isUrl(p.url) ? p.url : null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  return (
    <>
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-forest">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            {node.label}
            {p.simulated === true && <Pill tone="muted">Simulated</Pill>}
          </p>
          <h2 className="mt-0.5 text-[16px] leading-snug font-semibold text-strong">{nodeName(node)}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 size-8">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-[12.5px]">
        {node.label === "Segment" ? (
          <section className="space-y-3">
            {p.verdict ? <VerdictChip verdict={p.verdict as Verdict} /> : null}
            <div className="space-y-2">
              <Meter label="Real" sub="evidence" value={num(p.evidenceStrength)} />
              <Meter label="Simulated" sub="swarm" value={num(p.simInterest)} simulated />
            </div>
            {hasSegment ? (
              <Button variant="cta" size="sm" onClick={() => onOpenSegment(node.id)}>
                <PanelRightOpen />
                Open segment
              </Button>
            ) : null}
          </section>
        ) : null}
        {typeof p.quote === "string" && p.quote ? (
          <blockquote className="border-l-2 border-forest/30 pl-3 text-[13px] leading-relaxed text-strong">“{p.quote}”</blockquote>
        ) : null}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-card bg-recessed px-3 py-2 text-[12.5px] text-forest transition-colors duration-150 hover:bg-linen">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=32`} alt="" className="size-4 rounded-sm" />
            <span className="min-w-0 flex-1 truncate font-semibold">{url.replace(/^https?:\/\/(www\.)?/, "")}</span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </a>
        ) : null}
        {props.length > 0 && (
          <dl className="divide-y divide-hairline">
            {props.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
                <dt className="shrink-0 text-muted">{humanKey(k)}</dt>
                <dd className="min-w-0 text-right break-words">
                  {isUrl(v) ? (
                    <a href={v} target="_blank" rel="noreferrer" className="link-underline inline-flex max-w-full items-center gap-1">
                      <span className="truncate">{v.replace(/^https?:\/\/(www\.)?/, "")}</span>
                      <ArrowUpRight className="size-3 shrink-0" />
                    </a>
                  ) : typeof v === "number" ? (
                    <span className="tabular font-semibold text-strong">{Number.isInteger(v) ? v : v.toFixed(2)}</span>
                  ) : typeof v === "boolean" ? (
                    <span className="text-strong">{v ? "Yes" : "No"}</span>
                  ) : (
                    <span className="text-strong">{typeof v === "object" ? JSON.stringify(v) : String(v).replace(/_/g, " ")}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-strong">
            Links
            <span className="tabular rounded-pill bg-raised px-2 text-[11px] leading-5 font-semibold text-charcoal">{rels.length}</span>
          </h3>
          <div className="space-y-3">
            {[...groups.entries()].map(([type, list]) => (
              <div key={type}>
                <p className="mb-0.5 text-[11px] font-semibold text-muted">
                  {humanEdge(type)} <span className="tabular font-normal">{list.length}</span>
                </p>
                <ul className="-mx-2">
                  {list.map(({ e, other, out }) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(other.id)}
                        onMouseEnter={() => onPreview(other.id)}
                        onMouseLeave={() => onPreview(null)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-card px-2 py-1.5 text-left transition-colors duration-150 hover:bg-linen/60"
                      >
                        <NodeDot label={other.label} />
                        <span className="min-w-0 flex-1 truncate text-body" title={nodeName(other)}>
                          {nodeName(other)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">
                          {out ? "→" : "←"} {other.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Meter({ label, sub, value, simulated }: { label: string; sub: string; value: number | null; simulated?: boolean }) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="grid grid-cols-[120px_1fr_32px] items-center gap-2 text-xs">
      <span>
        <span className="font-semibold text-strong">{label}</span> <span className="text-muted">{sub}</span>
      </span>
      <span className={cn("relative h-2 overflow-hidden rounded-pill", simulated ? "border border-dashed border-pebble bg-paper" : "bg-raised")}>
        <span className={cn("absolute inset-y-0 left-0 rounded-pill", simulated ? "bg-pebble/50" : "bg-forest")} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="tabular text-right font-semibold text-strong">{value == null ? "–" : value.toFixed(2)}</span>
    </div>
  );
}
