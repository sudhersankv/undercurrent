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
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5">
        <h1 className="text-[15px] font-medium tracking-[-0.01em] text-strong">Inbox</h1>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <MailGlyph size={12} />
          <span className="truncate font-mono text-body">{data?.sender.inboxId ?? "fixture inbox"}</span>
        </span>
        {data?.sender.safeMode ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="Email only goes to our own AgentMail inboxes. Real developers are never contacted.">
            <Lock className="size-3" />
            Send lock{data.sender.standIn ? ` · stand-in ${data.sender.standIn}` : ""}
          </span>
        ) : null}
        {error ? (
          <span className="ml-auto text-[12px] text-danger" role="status">
            {error}
          </span>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[188px_minmax(280px,340px)_minmax(0,1fr)]">
        {/* Folders */}
        <nav aria-label="Folders" className="flex gap-1 overflow-x-auto border-b border-hairline p-2 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={folder === f.id}
              onClick={() => setFolder(f.id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-control px-2.5 text-left text-[13px] transition-colors",
                folder === f.id ? "bg-raised text-strong" : "text-body hover:bg-raised hover:text-strong",
              )}
            >
              <span className="flex-1">{f.label}</span>
              <span className={cn("font-mono text-[11px] tabular-nums", f.id === "needs_reply" && count(f.id) > 0 ? "text-lichen" : "text-muted")}>{count(f.id)}</span>
            </button>
          ))}
          <p className="eyebrow mt-4 mb-1 hidden px-2.5 text-[10px] md:block">Channel</p>
          <div className="flex shrink-0 gap-1 md:flex-col" role="group" aria-label="Channel">
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
                  "flex h-8 shrink-0 items-center gap-2 rounded-control px-2.5 text-[13px] transition-colors",
                  channel === id ? "bg-raised text-strong" : "text-body hover:bg-raised hover:text-strong",
                )}
              >
                <span className="flex w-3.5 justify-center text-muted">{glyph}</span>
                <span className="flex-1 text-left">{label}</span>
                <span className="font-mono text-[11px] text-muted tabular-nums">{chCount(id)}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Thread list */}
        <section aria-label="Threads" className="min-h-0 overflow-y-auto border-b border-hairline md:border-r md:border-b-0">
          {!data && !error ? (
            <p className="p-4 text-[13px] text-muted">Loading…</p>
          ) : list.length === 0 ? (
            <div className="p-6">
              <p className="text-[13px] text-strong">{threads.length ? "Nothing in this folder." : "Nothing sent yet."}</p>
              {!threads.length ? (
                <Link href={`/runs/${runId}/review`} className="mt-1 inline-block text-[12px] text-muted underline decoration-hairline-strong underline-offset-2 hover:text-lichen">
                  Open review
                </Link>
              ) : null}
            </div>
          ) : (
            <ul>
              {list.map((t) => (
                <li key={t.id}>
                  <ThreadRow t={t} active={cur?.id === t.id} now={now} onClick={() => setSel(t.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Thread */}
        <section aria-label="Thread" className="min-h-0 overflow-y-auto">
          {cur ? <ThreadPane key={cur.id} runId={runId} t={cur} now={now} onLogged={reload} /> : <p className="p-6 text-[13px] text-muted">Select a thread.</p>}
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
    <span className="inline-flex h-[18px] items-center rounded-[4px] bg-strong px-1.5 text-[10.5px] font-medium text-recessed">You</span>
  ) : (
    <span className="inline-flex h-[18px] items-center gap-1 rounded-[4px] border border-hairline-strong px-1.5 text-[10.5px] text-body">
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
      className={cn("flex w-full flex-col gap-1 border-b border-hairline px-3.5 py-2.5 text-left transition-colors", active ? "bg-raised" : "hover:bg-raised/60")}
    >
      <span className="flex items-center gap-2">
        <ChannelGlyph channel={t.draftChannel} size={12} className="text-muted" />
        <span className={cn("flex-1 truncate text-[13px]", unread ? "font-medium text-strong" : "text-body")}>{t.leadName}</span>
        <span className="font-mono text-[11px] text-muted tabular-nums">{relTime(t.lastAt, now)}</span>
      </span>
      <span className="truncate text-[12px] text-muted">{line}</span>
      <span className="flex items-center gap-1.5">
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
    <article className="mx-auto flex max-w-[760px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-medium tracking-[-0.02em] text-strong">{t.subject ?? t.body.split("\n")[0].slice(0, 80)}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <ChannelGlyph channel={t.draftChannel} size={12} />
            <span>{CHANNEL_LABEL[t.draftChannel]}</span>
            <span aria-hidden>·</span>
            <Link href={`/runs/${runId}/leads`} className="text-body hover:text-lichen">
              {t.leadName}
            </Link>
            {t.handle ? (
              <a href={`https://x.com/${t.handle}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-lichen">
                @{t.handle}
              </a>
            ) : null}
            {t.leadStage ? <span className="font-mono">{t.leadStage}</span> : null}
          </p>
        </div>
      </header>

      {t.replyToUrl ? <ReplyToCard url={t.replyToUrl} /> : null}

      {/* Ours */}
      <Message
        who={
          <>
            <span className="text-strong">You</span>
            <span className="text-muted">to {to}</span>
            <span className="ml-1">
              <AuthorBadge author={t.author} />
            </span>
          </>
        }
        at={t.sentAt}
        now={now}
        tone="ours"
      >
        <p className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-strong">{t.body}</p>
        <p className={cn("mt-3 flex items-center gap-1.5 text-[11.5px]", t.delivery ? "text-lichen" : "text-muted")}>
          {t.delivery?.safeMode ? <Lock className="size-3" /> : t.delivery ? <Check className="size-3" /> : null}
          {deliveryLine(t)}
          {t.delivery?.threadId && !t.delivery.manual ? <span className="ml-auto truncate font-mono text-muted">{t.delivery.threadId}</span> : null}
        </p>
        {t.channel === "x" && !t.delivery ? <XActions t={t} /> : null}
      </Message>

      {/* Theirs */}
      {t.replies.map((r) => (
        <React.Fragment key={r.id}>
          <Message
            who={
              <>
                <span className="text-strong">{t.leadName}</span>
                {r.from ? <span className="truncate font-mono text-muted">{r.from}</span> : null}
              </>
            }
            at={r.at}
            now={now}
            tone="theirs"
          >
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-strong">{r.text}</p>
          </Message>
          <WakeNote r={r} t={t} runId={runId} />
        </React.Fragment>
      ))}

      {t.replies.length === 0 && t.channel === "email" ? <p className="text-[12px] text-muted">No reply yet. Wake is watching this thread.</p> : null}

      {t.channel === "x" ? <LogReply runId={runId} t={t} onLogged={onLogged} /> : null}
    </article>
  );
}

function Message({ who, at, now, tone, children }: { who: React.ReactNode; at: string | null; now: number; tone: "ours" | "theirs"; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-card border p-4", tone === "ours" ? "border-hairline bg-recessed" : "border-hairline-strong bg-raised")}>
      <p className="mb-2.5 flex min-w-0 items-center gap-2 text-[12px]">
        {who}
        {at ? (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="ml-auto shrink-0 font-mono text-[11px] text-muted tabular-nums">
            {relTime(at, now)}
          </time>
        ) : null}
      </p>
      {children}
    </section>
  );
}

function WakeNote({ r, t, runId }: { r: InboxReply; t: InboxThread; runId: string }) {
  if (!r.cls) return <p className="pl-4 text-[12px] text-muted">Wake is classifying…</p>;
  return (
    <div className="ml-4 flex flex-col gap-2 border-l border-hairline-strong pl-4">
      <p className="flex flex-wrap items-center gap-2 text-[12px]">
        <DeptGlyph dept="wake" size={13} className="text-body" />
        <span className="text-strong">Wake</span>
        <IntentChip reply={r} />
        <span className="font-mono text-[11px] text-muted">{r.cls.sentiment}</span>
      </p>
      <p className="text-[13px] text-body">{r.cls.summary}</p>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <CornerDownRight className="size-3.5" />
        Next: <span className="text-strong">{NEXT_LABEL[r.cls.nextAction]}</span>
      </p>
      {r.cls.intent === "referral" && t.referral ? (
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-hairline bg-recessed px-3 py-2 text-[12px]">
          <span className="text-muted">New lead</span>
          <Link href={`/runs/${runId}/leads`} className="text-strong hover:text-lichen">
            {t.referral.leadName}
          </Link>
          {t.referral.draftId ? (
            <Link href={`/runs/${runId}/review`} className="ml-auto inline-flex items-center gap-1.5 text-body hover:text-lichen">
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
        {copied ? <Check className="text-lichen" /> : <Copy />}
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
    <form onSubmit={submit} className="rounded-card border border-dashed border-hairline-strong p-4">
      <label htmlFor={`log-${t.id}`} className="flex items-center gap-1.5 text-[12px] text-strong">
        <XGlyph size={11} />
        Reply on X
      </label>
      <p className="mt-0.5 text-[11.5px] text-muted">Paste what they said. Wake classifies it like an email.</p>
      <textarea
        id={`log-${t.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="not me, ask @priya, she runs our search infra"
        className="mt-2.5 w-full resize-y rounded-control border border-hairline-strong bg-recessed px-3 py-2 text-[13px] text-strong outline-none placeholder:text-muted focus:border-lichen/60"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Logging…" : "Log reply"}
        </Button>
        {msg ? (
          <span className={cn("text-[12px]", msg.ok ? "text-lichen" : "text-danger")} role="status">
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
