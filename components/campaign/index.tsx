"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Campaign } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { Button, Pill, VerdictChip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { compact, X_LIMIT, XGlyph, xFollowers, xHandle, xIntentUrl, xProfileUrl, type XDraft } from "@/components/review/x";

type Amplifier = Campaign["amplifiers"][number] & {
  handle?: string;
  xHandle?: string;
  followers?: number;
  xProfile?: { handle?: string; url?: string; followers?: number };
};

function isXUrl(u: string) {
  return /^https?:\/\/(www\.)?(x|twitter)\.com\//.test(u);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
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
      {done ? "Copied" : label}
    </Button>
  );
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Block({ title, count, children, className }: { title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-hairline bg-paper p-6", className)}>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
        {count != null ? <Pill tone="neutral" className="tabular font-semibold">{count}</Pill> : null}
      </div>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <p className="tabular text-[32px] leading-none font-bold tracking-[-0.02em] text-paper">{value}</p>
      <p className="mt-2 text-[13px] text-paper/70">{label}</p>
    </div>
  );
}

/** Forest summary card: lime headline number, the rest in paper. */
function CampaignSummary({ campaign, posts }: { campaign: Campaign; posts: number }) {
  const recipients = campaign.creditGiftPlan.recipients.length;
  const credits = campaign.creditGiftPlan.amountUsdEach * recipients;
  return (
    <section aria-label="Campaign summary" className="grid gap-8 rounded-large bg-forest p-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] md:p-10">
      <div>
        <p className="text-[13px] font-semibold tracking-[0.06em] text-paper/70 uppercase">Ready to post</p>
        <p className="mt-3 tabular text-[64px] leading-[0.9] font-bold tracking-[-0.03em] text-lime md:text-[80px]">{posts}</p>
        <p className="mt-3 text-[15px] text-paper/80">{posts === 1 ? "X post drafted" : "X posts drafted"}, posted by you.</p>
      </div>
      <div className="grid grid-cols-2 content-end gap-x-6 gap-y-6 border-white/15 sm:grid-cols-4 md:border-l md:pl-8">
        <Stat value={campaign.hooks.length} label="Hooks" />
        <Stat value={campaign.amplifiers.length} label="Amplifiers" />
        <Stat value={campaign.listenQueries.length} label="Listen queries" />
        <div className="min-w-0">
          <p className="tabular text-[32px] leading-none font-bold tracking-[-0.02em] text-paper">${compact(credits)}</p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-paper/70">
            Credits
            <span className="rounded-pill border border-white/40 px-2 text-[11px] font-semibold text-paper">Simulated</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/** Campaign brief for one segment (SPEC §10.7). */
export function CampaignBrief({ campaign, store }: { campaign: Campaign; store: RunStore }) {
  const seg = store.segments[campaign.segmentId];
  const site = store.profile?.url ?? "https://www.moss.dev";
  const utm = (content: string) => `${site.replace(/\/$/, "")}/?${campaign.utmBase}&utm_content=${encodeURIComponent(content)}`;
  const posts = campaign.posts.map((p) => store.drafts[p.draftId]).filter(Boolean);
  const personName = (id: string) => Object.values(store.leads).find((l) => l.personId === id)?.displayName ?? id.split("-person-").pop() ?? id;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-strong">{seg?.name ?? "Campaign"}</h2>
        {seg ? <VerdictChip verdict={seg.verdict} /> : null}
      </header>

      <CampaignSummary campaign={campaign} posts={posts.length} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="X posts" count={posts.length} className="lg:col-span-2">
          {posts.length === 0 ? (
            <p className="text-[14px] text-muted">No posts drafted.</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {posts.map((d) => (
                <li key={d.id} className="flex flex-col gap-3 rounded-card border border-hairline bg-paper p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-forest text-lime" aria-hidden>
                      <XGlyph size={13} />
                    </span>
                    <span className="flex-1 text-[14px] font-semibold text-strong">Your post</span>
                    <span className={cn("text-[12px] tabular", d.body.length > X_LIMIT ? "font-semibold text-danger" : "text-muted")}>
                      {d.body.length}/{X_LIMIT}
                    </span>
                  </div>
                  <p className="flex-1 text-[15px] leading-relaxed whitespace-pre-wrap text-strong">{d.body}</p>
                  <div className="flex items-center gap-1 border-t border-hairline pt-3">
                    <Button asChild size="sm" variant="outline">
                      <a href={xIntentUrl(d as XDraft)} target="_blank" rel="noopener noreferrer">
                        <XGlyph size={11} />
                        Open in X
                      </a>
                    </Button>
                    <CopyButton text={d.body} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Listen queries" count={campaign.listenQueries.length}>
          <ul className="divide-y divide-hairline">
            {campaign.listenQueries.map((q) => (
              <li key={q} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <a
                  href={`https://x.com/search?q=${encodeURIComponent(q)}&f=live`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-2 font-mono text-[13px] text-strong hover:text-forest hover:underline"
                  title="Search on X"
                >
                  <XGlyph size={11} className="text-muted group-hover:text-forest" />
                  <span className="truncate">{q}</span>
                </a>
                <CopyButton text={q} />
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Hooks" count={campaign.hooks.length}>
          <ul className="divide-y divide-hairline">
            {campaign.hooks.map((h, i) => (
              <li key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[15px] font-medium text-strong">{h.angle}</p>
                  {h.vendorReportedNumbers ? <Pill tone="warning">Vendor-reported</Pill> : null}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {h.evidenceUrls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-forest">
                      {isXUrl(u) ? <XGlyph size={10} /> : null}
                      {isXUrl(u) ? (/x\.com\/([^/]+)/.exec(u.replace("twitter.com", "x.com"))?.[1] ?? host(u)) : host(u)}
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Amplifiers" count={campaign.amplifiers.length}>
          {campaign.amplifiers.length === 0 ? (
            <p className="text-[14px] text-muted">No amplifiers found.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {(campaign.amplifiers as Amplifier[]).map((a) => {
                const lead = Object.values(store.leads).find((l) => l.personId === a.personId);
                const handle = (a.xProfile?.handle ?? a.xHandle ?? a.handle ?? xHandle(lead))?.replace(/^@/, "");
                const followers = a.xProfile?.followers ?? a.followers ?? xFollowers(lead);
                const url = a.xProfile?.url ?? (handle ? `https://x.com/${handle}` : xProfileUrl(lead));
                return (
                <li key={a.personId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-[13px] font-semibold text-forest tabular" title={`Tier ${a.tier}`}>
                    T{a.tier}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold text-strong">
                      {personName(a.personId)}
                      {handle && url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] font-normal text-charcoal hover:text-forest">
                          <XGlyph size={10} />@{handle}
                        </a>
                      ) : null}
                      {followers != null ? <span className="text-[12px] font-normal text-muted tabular">{compact(followers)} followers</span> : null}
                    </p>
                    <p className="mt-0.5 text-[13px] text-body">{a.reason}</p>
                    <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-forest">
                      {host(a.evidenceUrl)}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <span className="font-mono text-[13px] font-semibold text-forest tabular">{a.score.toFixed(2)}</span>
                </li>
                );
              })}
            </ul>
          )}
        </Block>

        <Block title="Credit plan">
          <p className="text-[15px] text-body">
            <span className="tabular text-[28px] font-bold tracking-[-0.02em] text-strong">${campaign.creditGiftPlan.amountUsdEach}</span> each to{" "}
            <span className="tabular font-semibold text-strong">{campaign.creditGiftPlan.recipients.length}</span>{" "}
            {campaign.creditGiftPlan.recipients.length === 1 ? "builder" : "builders"}
          </p>
          <p className="mt-2 rounded-card bg-recessed px-4 py-3 text-[14px] text-body italic">“{campaign.creditGiftPlan.framing}”</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="muted">Simulated credits</Pill>
            <Pill tone="lichen">Disclosure required</Pill>
          </div>
          <p className="mt-2 text-[13px] text-muted">Recipients must say the credits came from us.</p>
        </Block>

        <Block title="UTM links" className="lg:col-span-2">
          <ul className="divide-y divide-hairline">
            {[
              ...campaign.hooks.map((_, i) => `hook-${i + 1}`),
              ...campaign.amplifiers.map((a) => `amp-${personName(a.personId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
            ].map((c) => (
              <li key={c} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="w-28 shrink-0 font-mono text-[11px] text-muted">{c}</span>
                <span className="flex-1 truncate font-mono text-[12px] text-body">{utm(c)}</span>
                <CopyButton text={utm(c)} />
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
    return (
      <div className="rounded-large bg-recessed p-10 text-center">
        <p className="text-[16px] font-semibold text-strong">No campaign yet.</p>
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
                "h-8 rounded-pill px-3 text-sm font-semibold transition-colors",
                c.id === cur.id ? "bg-paper text-forest ring-1 ring-hairline" : "text-charcoal hover:bg-paper",
              )}
            >
              {store.segments[c.segmentId]?.name ?? c.segmentId}
            </button>
          ))}
        </div>
      ) : null}
      <CampaignBrief campaign={cur} store={store} />
    </div>
  );
}
