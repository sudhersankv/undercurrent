"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy, CornerDownRight, Lock } from "lucide-react";
import { useRun } from "@/components/mission/run-context";
import { Button, DeptGlyph, Pill } from "@/components/ui";
import { ChannelGlyph, CHANNEL_LABEL, MailGlyph, ReplyToCard, XGlyph, xIntentUrl } from "@/components/review/x";
import { StatusPill } from "@/components/review/draft-card";
import { cn } from "@/lib/utils";
import { FOLDERS, INTENT_LABEL, inFolder, NEXT_LABEL, relTime, type InboxChannel, type InboxData, type InboxFolder, type InboxReply, type InboxThread } from "./model";

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-4 py-4 md:px-6">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-strong">Inbox</h1>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <MailGlyph size={13} />
          <span className="truncate font-mono text-charcoal">{data?.sender.inboxId ?? "fixture inbox"}</span>
        </span>
        {data?.sender.safeMode ? (
          <Pill tone="lichen" className="font-semibold" title="Email only goes to our own AgentMail inboxes. Real developers are never contacted.">
            <Lock className="size-3" />
            Send lock{data.sender.standIn ? ` · stand-in ${data.sender.standIn}` : ""}
          </Pill>
        ) : null}
        {error ? (
          <span className="ml-auto text-[13px] font-medium text-danger" role="status">
            {error}
          </span>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        {/* Thread list: filters on top, hairline rows below */}
        <section aria-label="Threads" className="flex min-h-0 flex-col border-b border-hairline md:border-r md:border-b-0">
          <div className="flex flex-col gap-2 border-b border-hairline p-3">
            <nav aria-label="Folders" className="flex gap-1 overflow-x-auto">
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
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors",
                      on ? "bg-forest text-paper" : "text-charcoal hover:bg-raised",
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        "tabular text-[11px]",
                        f.id === "needs_reply" && n > 0 ? (on ? "text-lime" : "inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-forest px-1 text-lime") : on ? "text-paper/70" : "text-muted",
                      )}
                    >
                      {n}
                    </span>
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
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors",
                    channel === id ? "bg-paper text-forest ring-1 ring-hairline" : "text-charcoal hover:bg-paper",
                  )}
                >
                  {glyph ? <span className="flex justify-center">{glyph}</span> : null}
                  {label}
                  <span className="tabular text-[11px] text-muted">{chCount(id)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data && !error ? (
              <p className="p-4 text-[14px] text-muted">Loading…</p>
            ) : list.length === 0 ? (
              <div className="p-6">
                <p className="text-[15px] font-semibold text-strong">{threads.length ? "Nothing in this folder." : "Nothing sent yet."}</p>
                {!threads.length ? (
                  <Link href={`/runs/${runId}/review`} className="link-underline mt-1.5 inline-block text-[14px]">
                    Open review
                  </Link>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-hairline">
                {list.map((t) => (
                  <li key={t.id}>
                    <ThreadRow t={t} active={cur?.id === t.id} now={now} onClick={() => setSel(t.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Thread */}
        <section aria-label="Thread" className="min-h-0 overflow-y-auto">
          {cur ? <ThreadPane key={cur.id} runId={runId} t={cur} now={now} onLogged={reload} /> : <p className="p-6 text-[14px] text-muted">Select a thread.</p>}
        </section>
      </div>
    </div>
  );
}

function IntentChip({ reply }: { reply: InboxReply | null | undefined }) {
  if (!reply) return null;
  if (!reply.cls) return <Pill tone="muted">Classifying</Pill>;
  const i = reply.cls.intent;
  const tone = i === "interested" || i === "referral" ? "lichen" : i === "question" ? "neutral" : i === "not_relevant" || i === "unsubscribe" ? "warning" : "muted";
  return <Pill tone={tone}>{INTENT_LABEL[i]}</Pill>;
}

function AuthorBadge({ author }: { author: InboxThread["author"] }) {
  return author === "you" ? (
    <span className="inline-flex h-5 items-center rounded-pill bg-forest px-2 text-[11px] font-semibold text-paper">You</span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-hairline px-2 text-[11px] font-medium text-muted">
      <DeptGlyph dept="tide" size={11} />
      AI
    </span>
  );
}

function ThreadRow({ t, active, now, onClick }: { t: InboxThread; active: boolean; now: number; onClick: () => void }) {
  const last = t.replies.at(-1);
  const line = last ? last.text : (t.subject ?? t.body.split("\n")[0]);
  const unread = !!last && inFolder(t, "needs_reply");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors", active ? "bg-linen" : "hover:bg-linen/50")}
    >
      <span className="flex items-center gap-2">
        <span className="flex w-2 justify-center" aria-hidden>
          {unread ? <span className="size-2 rounded-full bg-forest" /> : null}
        </span>
        <ChannelGlyph channel={t.draftChannel} size={12} className="text-muted" />
        <span className={cn("flex-1 truncate text-[14px]", unread ? "font-semibold text-strong" : "font-medium text-charcoal")}>
          {t.leadName}
          {unread ? <span className="sr-only"> (unread)</span> : null}
        </span>
        <span className="font-mono text-[11px] text-muted tabular">{relTime(t.lastAt, now)}</span>
      </span>
      <span className={cn("truncate pl-4 text-[13px]", unread ? "text-charcoal" : "text-muted")}>{line}</span>
      <span className="flex items-center gap-1.5 pl-4">
        <IntentChip reply={last} />
        {t.status !== "sent" ? <StatusPill status={t.status} /> : null}
        <span className="ml-auto">
          <AuthorBadge author={t.author} />
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
  const to = t.channel === "x" ? (t.handle ? `@${t.handle}` : "X") : (t.emailAddress ?? "no address on file");
  return (
    <article className="mx-auto flex max-w-[760px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-bold tracking-[-0.02em] text-strong">{t.subject ?? t.body.split("\n")[0].slice(0, 80)}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <Pill tone="neutral" className="gap-1.5 font-semibold text-forest">
              <ChannelGlyph channel={t.draftChannel} size={11} />
              {CHANNEL_LABEL[t.draftChannel]}
            </Pill>
            <Link href={`/runs/${runId}/leads`} className="font-semibold text-forest underline decoration-hairline-strong underline-offset-4 hover:decoration-forest">
              {t.leadName}
            </Link>
            {t.handle ? (
              <a href={`https://x.com/${t.handle}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] hover:text-forest">
                @{t.handle}
              </a>
            ) : null}
            {t.leadStage ? <span className="font-mono text-[12px]">{t.leadStage}</span> : null}
          </p>
        </div>
      </header>

      {t.replyToUrl ? <ReplyToCard url={t.replyToUrl} /> : null}

      {/* Ours */}
      <Message
        avatar={
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-forest text-lime">
            <DeptGlyph dept="tide" size={14} />
          </span>
        }
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
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-body">{t.body}</p>
        <p className={cn("mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-[13px]", t.delivery ? "font-medium text-forest" : "text-muted")}>
          {t.delivery?.safeMode ? (
            <Pill tone="lichen" className="font-semibold">
              <Lock className="size-3" />
              Stand-in
            </Pill>
          ) : t.delivery ? (
            <Check className="size-3.5" />
          ) : null}
          {deliveryLine(t)}
          {t.delivery?.threadId && !t.delivery.manual ? <span className="ml-auto truncate font-mono text-[11px] font-normal text-muted">{t.delivery.threadId}</span> : null}
        </p>
        {t.channel === "x" && !t.delivery ? <XActions t={t} /> : null}
      </Message>

      {/* Theirs */}
      {t.replies.map((r) => (
        <React.Fragment key={r.id}>
          <Message
            avatar={
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-[14px] font-semibold text-forest" aria-hidden>
                {t.leadName.slice(0, 1).toUpperCase()}
              </span>
            }
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
          </Message>
          <WakeNote r={r} t={t} runId={runId} />
        </React.Fragment>
      ))}

      {t.replies.length === 0 && t.channel === "email" ? <p className="text-[13px] text-muted">No reply yet. Wake is watching this thread.</p> : null}

      {t.channel === "x" ? <LogReply runId={runId} t={t} onLogged={onLogged} /> : null}
    </article>
  );
}

function Message({
  avatar,
  who,
  at,
  now,
  tone,
  children,
}: {
  avatar: React.ReactNode;
  who: React.ReactNode;
  at: string | null;
  now: number;
  tone: "ours" | "theirs";
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-card border p-5", tone === "ours" ? "border-transparent bg-recessed" : "border-hairline bg-paper")}>
      <div className="mb-3 flex min-w-0 items-center gap-3">
        {avatar}
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px]">{who}</p>
        {at ? (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="shrink-0 font-mono text-[12px] text-muted tabular">
            {relTime(at, now)}
          </time>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function WakeNote({ r, t, runId }: { r: InboxReply; t: InboxThread; runId: string }) {
  if (!r.cls) return <p className="pl-5 text-[13px] text-muted">Wake is classifying…</p>;
  return (
    <div className="ml-5 flex flex-col gap-2 border-l-2 border-linen pl-5">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <DeptGlyph dept="wake" size={14} className="text-forest" />
        <span className="font-semibold text-strong">Wake</span>
        <IntentChip reply={r} />
        <span className="font-mono text-[11px] text-muted">{r.cls.sentiment}</span>
      </p>
      <p className="text-[14px] leading-relaxed text-body">{r.cls.summary}</p>
      <p className="flex items-center gap-1.5 text-[13px] text-muted">
        <CornerDownRight className="size-3.5" />
        Next: <span className="font-semibold text-strong">{NEXT_LABEL[r.cls.nextAction]}</span>
      </p>
      {r.cls.intent === "referral" && t.referral ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-paper px-4 py-3 text-[13px]">
          <span className="text-muted">New lead</span>
          <Link href={`/runs/${runId}/leads`} className="font-semibold text-forest underline decoration-hairline-strong underline-offset-4 hover:decoration-forest">
            {t.referral.leadName}
          </Link>
          {t.referral.draftId ? (
            <Link href={`/runs/${runId}/review`} className="ml-auto inline-flex items-center gap-1.5 font-medium text-forest hover:underline">
              Intro draft
              {t.referral.draftStatus ? <StatusPill status={t.referral.draftStatus} /> : null}
            </Link>
          ) : (
            <span className="ml-auto text-muted">Tide is drafting</span>
          )}
        </div>
      ) : null}
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
