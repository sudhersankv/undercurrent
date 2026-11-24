"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, GitBranch, Inbox as InboxIcon, Lock, MailOpen, TrendingDown, TrendingUp, UserPlus } from "lucide-react";
import { useRun } from "@/components/mission/run-context";
import { Button, DeptGlyph, Pill } from "@/components/ui";
import { ChannelGlyph, CHANNEL_LABEL, MailGlyph, ReplyToCard, XGlyph, xIntentUrl } from "@/components/review/x";
import { StatusPill } from "@/components/review/draft-card";
import { Avatar, relTimeShort } from "@/components/review/parts";
import { cn } from "@/lib/utils";
import type { ReplyClass } from "@/lib/contracts";
import { FOLDERS, INTENT_LABEL, inFolder, NEXT_LABEL, type InboxChannel, type InboxData, type InboxFolder, type InboxReply, type InboxThread } from "./model";

const REFRESH_ON = new Set(["tide.sent", "tide.approved", "tide.draft_created", "tide.draft_updated", "wake.reply_received", "wake.classified", "wake.referral_created", "wake.stage_changed"]);

/** Fetch the inbox, refetching (debounced) whenever the run stream reports a send, reply, or referral. */
function useInbox(runId: string) {
  const { store } = useRun();
  const [data, setData] = React.useState<InboxData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/inbox`, { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 404 ? "Run not found." : `Inbox failed (${res.status}).`);
        return;
      }
      setData((await res.json()) as InboxData);
      setError(null);
    } catch {
      setError("Network error. Retrying.");
    }
  }, [runId]);

  const relevantSeq = React.useMemo(() => {
    for (let i = store.events.length - 1; i >= 0; i--) if (REFRESH_ON.has(store.events[i].type)) return store.events[i].seq;
    return 0;
  }, [store.events]);

  React.useEffect(() => {
    const t = setTimeout(load, relevantSeq ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, relevantSeq]);

  return { data, error, reload: load };
}

type ChannelFilter = "all" | InboxChannel;

const INTENT_TONE: Record<ReplyClass["intent"], string> = {
  interested: "bg-lime text-forest",
  referral: "bg-forest text-lime",
  question: "bg-raised text-charcoal",
  not_now: "bg-raised text-charcoal",
  not_relevant: "bg-[#fde8e4] text-[#8a1c22]",
  unsubscribe: "bg-[#fde8e4] text-[#8a1c22]",
  auto_reply: "border border-hairline text-muted",
};

export function InboxView({ runId }: { runId: string }) {
  const { data, error, reload } = useInbox(runId);
  const [folder, setFolder] = React.useState<InboxFolder>("all");
  const [channel, setChannel] = React.useState<ChannelFilter>("all");
  const [sel, setSel] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const threads = data?.threads ?? [];
  const byChannel = threads.filter((t) => channel === "all" || t.channel === channel);
  const list = byChannel.filter((t) => inFolder(t, folder));
  const cur = list.find((t) => t.id === sel) ?? list[0] ?? null;
  const count = (f: InboxFolder) => byChannel.filter((t) => inFolder(t, f)).length;
  const chCount = (c: ChannelFilter) => threads.filter((t) => c === "all" || t.channel === c).length;
  const replies = threads.reduce((n, t) => n + t.replies.length, 0);

  // j/k through threads, like the review queue.
  const nav = React.useRef({ list, cur });
  nav.current = { list, cur };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const { list: l, cur: c } = nav.current;
      if (!l.length) return;
      const i = c ? l.indexOf(c) : 0;
      if (e.key === "j" || e.key === "ArrowDown") setSel(l[Math.min(l.length - 1, i + 1)].id);
      else if (e.key === "k" || e.key === "ArrowUp") setSel(l[Math.max(0, i - 1)].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-6 pb-4 md:px-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-strong">Inbox</h1>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <MailGlyph size={13} />
          <span className="truncate font-mono text-charcoal">{data?.sender?.inboxId ?? "fixture inbox"}</span>
        </span>
        {data?.sender?.safeMode ? (
          <Pill tone="lichen" className="font-semibold" title="Email only goes to our own AgentMail inboxes. Real developers are never contacted.">
            <Lock className="size-3" />
            Send lock{data.sender?.standIn ? ` · stand-in ${data.sender?.standIn}` : ""}
          </Pill>
        ) : null}
        <span className="ml-auto flex items-center gap-4 text-[13px] text-muted">
          {error ? (
            <span className="font-medium text-danger" role="status">
              {error}
            </span>
          ) : data ? (
            <>
              <span>
                <span className="tabular font-semibold text-strong">{threads.length}</span> {threads.length === 1 ? "thread" : "threads"}
              </span>
              <span>
                <span className="tabular font-semibold text-strong">{replies}</span> {replies === 1 ? "reply" : "replies"}
              </span>
            </>
          ) : null}
        </span>
      </header>

      <div className="mx-4 mb-6 grid min-h-[560px] flex-1 grid-cols-1 overflow-hidden rounded-large border border-hairline bg-paper md:mx-6 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Thread list */}
        <section aria-label="Threads" className="flex min-h-0 flex-col border-b border-hairline md:border-r md:border-b-0">
          <div className="flex flex-col gap-2.5 border-b border-hairline p-3">
            <nav aria-label="Folders" className="flex flex-wrap gap-1">
              {FOLDERS.map((f) => {
                const n = count(f.id);
                const on = folder === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFolder(f.id)}
                    className={cn(
                      "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-[13px] font-semibold transition-colors",
                      on ? "bg-forest text-paper" : "text-charcoal hover:bg-raised",
                    )}
                  >
                    {f.label}
                    {n ? (
                      <span
                        className={cn(
                          "tabular text-[11px]",
                          f.id === "needs_reply" ? (on ? "text-lime" : "inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-forest px-1 text-lime") : on ? "text-paper/70" : "text-muted",
                        )}
                      >
                        {n}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <div className="inline-flex gap-1 self-start rounded-pill bg-raised p-1" role="group" aria-label="Channel">
              {(
                [
                  ["all", "Any", null],
                  ["email", "Email", <MailGlyph key="m" size={12} />],
                  ["x", "X", <XGlyph key="x" size={11} />],
                ] as const
              ).map(([id, label, glyph]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={channel === id}
                  onClick={() => setChannel(id)}
                  className={cn(
                    "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill px-3 text-[12px] font-semibold transition-colors",
                    channel === id ? "bg-paper text-forest shadow-[0_0_0_1px_var(--color-hairline)]" : "text-charcoal hover:bg-paper/70",
                  )}
                >
                  {glyph}
                  {label}
                  <span className="tabular text-[11px] text-muted">{chCount(id)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data && !error ? (
              <ListSkeleton />
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-raised text-forest">
                  <InboxIcon className="size-5" />
                </span>
                <p className="mt-3 text-[15px] font-semibold text-strong">{threads.length ? "Nothing in this folder" : "Nothing sent yet"}</p>
                <p className="mt-1 text-[13px] text-muted">{threads.length ? "Try another folder or channel." : "Approve a draft and it lands here."}</p>
                {!threads.length ? (
                  <Link href={`/runs/${runId}/review`} className="link-underline mt-3 text-[14px] font-semibold">
                    Open review
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="p-1.5">
                {list.map((t) => (
                  <li key={t.id}>
                    <ThreadRow t={t} active={cur?.id === t.id} now={now} onClick={() => setSel(t.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Reading pane */}
        <section aria-label="Thread" className="min-h-0 overflow-y-auto bg-recessed/40">
          {cur ? (
            <ThreadPane key={cur.id} runId={runId} t={cur} now={now} onLogged={reload} />
          ) : !data && !error ? (
            <PaneSkeleton />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-10 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-full bg-paper text-forest">
                <MailOpen className="size-5" />
              </span>
              <p className="mt-3 text-[14px] text-muted">Select a thread to read it.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function IntentTag({ reply, className, onDark }: { reply: InboxReply | null | undefined; className?: string; onDark?: boolean }) {
  if (onDark && reply?.cls) {
    const good = reply.cls.intent === "interested" || reply.cls.intent === "referral";
    return (
      <span className={cn("inline-flex h-5 items-center rounded-pill px-2 text-[11px] font-semibold", good ? "bg-lime text-forest" : "bg-white/15 text-paper", className)}>
        {INTENT_LABEL[reply.cls.intent]}
      </span>
    );
  }
  if (!reply) return null;
  if (!reply.cls)
    return (
      <span className={cn("inline-flex h-5 items-center gap-1 rounded-pill border border-hairline px-2 text-[11px] font-medium text-muted", className)}>
        <span className="size-1.5 animate-pulse rounded-full bg-pebble" />
        Classifying
      </span>
    );
  const i = reply.cls.intent;
  return <span className={cn("inline-flex h-5 items-center rounded-pill px-2 text-[11px] font-semibold", INTENT_TONE[i], className)}>{INTENT_LABEL[i]}</span>;
}

function AuthorBadge({ author }: { author: InboxThread["author"] }) {
  return author === "you" ? (
    <span className="inline-flex h-5 items-center rounded-pill bg-raised px-2 text-[11px] font-semibold text-charcoal" title="You edited this before it went out">
      Edited by you
    </span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-hairline px-2 text-[11px] font-medium text-muted" title="Written by Tide, approved by you">
      <DeptGlyph dept="tide" size={11} />
      Tide
    </span>
  );
}

function ThreadRow({ t, active, now, onClick }: { t: InboxThread; active: boolean; now: number; onClick: () => void }) {
  const last = t.replies.at(-1);
  const snippet = last ? last.text : t.body.split("\n")[0];
  const unread = !!last && inFolder(t, "needs_reply");
  const subject = t.subject ?? (t.channel === "x" ? CHANNEL_LABEL[t.draftChannel] : t.body.split("\n")[0]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-card px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-forest",
        active ? "bg-linen" : "hover:bg-recessed",
      )}
    >
      <span className="relative mt-0.5">
        <Avatar name={t.leadName} size={38} />
        <span className={cn("absolute -right-1.5 -bottom-1 inline-flex size-[18px] items-center justify-center rounded-full bg-paper text-strong ring-2", active ? "ring-linen" : "ring-paper")}>
          <ChannelGlyph channel={t.draftChannel} size={10} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("flex-1 truncate text-[14px]", unread ? "font-semibold text-strong" : "font-medium text-charcoal")} title={t.leadName}>
            {t.leadName}
            {unread ? <span className="sr-only"> (unread)</span> : null}
          </span>
          <time dateTime={t.lastAt} title={new Date(t.lastAt).toLocaleString()} className={cn("shrink-0 text-[12px] tabular", unread ? "font-semibold text-forest" : "text-muted")}>
            {relTimeShort(t.lastAt, now)}
          </time>
        </span>
        <span className={cn("mt-0.5 block truncate text-[13px]", unread ? "font-medium text-strong" : "text-charcoal")} title={subject}>
          {subject}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted" title={snippet}>
          {last ? <span className="text-charcoal">{t.leadName.split(" ")[0]}: </span> : <span>You: </span>}
          {snippet}
        </span>
        <span className="mt-2 flex items-center gap-1.5">
          <IntentTag reply={last} />
          {!last ? <span className="text-[11px] text-muted">{t.delivery ? "Awaiting reply" : t.channel === "x" ? "Not posted yet" : "Not sent yet"}</span> : null}
          {t.status !== "sent" ? <StatusPill status={t.status} /> : null}
          {unread ? <span className="ml-auto size-2 rounded-full bg-forest" aria-hidden /> : null}
        </span>
      </span>
    </button>
  );
}

function deliveryLine(t: InboxThread): string {
  if (!t.delivery) return t.channel === "x" ? "Approved. Not posted yet." : "Approved. Not sent yet.";
  if (t.delivery.manual) return t.channel === "x" ? "Posted manually on X" : `Posted manually on ${CHANNEL_LABEL[t.draftChannel]}`;
  if (t.delivery.safeMode && t.delivery.standIn) return `Delivered to stand-in ${t.delivery.standIn}`;
  return `Delivered to ${t.delivery.deliveredTo ?? t.emailAddress ?? "recipient"}`;
}

function ThreadPane({ runId, t, now, onLogged }: { runId: string; t: InboxThread; now: number; onLogged: () => void }) {
  const to = t.channel === "x" ? (t.handle ? `@${t.handle}` : "X") : (t.emailAddress ?? t.leadName);
  const ref = React.useRef<HTMLElement | null>(null);
  // Open on the latest exchange: scroll the pane so Wake's read of the last reply is in view.
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-latest]");
    const pane = ref.current?.parentElement;
    if (!el || !pane) return;
    const over = el.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom + 24;
    if (over > 0) pane.scrollTo({ top: pane.scrollTop + over, behavior: "smooth" });
  }, []);
  return (
    <article ref={ref} className="mx-auto flex max-w-[760px] flex-col gap-5 px-5 py-6 md:px-7 animate-in fade-in duration-200">
      <header className="flex flex-col gap-3">
        <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-strong" title={t.subject ?? undefined}>
          {t.subject ?? t.body.split("\n")[0].slice(0, 80)}
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-paper px-2.5 font-semibold text-forest ring-1 ring-hairline">
            <ChannelGlyph channel={t.draftChannel} size={11} />
            {CHANNEL_LABEL[t.draftChannel]}
          </span>
          <Link href={`/runs/${runId}/leads`} className="font-semibold text-forest underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-forest">
            {t.leadName}
          </Link>
          {t.handle ? (
            <a href={`https://x.com/${t.handle}`} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-forest">
              @{t.handle}
            </a>
          ) : null}
          {t.leadStage ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-forest" aria-hidden />
              <span className="capitalize">{t.leadStage.replace(/_/g, " ")}</span>
            </span>
          ) : null}
        </p>
      </header>

      {t.replyToUrl ? <ReplyToCard url={t.replyToUrl} /> : null}

      {/* Conversation timeline */}
      <ol className="relative flex flex-col gap-4">
        <span className="absolute top-6 bottom-6 left-[19px] w-px bg-hairline-strong/60" aria-hidden />
        <li className="relative flex gap-3">
          <Avatar name="You" size={40} tone="forest" className="z-[1] ring-4 ring-recessed">
            <DeptGlyph dept="tide" size={15} />
          </Avatar>
          <Bubble
            who={
              <>
                <span className="font-semibold text-strong">You</span>
                <span className="truncate text-muted">to {to}</span>
                <AuthorBadge author={t.author} />
              </>
            }
            at={t.sentAt}
            now={now}
            tone="ours"
          >
            <Collapsible text={t.body} collapsed={t.replies.length > 0} />
            <p className={cn("mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-[13px]", t.delivery ? "font-medium text-forest" : "text-muted")}>
              {t.delivery?.safeMode ? (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-linen text-forest" title="Send lock: our stand-in inbox, never the real person">
                  <Lock className="size-3" />
                </span>
              ) : t.delivery ? (
                <Check className="size-3.5" />
              ) : null}
              {deliveryLine(t)}
              {t.delivery?.threadId && !t.delivery.manual ? <span className="ml-auto hidden truncate font-mono xl:inline text-[11px] font-normal text-muted">{t.delivery.threadId}</span> : null}
            </p>
            {t.channel === "x" && !t.delivery ? <XActions t={t} /> : null}
          </Bubble>
        </li>

        {t.replies.map((r, k) => (
          <React.Fragment key={r.id}>
            <li className="relative flex gap-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <Avatar name={t.leadName} size={40} className="z-[1] ring-4 ring-recessed" />
              <Bubble
                who={
                  <>
                    <span className="font-semibold text-strong">{t.leadName}</span>
                    {r.from ? <span className="truncate font-mono text-[12px] text-muted">{r.from}</span> : null}
                  </>
                }
                at={r.at}
                now={now}
                tone="theirs"
              >
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-strong">{r.text}</p>
              </Bubble>
            </li>
            <li className="relative flex gap-3" data-latest={k === t.replies.length - 1 ? "" : undefined}>
              <span className="z-[1] inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-lime text-forest ring-4 ring-recessed" aria-hidden>
                <DeptGlyph dept="wake" size={16} />
              </span>
              <WakeInsight r={r} t={t} runId={runId} />
            </li>
          </React.Fragment>
        ))}

        {t.replies.length === 0 && t.delivery ? (
          <li className="relative flex items-center gap-3">
            <span className="z-[1] inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-muted ring-4 ring-recessed" aria-hidden>
              <DeptGlyph dept="wake" size={16} />
            </span>
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <span className="size-1.5 animate-pulse rounded-full bg-forest" />
              No reply yet. Wake is watching this thread.
            </p>
          </li>
        ) : null}
      </ol>

      {t.channel === "x" ? <LogReply runId={runId} t={t} onLogged={onLogged} /> : null}
    </article>
  );
}

