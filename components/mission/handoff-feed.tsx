"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight, TriangleAlert } from "lucide-react";
import { DeptChip, DeptGlyph, DeptIcon, DEPT_LABELS, VerdictChip } from "@/components/ui";
import { isEvent, type EventDept, type RunEvent } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { buildFeed, isKeyMoment, isPersona, type FeedItem } from "./feed-model";
import { isRunOver, useRun } from "./run-context";
import { relTime, STAGE_LABEL } from "./run-status";
import { PulseDot } from "./status-pill";
import { useNow } from "./use-now";

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

type Rel = (at: string) => string;

const MENTION = /(@[a-z]+)/gi;

/** Renders `@sounding` style department mentions as linen pills. */
function WithMentions({ text }: { text: string }) {
  const parts = text.split(MENTION);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        const d = p.slice(1).toLowerCase();
        if (i % 2 === 1 && Object.hasOwn(DEPT_LABELS, d))
          return (
            <span key={i} className="mx-0.5 inline-flex items-center gap-1 rounded-pill bg-paper/80 px-1.5 align-baseline text-[12px] font-semibold leading-5 text-forest">
              <DeptGlyph dept={d as EventDept} size={10} aria-hidden />
              {DEPT_LABELS[d as EventDept]}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function When({ at, rel, hover }: { at: string; rel: Rel; hover?: boolean }) {
  return (
    <time
      dateTime={at}
      title={new Date(at).toLocaleTimeString()}
      className={cn("shrink-0 text-[11px] font-medium text-muted tabular", hover && "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100")}
    >
      {rel(at)}
    </time>
  );
}

/** A compact timeline row: rail + small dept icon + one line of text. */
function Row({ dept, children, at, rel, tone = "body", extra }: { dept: EventDept; children: React.ReactNode; at?: string; rel: Rel; tone?: "body" | "strong" | "danger"; extra?: React.ReactNode }) {
  return (
    <div className="group/row relative flex items-start gap-2.5 py-1 pl-1 pr-1">
      <span aria-hidden className="absolute bottom-0 left-[14px] top-0 w-px bg-hairline" />
      <DeptIcon dept={dept} size="xs" tone={tone === "strong" ? "linen" : "fog"} className="relative mt-px ring-2 ring-paper" />
      <p
        className={cn(
          "min-w-0 flex-1 pt-0.5 text-[13px] leading-snug",
          tone === "strong" && "font-medium text-strong",
          tone === "body" && "text-body",
          tone === "danger" && "font-medium text-danger",
        )}
      >
        {children}
      </p>
      {extra}
      {at ? <When at={at} rel={rel} hover /> : null}
    </div>
  );
}

const Bubble = ({ children }: { children: React.ReactNode }) => (
  <div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-forest px-3.5 py-2 text-[14px] leading-snug text-paper">{children}</div>
);

const Item = memo(function Item({ it, rel }: { it: FeedItem; rel: Rel }) {
  if (it.kind === "stage") {
    const s = STAGE_LABEL[it.state];
    if (!s) return null;
    return (
      <div className="sticky top-0 z-10 -mx-3 flex h-10 items-center gap-2 bg-paper px-4 pt-1">
        {s.dept === "helm" ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-raised text-forest">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
        ) : (
          <DeptIcon dept={s.dept} size="xs" tone="forest" />
        )}
        <span className="text-[13px] font-semibold text-strong">{s.title}</span>
        {s.sub ? <span className="text-[12px] text-muted">{s.sub}</span> : null}
        <span aria-hidden className="h-px flex-1 bg-hairline" />
        <span className="text-[11px] font-medium text-muted tabular" title={`${it.count} events`}>
          {it.count}
        </span>
      </div>
    );
  }

  if (it.kind === "local") {
    const { item } = it;
    if (item.kind === "you")
      return (
        <div className="flex justify-end py-1 pl-12">
          <Bubble>
            <WithMentions text={item.text} />
          </Bubble>
        </div>
      );
    return (
      <div className={cn("flex gap-2.5 py-1 pr-6", item.kind === "error" ? "text-danger" : "text-strong")}>
        {item.dept ? <DeptIcon dept={item.dept} size="sm" /> : <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />}
        <p className="pt-0.5 text-[14px] leading-snug">
          <WithMentions text={item.text} />
        </p>
      </div>
    );
  }

  if (it.kind === "thinking") return <Thinking events={it.events} rel={rel} />;

  const e = it.e;
  switch (it.kind) {
    case "handoff": {
      const to = (e.toDept ?? (e.payload as { to?: EventDept }).to) as EventDept | undefined;
      return (
        <div className="my-1.5 rounded-card bg-linen px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <DeptChip dept={e.dept} />
            <ArrowRight className="size-3.5 shrink-0 text-forest" aria-label="hands off to" />
            {to ? <DeptChip dept={to} /> : null}
            <span className="ml-auto pl-2">
              <When at={e.at} rel={rel} />
            </span>
          </div>
          {/* the header already says "A → B", so drop it from the message */}
          <p className="mt-2 text-[14px] leading-snug text-strong">{e.message.replace(/^\s*\w+\s*(→|->)\s*\w+\s*:\s*/, "")}</p>
        </div>
      );
    }
    case "persona": {
      const p = e.payload as { persona?: { label?: string }; reaction?: { oneLineReaction?: string } };
      const label = (p.persona?.label ?? "Persona").replace(/^persona:\s*/i, "");
      const quote = p.reaction?.oneLineReaction ?? /"(.+)"\s*$/.exec(e.message)?.[1] ?? e.message.replace(/^.*?:\s*/, "");
      const msg = `“${quote.replace(/^["“]|["”]$/g, "")}”`;
      return (
        <div className="group/row relative flex items-start gap-2.5 py-1 pl-1 pr-1">
          <span aria-hidden className="absolute bottom-0 left-[14px] top-0 w-px bg-hairline" />
          <DeptIcon dept="swarm" size="xs" className="relative mt-px ring-2 ring-paper" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-muted">
              {label} <span className="font-medium">· Simulated</span>
            </p>
            <p className="text-[13px] leading-snug text-body">{msg}</p>
          </div>
        </div>
      );
    }
    case "human":
      return (
        <div className="flex flex-col items-end gap-1 py-1 pl-12">
          <span className="text-[11px] font-medium text-muted">
            You · <span className="tabular">{rel(e.at)}</span>
          </span>
          <Bubble>
            <WithMentions text={e.message} />
          </Bubble>
        </div>
      );
    case "chat": {
      const p = e.payload as { dept?: EventDept; text?: string };
      const dept = p.dept ?? e.dept;
      return (
        <div className="flex gap-2.5 py-1 pr-6">
          <DeptIcon dept={dept} size="sm" tone="forest" className="mt-0.5" />
          <div className="min-w-0 rounded-[16px] rounded-tl-[6px] border border-hairline bg-paper px-3.5 py-2">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-forest">
              {DEPT_LABELS[dept]}
              <When at={e.at} rel={rel} />
            </span>
            <p className="mt-0.5 text-[14px] leading-snug text-strong">
              <WithMentions text={p.text ?? e.message} />
            </p>
          </div>
        </div>
      );
    }
    case "end":
      return (
        <div className="flex items-center gap-2 py-3">
          <span aria-hidden className="h-px flex-1 bg-hairline" />
          <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-raised pl-1 pr-2.5 text-[12px] font-semibold text-forest">
            <span className="flex size-4 items-center justify-center rounded-full bg-forest text-lime">
              <Check className="size-2.5" strokeWidth={3.5} aria-hidden />
            </span>
            Run complete
          </span>
          <span aria-hidden className="h-px flex-1 bg-hairline" />
        </div>
      );
    case "result":
      return (
        <Row dept={e.dept} at={e.at} rel={rel} tone="strong" extra={isEvent(e, "sounding.verdict") ? <VerdictChip verdict={e.payload.verdict} className="shrink-0 self-start" /> : null}>
          {isEvent(e, "sounding.verdict") ? e.message.replace(/:\s*(VERIFIED|PROMISING|HYPE|KILLED)\b.*$/, "") : e.message}
        </Row>
      );
    case "warning":
      return (
        <Row dept={e.dept} at={e.at} rel={rel} tone="danger">
          {e.message}
        </Row>
      );
    default:
      return (
        <Row dept={e.dept} at={e.at} rel={rel}>
          {e.message}
        </Row>
      );
  }
});

function Thinking({ events, rel }: { events: RunEvent[]; rel: Rel }) {
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  return (
    <div className="relative flex flex-col">
      <span aria-hidden className="absolute bottom-0 left-[14px] top-0 w-px bg-hairline" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative flex min-h-7 cursor-pointer items-center gap-2.5 rounded-pill py-0.5 pl-1 pr-2 text-left text-muted transition-colors hover:bg-recessed hover:text-body"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-paper ring-2 ring-paper">
          <ChevronRight className={cn("size-3.5 transition-transform duration-150 ease-out-soft", open && "rotate-90")} aria-hidden />
        </span>
        <span className="shrink-0 text-[12px] font-medium">
          {events.length} {events.length === 1 ? "step" : "steps"}
        </span>
        {!open ? <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{last.message}</span> : null}
      </button>
      {open ? (
        <ol className="relative ml-[34px] flex flex-col gap-1 py-1 animate-in fade-in duration-150">
          {events.map((e) => (
            <li key={e.seq} className="flex gap-2 text-[12px] leading-snug text-body">
              <span className="min-w-0 flex-1 break-words">{e.message}</span>
              <span className="shrink-0 text-[11px] text-muted tabular">{rel(e.at)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

type Filter = "all" | "key";

function groupByStage(items: FeedItem[]): FeedItem[][] {
  const out: FeedItem[][] = [];
  for (const it of items) {
    if (it.kind === "stage" || !out.length) out.push([it]);
    else out[out.length - 1].push(it);
  }
  return out;
}

export function HandoffFeed() {
  const { store, local } = useRun();
  const shownPersonas = usePersonaThrottle(store.events);
  const all = useMemo(() => buildFeed(store.events, local, shownPersonas), [store.events, local, shownPersonas]);
  const [filter, setFilter] = useState<Filter>("all");
  const keyItems = useMemo(() => {
    const k = all.filter(isKeyMoment);
    // drop stage headers that ended up with nothing under them
    return k.filter((it, i) => it.kind !== "stage" || i === k.length - 1 || k[i + 1].kind !== "stage");
  }, [all]);
  const items = filter === "key" ? keyItems : all;
  const keyCount = keyItems.filter((i) => i.kind !== "stage").length;
  const now = useNow(15_000);
  const rel = useMemo<Rel>(() => (at) => relTime(at, now), [now]);
  const running = store.events.length > 0 && !isRunOver(store);

  // animate only items that arrive after the first paint (not the replayed history)
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && all.length) seen.current = new Set(all.map((i) => i.key));
  const isNew = (k: string) => seen.current !== null && !seen.current.has(k);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const added = Math.max(0, items.length - lastLen.current);
    lastLen.current = items.length;
    if (!el) return;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else if (added) setUnread((u) => u + added);
  }, [items, pinned]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom !== pinned) setPinned(atBottom);
  };

  const jump = () => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  return (
    <section aria-label="Team activity" className="relative flex min-h-0 flex-1 flex-col bg-paper">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <h2 className="text-[15px] font-semibold text-strong">Activity</h2>
        {running ? <PulseDot className="ml-0.5" /> : null}
        <div role="radiogroup" aria-label="Filter activity" className="ml-auto inline-flex rounded-pill bg-raised p-0.5">
          {(
            [
              ["all", "All"],
              ["key", `Key moments`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={filter === v}
              onClick={() => setFilter(v)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-semibold transition-colors duration-150",
                filter === v ? "bg-paper text-strong shadow-[0_0_0_1px_var(--color-hairline)]" : "text-charcoal hover:text-strong",
              )}
            >
              {label}
              {v === "key" && keyCount ? <span className="text-[11px] text-muted tabular">{keyCount}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4" role="log" aria-live="polite">
        {items.length === 0 ? (
          <FeedEmpty />
        ) : (
          // One block per stage so each sticky header scrolls away with its own items instead of stacking.
          groupByStage(items).map((g) => (
            <div key={g[0].key}>
              {g.map((it) => (
                <div key={it.key} className={cn(it.kind === "stage" && "contents", isNew(it.key) && "animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out-soft")}>
                  <Item it={it} rel={rel} />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      {!pinned ? (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-pill bg-forest px-3.5 text-[13px] font-semibold text-paper shadow-float transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 hover:bg-spruce"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {unread > 0 ? `${unread} new` : "Latest"}
        </button>
      ) : null}
    </section>
  );
}

function FeedEmpty() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-1 pt-4">
      <div className="flex items-center gap-3 rounded-card bg-recessed p-3">
        <span className="relative flex size-9 items-center justify-center rounded-full bg-forest text-lime">
          <DeptGlyph dept="sonar" size={16} aria-hidden />
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-forest/25 [animation-duration:2s]" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-strong">Waiting for Sonar</p>
          <p className="text-[12px] text-muted">Handoffs between departments show up here.</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-1" aria-hidden>
        {[72, 56, 84, 48].map((w, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="size-5 shrink-0 animate-pulse rounded-full bg-raised" />
            <span className="h-3 animate-pulse rounded-full bg-raised" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
