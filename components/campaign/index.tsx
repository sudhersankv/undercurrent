"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Campaign } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { Button, Eyebrow, Pill, VerdictChip } from "@/components/ui";
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
      {done ? <Check className="text-lichen" /> : <Copy />}
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
    <section className={cn("rounded-card border border-hairline bg-raised p-5", className)}>
      <div className="mb-3 flex items-center gap-2">
        <Eyebrow as="h2">{title}</Eyebrow>
        {count != null ? <span className="font-mono text-[11px] text-muted">{count}</span> : null}
      </div>
      {children}
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
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg">{seg?.name ?? "Campaign"}</h2>
        {seg ? <VerdictChip verdict={seg.verdict} /> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="X posts" count={posts.length} className="lg:col-span-2">
          {posts.length === 0 ? (
            <p className="text-[13px] text-muted">No posts drafted.</p>
          ) : (
            <ul className="space-y-2">
              {posts.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-control bg-recessed p-3 sm:flex-row sm:items-start">
                  <p className="flex-1 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-strong">{d.body}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={cn("mr-1 font-mono text-[11px] tabular-nums", d.body.length > X_LIMIT ? "text-danger" : "text-muted")}>
                      {d.body.length}/{X_LIMIT}
                    </span>
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
          <ul className="space-y-1">
            {campaign.listenQueries.map((q) => (
              <li key={q} className="flex items-center gap-2 rounded-control bg-recessed py-1 pr-1 pl-3">
                <a
                  href={`https://x.com/search?q=${encodeURIComponent(q)}&f=live`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-2 font-mono text-[12px] text-strong hover:text-lichen"
                  title="Search on X"
                >
                  <XGlyph size={11} className="text-muted group-hover:text-lichen" />
                  <span className="truncate">{q}</span>
                </a>
                <CopyButton text={q} />
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Hooks" count={campaign.hooks.length}>
          <ul className="space-y-3">
            {campaign.hooks.map((h, i) => (
              <li key={i}>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[14px] text-strong">{h.angle}</p>
                  {h.vendorReportedNumbers ? <Pill tone="warning">Vendor-reported</Pill> : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {h.evidenceUrls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-lichen">
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
            <p className="text-[13px] text-muted">No amplifiers found.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {(campaign.amplifiers as Amplifier[]).map((a) => {
                const lead = Object.values(store.leads).find((l) => l.personId === a.personId);
                const handle = (a.xProfile?.handle ?? a.xHandle ?? a.handle ?? xHandle(lead))?.replace(/^@/, "");
                const followers = a.xProfile?.followers ?? a.followers ?? xFollowers(lead);
                const url = a.xProfile?.url ?? (handle ? `https://x.com/${handle}` : xProfileUrl(lead));
                return (
                <li key={a.personId} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <Pill tone="solid" mono>
                    T{a.tier}
                  </Pill>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-strong">
                      {personName(a.personId)}
                      {handle && url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-body hover:text-lichen">
                          <XGlyph size={10} />@{handle}
                        </a>
                      ) : null}
                      {followers != null ? <span className="font-mono text-[11px] text-muted">{compact(followers)} followers</span> : null}
                    </p>
                    <p className="text-xs text-body">{a.reason}</p>
                    <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-lichen">
                      {host(a.evidenceUrl)}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <span className="font-mono text-[12px] text-lichen">{a.score.toFixed(2)}</span>
                </li>
                );
              })}
            </ul>
          )}
        </Block>

        <Block title="Credit plan">
          <p className="text-[14px] text-strong">
            <span className="font-mono">${campaign.creditGiftPlan.amountUsdEach}</span> each to{" "}
            <span className="font-mono">{campaign.creditGiftPlan.recipients.length}</span>{" "}
            {campaign.creditGiftPlan.recipients.length === 1 ? "builder" : "builders"}
          </p>
          <p className="mt-1 text-[13px] text-body">“{campaign.creditGiftPlan.framing}”</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="muted">Simulated credits</Pill>
            <Pill tone="lichen">Disclosure required</Pill>
          </div>
          <p className="mt-2 text-xs text-muted">Recipients must say the credits came from us.</p>
        </Block>

        <Block title="UTM links" className="lg:col-span-2">
          <ul className="space-y-1">
            {[
              ...campaign.hooks.map((_, i) => `hook-${i + 1}`),
              ...campaign.amplifiers.map((a) => `amp-${personName(a.personId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
            ].map((c) => (
              <li key={c} className="flex items-center gap-2 rounded-control bg-recessed py-1 pr-1 pl-3">
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
      <div className="rounded-card border border-hairline bg-recessed p-10 text-center">
        <p className="text-[15px] text-strong">No campaign yet.</p>
        <p className="mt-1 text-[13px] text-muted">Tide builds one for each verified segment.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {list.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === cur.id}
              onClick={() => setSel(c.id)}
              className={cn("h-7 rounded-full border px-3 text-xs", c.id === cur.id ? "border-lichen/50 bg-raised text-strong" : "border-hairline text-body hover:bg-raised")}
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