/** Earlier messages fold to three lines once there's a reply, like a mail client. */
function Collapsible({ text, collapsed }: { text: string; collapsed: boolean }) {
  const [open, setOpen] = React.useState(!collapsed);
  const long = text.split("\n").length > 3 || text.length > 260;
  return (
    <div>
      <p className={cn("text-[15px] leading-relaxed whitespace-pre-wrap text-body", !open && long && "line-clamp-3")}>{text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 cursor-pointer text-[13px] font-semibold text-forest underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-forest">
          {open ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </div>
  );
}

function Bubble({ who, at, now, tone, children }: { who: React.ReactNode; at: string | null; now: number; tone: "ours" | "theirs"; children: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 flex-1 rounded-card border p-5", tone === "ours" ? "border-hairline bg-paper" : "border-forest/25 bg-paper")}>
      <div className="mb-2.5 flex min-w-0 items-center gap-3">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px]">{who}</p>
        {at ? (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="shrink-0 text-[12px] text-muted tabular">
            {relTimeShort(at, now)}
          </time>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Wake's read on a reply: intent, what changed (referral, calibration, stage), and what to do next. */
function WakeInsight({ r, t, runId }: { r: InboxReply; t: InboxThread; runId: string }) {
  const { store } = useRun();
  if (!r.cls)
    return (
      <div className="flex-1 rounded-card bg-forest p-5">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-paper">
          Wake
          <span className="size-1.5 animate-pulse rounded-full bg-lime" />
          <span className="font-normal text-paper/70">Classifying…</span>
        </p>
        <div className="mt-3 h-3 w-3/4 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  const cls = r.cls;
  const lead = store.leads[t.leadId];
  const cal = lead && store.calibration?.perSegment[lead.segmentId];
  const delta = cal ? cal.observedRate - cal.predicted : null;
  const segName = lead ? store.segments[lead.segmentId]?.name : undefined;

  const rows: { icon: React.ReactNode; text: React.ReactNode; href?: string }[] = [];
  if (cls.intent === "referral" && (t.referral || cls.referredPerson)) {
    const name = t.referral?.leadName ?? cls.referredPerson?.name ?? "someone";
    rows.push({
      icon: <UserPlus className="size-3.5" />,
      text: (
        <>
          Referral to <span className="font-semibold text-paper">{name.replace(/\s*\(.*\)$/, "")}</span>
          {t.referral?.draftId ? <> → intro draft {t.referral.draftStatus === "pending_review" ? "ready to review" : t.referral.draftStatus ? t.referral.draftStatus.replace(/_/g, " ") : "created"}</> : <> → Tide is drafting</>}
        </>
      ),
      href: t.referral?.draftId ? `/runs/${runId}/review` : undefined,
    });
  }
  if (delta != null && cal) {
    rows.push({
      icon: delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />,
      text: (
        <>
          Calibration{" "}
          <span className="tabular font-semibold text-lime">
            {delta >= 0 ? "+" : "−"}
            {Math.abs(delta).toFixed(2)}
          </span>
          {segName ? <> for {segName}</> : null}
          <span className="text-paper/60 tabular">
            {" "}
            · {cal.predicted.toFixed(2)} → {cal.observedRate.toFixed(2)}
          </span>
        </>
      ),
    });
  }
  if (t.leadStage) rows.push({ icon: <GitBranch className="size-3.5" />, text: <>Stage moved to <span className="font-semibold text-paper capitalize">{t.leadStage.replace(/_/g, " ")}</span></> });

  const primary =
    cls.nextAction === "draft_referral_outreach" && t.referral?.draftId
      ? { label: "Review intro", href: `/runs/${runId}/review` }
      : cls.nextAction === "draft_reply"
        ? { label: "Draft a reply", href: `/runs/${runId}/review` }
        : null;

  return (
    <div className="min-w-0 flex-1 rounded-card bg-forest p-5 text-paper animate-in fade-in duration-300">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold text-paper">Wake</span>
        <IntentTag reply={r} onDark />
        <span className="text-paper/60 capitalize">{cls.sentiment}</span>
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-paper">{cls.summary}</p>
      {rows.length ? (
        <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {rows.map((row, i) => {
            const inner = (
              <>
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-lime">{row.icon}</span>
                <span className="min-w-0 flex-1 text-[13px] text-paper/80">{row.text}</span>
                {row.href ? <ArrowRight className="size-3.5 shrink-0 text-paper/60 transition-transform group-hover:translate-x-0.5 group-hover:text-lime" /> : null}
              </>
            );
            return (
              <li key={i}>
                {row.href ? (
                  <Link href={row.href} className="group flex items-center gap-3 py-2.5 transition-colors">
                    {inner}
                  </Link>
                ) : (
                  <span className="flex items-center gap-3 py-2.5">{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-paper/60">Next</span>
        {primary ? (
          <Button asChild variant="cta" size="sm">
            <Link href={primary.href}>
              {primary.label}
              <ArrowRight />
            </Link>
          </Button>
        ) : (
          <span className="inline-flex h-8 items-center rounded-pill border border-white/40 px-3.5 text-[13px] font-semibold text-paper">{NEXT_LABEL[cls.nextAction]}</span>
        )}
        <Link href={`/runs/${runId}/leads`} className="text-[13px] font-semibold text-paper underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-lime">
          Open lead
        </Link>
      </div>
    </div>
  );
}

function XActions({ t }: { t: InboxThread }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="mt-3 flex gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={xIntentUrl({ body: t.body, channel: t.draftChannel, xIntentUrl: t.xIntentUrl ?? undefined, replyToUrl: t.replyToUrl ?? undefined })} target="_blank" rel="noopener noreferrer">
          <XGlyph size={12} />
          Open in X
        </a>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(t.body);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? <Check className="text-forest" /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function LogReply({ runId, t, onLogged }: { runId: string; t: InboxThread; onLogged: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/wake/x-reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, draftId: t.draftId, text: text.trim() }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMsg({ ok: false, text: j.error ?? `Failed (${res.status})` });
      else {
        setText("");
        setMsg({ ok: true, text: "Logged. Wake classified it." });
        onLogged();
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="rounded-card border border-hairline bg-paper p-5">
      <label htmlFor={`log-${t.id}`} className="flex items-center gap-2 text-[15px] font-semibold text-strong">
        <XGlyph size={12} />
        Reply on X
      </label>
      <p className="mt-0.5 text-[13px] text-muted">Paste what they said. Wake classifies it like an email.</p>
      <textarea
        id={`log-${t.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="not me, ask @priya, she runs our search infra"
        className="mt-3 w-full resize-y rounded-card border border-hairline-strong bg-paper px-4 py-3 text-[15px] text-strong outline-none placeholder:text-pebble focus:border-forest"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="cta" disabled={busy || !text.trim()}>
          {busy ? "Logging…" : "Log reply"}
        </Button>
        {msg ? (
          <span className={cn("text-[13px]", msg.ok ? "font-medium text-forest" : "text-danger")} role="status">
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function ListSkeleton() {
  return (
    <ul className="p-1.5" aria-busy>
      {[0, 1, 2, 3].map((k) => (
        <li key={k} className="flex gap-3 px-3 py-3">
          <span className="size-[38px] shrink-0 animate-pulse rounded-full bg-raised" />
          <span className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-1/2 animate-pulse rounded-full bg-raised" />
            <span className="block h-2.5 w-4/5 animate-pulse rounded-full bg-recessed" />
            <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-recessed" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function PaneSkeleton() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-8 py-6" aria-busy>
      <span className="h-6 w-2/3 animate-pulse rounded-full bg-raised" />
      <span className="h-3 w-1/3 animate-pulse rounded-full bg-raised" />
      {[0, 1].map((k) => (
        <div key={k} className="flex gap-3">
          <span className="size-10 shrink-0 animate-pulse rounded-full bg-raised" />
          <span className="h-32 flex-1 animate-pulse rounded-card bg-paper" />
        </div>
      ))}
    </div>
  );
}
