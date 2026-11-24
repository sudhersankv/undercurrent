"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, Gift, Lightbulb, Link2, Megaphone, Search, Sparkles } from "lucide-react";
import type { Campaign, Draft } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { Button, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/review/draft-card";
import { Avatar, CharRing, Favicon, hostOf } from "@/components/review/parts";
import { CHANNEL_LABEL, compact, X_LIMIT, XGlyph, xFollowers, xHandle, xIntentUrl, xProfileUrl, type XDraft } from "@/components/review/x";

type Amplifier = Campaign["amplifiers"][number] & {
  handle?: string;
  xHandle?: string;
  followers?: number;
  xProfile?: { handle?: string; url?: string; followers?: number };
};

function isXUrl(u: string) {
  return /^https?:\/\/(www\.)?(x|twitter)\.com\//.test(u);
}

function xAuthor(u: string) {
  return /x\.com\/([^/]+)/.exec(u.replace("twitter.com", "x.com"))?.[1] ?? null;
}

function CopyButton({ text, label = "Copy", iconOnly }: { text: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      size={iconOnly ? "icon" : "sm"}
      variant="ghost"
      aria-label={label}
      title={label}
      className={iconOnly ? "size-8" : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check className="text-forest" /> : <Copy />}
      {iconOnly ? null : done ? "Copied" : label}
    </Button>
  );
}

function Block({ title, count, icon, children, className, aside }: { title: string; count?: number; icon?: React.ReactNode; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn("rounded-large border border-hairline bg-paper p-6", className)}>
      <div className="mb-4 flex items-center gap-2.5">
        {icon ? <span className="inline-flex size-8 items-center justify-center rounded-full bg-raised text-forest [&_svg]:size-4">{icon}</span> : null}
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
        {count != null ? <span className="tabular text-[13px] text-muted">{count}</span> : null}
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Forest summary card: lime headline number, one-line summary, supporting stats. */
function CampaignSummary({ campaign, xCount, segName, posts }: { campaign: Campaign; xCount: number; segName: string; posts: number }) {
  const recipients = campaign.creditGiftPlan.recipients.length;
  const credits = campaign.creditGiftPlan.amountUsdEach * recipients;
  const hooks = campaign.hooks.length;
  const amps = campaign.amplifiers.length;
  return (
    <section aria-label="Campaign summary" className="grid gap-8 rounded-large bg-forest p-8 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:p-10">
      <div className="flex flex-col">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-paper/70">
          <XGlyph size={12} className="text-lime" />
          Ready for X
        </p>
        <p className="mt-4 flex items-baseline gap-4">
          <span className="tabular text-[88px] leading-[0.85] font-bold tracking-[-0.04em] text-lime">{xCount}</span>
          <span className="text-[18px] leading-snug font-semibold text-paper">
            {xCount === 1 ? "draft" : "drafts"} to post
            <br />
            <span className="font-normal text-paper/70">by you, by hand</span>
          </span>
        </p>
        <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-paper/80">
          {posts ? `${posts} ${posts === 1 ? "post" : "posts"} and ` : ""}
          {xCount - posts} {xCount - posts === 1 ? "reply" : "replies"} for {segName}, built on {hooks} {hooks === 1 ? "hook" : "hooks"} and {amps} {amps === 1 ? "amplifier" : "amplifiers"}. Nothing posts automatically.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px self-end overflow-hidden rounded-card bg-white/15">
        <Stat value={hooks} label={hooks === 1 ? "Hook" : "Hooks"} />
        <Stat value={amps} label={amps === 1 ? "Amplifier" : "Amplifiers"} />
        <Stat value={campaign.listenQueries.length} label="Listen queries" />
        <Stat
          value={`$${compact(credits)}`}
          label={
            <span className="inline-flex items-center gap-1.5">
              Credits
              <span className="rounded-pill border border-white/40 px-1.5 text-[11px] leading-4 font-semibold text-paper">Simulated</span>
            </span>
          }
        />
      </dl>
    </section>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-forest p-4">
      <dd className="tabular text-[28px] leading-none font-bold tracking-[-0.02em] text-paper">{value}</dd>
      <dt className="mt-2 text-[13px] text-paper/70">{label}</dt>
    </div>
  );
}

/** Listen → join → post → amplify → gift: the order the campaign runs in, with what's ready at each step. */
function Playbook({ steps }: { steps: { icon: React.ReactNode; label: string; detail: string; n: number; simulated?: boolean }[] }) {
  return (
    <ol className="grid gap-px overflow-hidden rounded-large border border-hairline bg-hairline sm:grid-cols-5" aria-label="Playbook">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col gap-3 bg-paper p-5">
          <span className="flex items-center gap-2">
            <span className={cn("inline-flex size-8 items-center justify-center rounded-full [&_svg]:size-4", s.n ? "bg-linen text-forest" : "bg-raised text-muted")}>{s.icon}</span>
            <span className="text-[12px] font-semibold text-muted tabular">Step {i + 1}</span>
          </span>
          <span>
            <span className="block text-[15px] font-semibold text-strong">{s.label}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
              {s.detail}
              {s.simulated ? <Pill tone="muted" className="px-1.5 py-0 text-[11px] leading-4">Simulated</Pill> : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function TweetCard({ d, lead, me }: { d: Draft; lead: RunStore["leads"][string] | undefined; me: string }) {
  const xd = d as XDraft;
  const replyTo = xd.replyToUrl ? xAuthor(xd.replyToUrl) : null;
  const target = d.channel === "x_dm" ? xHandle(lead) : null;
  return (
    <li className="flex flex-col rounded-card border border-hairline bg-paper transition-colors hover:border-hairline-strong">
      <div className="flex gap-3 p-4">
        <Avatar name={me} size={40} tone="forest" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[14px]">
            <span className="truncate font-semibold text-strong">{me}</span>
            <span className="truncate text-muted">posting as you</span>
            <span className="ml-auto shrink-0">
              <StatusPill status={d.status} />
            </span>
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {replyTo ? (
              <>
                Replying to <span className="font-medium text-forest">@{replyTo}</span>
              </>
            ) : target ? (
              <>
                Message to <span className="font-medium text-forest">@{target}</span>
              </>
            ) : (
              CHANNEL_LABEL[d.channel]
            )}
          </p>
          <p className="mt-2 text-[15px] leading-[1.55] whitespace-pre-wrap text-strong">{d.body}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-1.5 border-t border-hairline px-4 py-2.5">
        <Button asChild size="sm" variant="outline">
          <a href={xIntentUrl(xd)} target="_blank" rel="noopener noreferrer">
            <XGlyph size={11} />
            Open in X
          </a>
        </Button>
        <CopyButton text={d.body} />
        <span className="ml-auto flex items-center gap-2 text-[12px] text-muted tabular">
          {d.body.length}/{X_LIMIT}
          <CharRing count={d.body.length} limit={X_LIMIT} size={20} />
        </span>
      </div>
    </li>
  );
}

/** Campaign brief for one segment (SPEC §10.7). */
export function CampaignBrief({ campaign, store }: { campaign: Campaign; store: RunStore }) {
  const seg = store.segments[campaign.segmentId];
  const site = store.profile?.url ?? "https://www.moss.dev";
  const utm = (content: string) => `${site.replace(/\/$/, "")}/?${campaign.utmBase}&utm_content=${encodeURIComponent(content)}`;
  const posts = campaign.posts.map((p) => store.drafts[p.draftId]).filter(Boolean);
  // Replies and DMs Tide drafted for this segment's people join the posts: the campaign is the conversation.
  const segLeads = new Set(Object.values(store.leads).filter((l) => l.segmentId === campaign.segmentId).map((l) => l.id));
  const replies = Object.values(store.drafts).filter((d) => (d.channel === "x_reply" || d.channel === "x_dm") && segLeads.has(d.leadId) && d.status !== "rejected");
  const xDrafts = [...posts, ...replies.filter((r) => !posts.some((p) => p.id === r.id))];
  const personName = (id: string) => Object.values(store.leads).find((l) => l.personId === id)?.displayName ?? id.split("-person-").pop() ?? id;
  const me = store.profile?.name ?? "You";
  const amps = campaign.amplifiers as Amplifier[];
  const credits = campaign.creditGiftPlan;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-strong">{seg?.name ?? "Campaign"}</h2>
        {seg ? <VerdictChip verdict={seg.verdict} /> : null}
      </header>

      <CampaignSummary campaign={campaign} xCount={xDrafts.length} posts={posts.length} segName={seg?.name ?? "this segment"} />

      <Playbook
        steps={[
          { icon: <Search />, label: "Listen", detail: `${campaign.listenQueries.length} live searches`, n: campaign.listenQueries.length },
          { icon: <XGlyph size={14} />, label: "Join in", detail: `${replies.length} ${replies.length === 1 ? "reply" : "replies"} drafted`, n: replies.length },
          { icon: <Megaphone />, label: "Post", detail: posts.length ? `${posts.length} ${posts.length === 1 ? "post" : "posts"} drafted` : "No posts yet", n: posts.length },
          { icon: <Sparkles />, label: "Amplify", detail: `${amps.length} ${amps.length === 1 ? "person" : "people"}`, n: amps.length },
          { icon: <Gift />, label: "Gift credits", detail: `$${credits.amountUsdEach} each`, n: credits.recipients.length, simulated: true },
        ]}
      />

      <Block title="On X" count={xDrafts.length} icon={<XGlyph size={14} />} aside={<span className="text-[12px] text-muted">You post each one. We never post for you.</span>}>
        {xDrafts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-card bg-recessed p-4">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-paper text-forest">
              <Megaphone className="size-4" />
            </span>
            <p className="text-[14px] text-muted">No X drafts for this segment yet. Tide drafts replies once leads are approved.</p>
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {xDrafts.map((d) => (
              <TweetCard key={d.id} d={d} lead={store.leads[d.leadId]} me={me} />
            ))}
          </ul>
        )}
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Hooks" count={campaign.hooks.length} icon={<Lightbulb />}>
          <ol className="flex flex-col gap-3">
            {campaign.hooks.map((h, i) => (
              <li key={i} className="rounded-card bg-recessed p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-paper text-[12px] font-bold text-forest tabular">{i + 1}</span>
                  <p className="flex-1 text-[15px] leading-snug font-semibold text-strong">{h.angle}</p>
                  {h.vendorReportedNumbers ? <Pill tone="warning">Vendor-reported</Pill> : null}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-9">
                  {h.evidenceUrls.map((u) => (
                    <a
                      key={u}
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={u}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-paper py-0.5 pr-2.5 pl-1 text-[12px] font-medium text-charcoal ring-1 ring-hairline transition-colors hover:text-forest hover:ring-hairline-strong"
                    >
                      <Favicon url={u} size={14} className="rounded-full" />
                      <span className="truncate">{isXUrl(u) ? `@${xAuthor(u) ?? hostOf(u)}` : hostOf(u)}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted" />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </Block>

        <Block title="Amplifiers" count={amps.length} icon={<Sparkles />}>
          {amps.length === 0 ? (
            <p className="text-[14px] text-muted">No amplifiers found.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {amps.map((a) => {
                const lead = Object.values(store.leads).find((l) => l.personId === a.personId);
                const handle = (a.xProfile?.handle ?? a.xHandle ?? a.handle ?? xHandle(lead) ?? (isXUrl(a.evidenceUrl) ? xAuthor(a.evidenceUrl) : null))?.replace(/^@/, "");
                const followers = a.xProfile?.followers ?? a.followers ?? xFollowers(lead);
                const url = a.xProfile?.url ?? (handle ? `https://x.com/${handle}` : xProfileUrl(lead));
                const name = personName(a.personId);
                return (
                  <li key={a.personId} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                    <Avatar name={name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px]">
                        <span className="font-semibold text-strong">{name}</span>
                        {handle && url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-forest">
                            <XGlyph size={10} />@{handle}
                          </a>
                        ) : null}
                        <span className="rounded-pill bg-raised px-1.5 text-[11px] leading-5 font-semibold text-charcoal">Tier {a.tier}</span>
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-body">{a.reason}</p>
                      <p className="mt-1.5 flex items-center gap-3 text-[12px] text-muted">
                        <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-forest">
                          <Favicon url={a.evidenceUrl} size={12} />
                          Their post
                          <ExternalLink className="size-3" />
                        </a>
                        {followers != null ? <span className="tabular">{compact(followers)} followers</span> : null}
                      </p>
                    </div>
                    <div className="w-14 shrink-0 text-right" title="Amplifier score">
                      <p className="tabular text-[18px] leading-none font-bold text-strong">{Math.round(a.score * 100)}</p>
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised">
                        <span className="block h-full rounded-full bg-forest" style={{ width: `${Math.round(a.score * 100)}%` }} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Block>

        <Block title="Listen queries" count={campaign.listenQueries.length} icon={<Search />}>
          <ul className="flex flex-col gap-1">
            {campaign.listenQueries.map((q) => (
              <li key={q} className="group -mx-2 flex items-center gap-2 rounded-card px-2 py-1 transition-colors hover:bg-recessed">
                <a
                  href={`https://x.com/search?q=${encodeURIComponent(q)}&f=live`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-[14px] text-strong"
                  title="Search live on X"
                >
                  <XGlyph size={11} className="shrink-0 text-muted group-hover:text-forest" />
                  <span className="truncate">{q}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
                <CopyButton text={q} label={`Copy "${q}"`} iconOnly />
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Credit plan" icon={<Gift />} aside={<Pill tone="muted">Simulated</Pill>}>
          <p className="text-[15px] text-body">
            <span className="tabular text-[36px] leading-none font-bold tracking-[-0.02em] text-strong">${credits.amountUsdEach}</span> each to{" "}
            <span className="tabular font-semibold text-strong">{credits.recipients.length}</span> {credits.recipients.length === 1 ? "builder" : "builders"}
          </p>
          {credits.recipients.length ? (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {credits.recipients.map((r) => (
                <span key={r} className="inline-flex items-center gap-1.5 rounded-pill bg-raised py-0.5 pr-2.5 pl-0.5 text-[12px] font-medium text-charcoal">
                  <Avatar name={personName(r)} size={20} tone="linen" />
                  {personName(r)}
                </span>
              ))}
            </p>
          ) : null}
          <blockquote className="mt-4 border-l-2 border-forest pl-4 text-[15px] leading-relaxed text-strong">“{credits.framing}”</blockquote>
          <p className="mt-4 flex items-center gap-2 text-[13px] text-body">
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-forest text-lime">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            Disclosure required: recipients say the credits came from us.
          </p>
        </Block>

        <Block title="UTM links" icon={<Link2 />} className="lg:col-span-2">
          <ul className="divide-y divide-hairline">
            {[
              ...campaign.hooks.map((_, i) => `hook-${i + 1}`),
              ...campaign.amplifiers.map((a) => `amp-${personName(a.personId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
            ].map((c) => (
              <li key={c} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                <span className="w-32 shrink-0 truncate text-[12px] font-semibold text-charcoal">{c}</span>
                <span className="flex-1 truncate font-mono text-[12px] text-muted" title={utm(c)}>
                  {utm(c)}
                </span>
                <CopyButton text={utm(c)} label={`Copy ${c} link`} iconOnly />
              </li>
            ))}
          </ul>
        </Block>
      </div>
    </div>
  );
}

export function CampaignTab({ store }: { store: RunStore }) {
  const list = Object.values(store.campaigns);
  const [sel, setSel] = React.useState<string | null>(null);
  const cur = list.find((c) => c.id === sel) ?? list[0];
  if (!cur) {
    if (store.lastSeq === 0)
      return (
        <div className="flex flex-col gap-5" aria-busy>
          <div className="h-[260px] animate-pulse rounded-large bg-recessed" />
          <div className="h-[120px] animate-pulse rounded-large bg-recessed" />
        </div>
      );
    return (
      <div className="flex flex-col items-center rounded-large bg-recessed px-6 py-16 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-paper text-forest">
          <Megaphone className="size-5" />
        </span>
        <p className="mt-4 text-[17px] font-semibold text-strong">No campaign yet</p>
        <p className="mt-1 text-[14px] text-muted">Tide builds one for each verified segment.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {list.length > 1 ? (
        <div className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-pill bg-raised p-1">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === cur.id}
              onClick={() => setSel(c.id)}
              className={cn(
                "h-8 cursor-pointer rounded-pill px-3 text-sm font-semibold transition-colors",
                c.id === cur.id ? "bg-paper text-forest shadow-[0_0_0_1px_var(--color-hairline)]" : "text-charcoal hover:bg-paper/70",
              )}
            >
              {store.segments[c.segmentId]?.name ?? c.segmentId}
            </button>
          ))}
        </div>
      ) : null}
      <CampaignBrief key={cur.id} campaign={cur} store={store} />
    </div>
  );
}
