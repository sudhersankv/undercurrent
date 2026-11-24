"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ChevronRight } from "lucide-react";
import { Card, DeptGlyph, DEPT_LABELS, Pill, VerdictChip } from "@/components/ui";
import { isEvent, type EventDept, type RunEvent } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { buildFeed, isPersona, type FeedItem } from "./feed-model";
import { useRun } from "./run-context";

const PERSONA_INTERVAL_MS = 200; // ≤5 persona lines per second
const PERSONA_BACKLOG = 6; // beyond this, older reactions are skipped (the map still counts them)

/** Releases persona reactions into the feed at ≤5/s without letting the feed fall behind. */
function usePersonaThrottle(events: RunEvent[]): ReadonlySet<number> {
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set());
  const decided = useRef(new Set<number>());
  const queue = useRef<number[]>([]);
  const primed = useRef(false);
  const scanned = useRef(0);

  useEffect(() => {
    const fresh: number[] = [];
    for (const e of events) if (e.seq > scanned.current && isPersona(e) && !decided.current.has(e.seq)) fresh.push(e.seq);
    if (events.length) scanned.current = events[events.length - 1].seq;
    if (!fresh.length) {
      if (events.length) primed.current = true;
      return;
    }
    if (!primed.current) {
      // history from a reload: show it as-is
      primed.current = true;
      fresh.forEach((s) => decided.current.add(s));
      setShown((p) => new Set([...p, ...fresh]));
      return;
    }
    queue.current.push(...fresh);
  }, [events]);

  useEffect(() => {
    const t = setInterval(() => {
      const q = queue.current;
      if (!q.length) return;
      while (q.length > PERSONA_BACKLOG) decided.current.add(q.shift()!);
      const next = q.shift()!;
      decided.current.add(next);
      setShown((p) => new Set(p).add(next));
    }, PERSONA_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return shown;
}

function useElapsed(events: RunEvent[]) {
  const t0 = events[0] ? Date.parse(events[0].at) : 0;
  return useCallback(
    (at: string) => {
      const s = Math.max(0, Math.round((Date.parse(at) - t0) / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    },
    [t0],
  );
}

const Time = ({ v }: { v: string }) => <span className="w-9 shrink-0 pt-px text-right font-mono text-[10.5px] text-muted tabular">{v}</span>;

function DeptTag({ dept }: { dept: EventDept }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
      <DeptGlyph dept={dept} size={14} />
      <span className="sr-only">{DEPT_LABELS[dept]}</span>
    </span>
  );
}

const Item = memo(function Item({ it, time }: { it: FeedItem; time: (at: string) => string }) {
  if (it.kind === "local") {
    const { item } = it;
    if (item.kind === "you")
      return (
        <div className="flex justify-end pl-12">
          <div className="max-w-[85%] rounded-card rounded-br-control bg-raised-hover px-3 py-2 text-[13px] text-strong">{item.text}</div>
        </div>
      );
    return (
      <div className={cn("flex gap-2.5 pr-6", item.kind === "error" ? "text-danger" : "text-strong")}>
        <Time v="" />
        {item.dept ? <DeptTag dept={item.dept} /> : null}
        <p className="text-[13px] leading-snug">{item.text}</p>
      </div>
    );
  }

  if (it.kind === "thinking") return <Thinking events={it.events} time={time} />;

  const e = it.e;
  switch (it.kind) {
    case "handoff": {
      const to = (e.toDept ?? (e.payload as { to?: EventDept }).to) as EventDept | undefined;
      return (
        <Card pad="sm" className="my-1 flex flex-col gap-2 border-hairline-strong">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-strong">
              <DeptGlyph dept={e.dept} size={14} />
              {DEPT_LABELS[e.dept]}
            </span>
            <ArrowRight className="size-3.5 text-lichen" aria-label="hands off to" />
            {to ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-strong">
                <DeptGlyph dept={to} size={14} />
                {DEPT_LABELS[to]}
              </span>
            ) : null}
            <span className="ml-auto font-mono text-[10.5px] text-muted tabular">{time(e.at)}</span>
          </div>
          {/* the header already says "A → B", so drop it from the message */}
          <p className="text-[14px] leading-snug text-strong">{e.message.replace(/^\s*\w+\s*(→|->)\s*\w+\s*:\s*/, "")}</p>
        </Card>
      );
    }
    case "persona": {
      const p = e.payload as { persona?: { label?: string } };
      const msg = e.message.replace(/^[^:]+:\s*/, "");
      return (
        <div className="flex gap-2.5 pr-6">
          <Time v={time(e.at)} />
          <DeptTag dept="swarm" />
          <p className="min-w-0 text-[13px] leading-snug text-body">
            <span className="mr-1.5 font-mono text-[11px] text-muted">{p.persona?.label ?? "persona"}</span>
            <span className="italic">{msg}</span>
          </p>
        </div>
      );
    }
    case "human":
      return (
        <div className="flex flex-col items-end gap-1 pl-12">
          <span className="eyebrow text-[10px]">You · {time(e.at)}</span>
          <div className="max-w-[85%] rounded-card rounded-br-control bg-raised-hover px-3 py-2 text-[13px] text-strong">{e.message}</div>
        </div>
      );
    case "chat": {
      const p = e.payload as { dept?: EventDept; text?: string };
      const dept = p.dept ?? e.dept;
      return (
        <div className="flex gap-2.5 pr-6">
          <Time v={time(e.at)} />
          <DeptTag dept={dept} />
          <div className="min-w-0 rounded-card rounded-bl-control border border-hairline bg-raised px-3 py-2">
            <span className="eyebrow text-[10px]">{DEPT_LABELS[dept]}</span>
            <p className="mt-0.5 text-[13px] leading-snug text-strong">{p.text ?? e.message}</p>
          </div>
        </div>
      );
    }
    case "result":
      return (
        <div className="flex gap-2.5 rounded-control bg-raised/50 py-1.5 pr-3">
          <Time v={time(e.at)} />
          <DeptTag dept={e.dept} />
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-strong">{e.message}</p>
          {isEvent(e, "sounding.verdict") ? <VerdictChip verdict={e.payload.verdict} className="self-start" /> : null}
        </div>
      );
    case "warning":
      return (
        <div className="flex gap-2.5 pr-6">
          <Time v={time(e.at)} />
          <DeptTag dept={e.dept} />
          <p className="text-[13px] leading-snug text-danger">{e.message}</p>
        </div>
      );
    default:
      return (
        <div className="flex gap-2.5 pr-6">
          <Time v={time(e.at)} />
          <DeptTag dept={e.dept} />
          <p className="text-[13px] leading-snug text-body">{e.message}</p>
        </div>
      );
  }
});

function Thinking({ events, time }: { events: RunEvent[]; time: (at: string) => string }) {
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  const depts = [...new Set(events.map((e) => e.dept))];
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex min-h-7 items-center gap-2.5 rounded-control pr-2 text-left text-muted transition-colors hover:bg-raised/60 hover:text-body"
      >
        <span className="w-9 shrink-0 text-right">
          <ChevronRight className={cn("ml-auto size-3.5 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {depts.map((d) => (
            <DeptGlyph key={d} dept={d} size={12} />
          ))}
        </span>
        <span className="shrink-0 text-[12px]">Agent thinking</span>
        <span className="font-mono text-[11px] tabular">{events.length}</span>
        {!open ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted/80">{last.message}</span> : null}
      </button>
      {open ? (
        <ol className="ml-[46px] flex flex-col gap-1 border-l border-hairline pl-3">
          {events.map((e) => (
            <li key={e.seq} className="flex gap-2 font-mono text-[11.5px] leading-snug text-body">
              <span className="shrink-0 text-muted tabular">{time(e.at)}</span>
              <span className="min-w-0 break-words">{e.message}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function HandoffFeed() {
  const { store, local } = useRun();
  const shownPersonas = usePersonaThrottle(store.events);
  const items = useMemo(() => buildFeed(store.events, local, shownPersonas), [store.events, local, shownPersonas]);
  const time = useElapsed(store.events);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [items, pinned]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <section aria-label="Handoff feed" className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="eyebrow">Handoffs</h2>
        <Pill tone="muted" mono>
          {store.events.length} events
        </Pill>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-4" role="log">
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Waiting for Sonar.</div>
        ) : (
          items.map((it) => <Item key={it.key} it={it} time={time} />)
        )}
      </div>
      {!pinned ? (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute bottom-3 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-hairline-strong bg-raised-hover px-3 text-[12px] text-strong"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Latest
        </button>
      ) : null}
    </section>
  );
}
