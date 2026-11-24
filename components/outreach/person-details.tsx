"use client";

import { ArrowUpRight, BookMarked, Briefcase, CircleDot, Globe, Lock, Mail, MapPin, MessageSquare } from "lucide-react";
import type { Lead } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { authoredEvidence, ext, linkedinUrl, openedIssue, painPost, websiteUrl } from "@/lib/client/gtm";
import { compact, XGlyph } from "@/components/review/x";
import { cn } from "@/lib/utils";

/** Real, public data about one person: where they are and what they wrote. Icon rows (label + value). */
export function PersonDetails({ lead, store }: { lead: Lead; store: RunStore }) {
  const e = ext(lead);
  const gh = lead.handles.github;
  const issue = openedIssue(store, lead);
  const x = lead.xProfile ?? (lead.handles.x ? { handle: lead.handles.x.replace(/^@/, ""), url: `https://x.com/${lead.handles.x.replace(/^@/, "")}`, recentPostUrls: [] as string[] } : null);
  const post = painPost(store, lead);
  const li = linkedinUrl(lead);
  const web = websiteUrl(lead);
  const authored = authoredEvidence(store, lead);

  const rows: { key: string; icon: React.ReactNode; label: string; value: React.ReactNode }[] = [];
  if (gh) rows.push({ key: "gh", icon: <GhMark />, label: "GitHub", value: <Ext href={`https://github.com/${gh}`}>@{gh}</Ext> });
  if (lead.primaryRepo) rows.push({ key: "repo", icon: <BookMarked className="size-3.5" />, label: "Repo", value: <Ext href={`https://github.com/${lead.primaryRepo}`}>{lead.primaryRepo}</Ext> });
  if (issue)
    rows.push({ key: "issue", icon: <CircleDot className="size-3.5" />, label: "Issue", value: <Ext href={issue.url}>{issue.title.replace(/^issue:?\s*/i, "")}</Ext> });
  if (x)
    rows.push({
      key: "x",
      icon: <XGlyph size={11} />,
      label: "X",
      value: (
        <Ext href={x.url} after={lead.xProfile?.followers != null ? `${compact(lead.xProfile.followers)} followers` : undefined}>
          @{x.handle}
        </Ext>
      ),
    });
  if (post) rows.push({ key: "post", icon: <MessageSquare className="size-3.5" />, label: "Pain post", value: <Ext href={post.url}>{post.text ? `“${post.text}”` : "Their post"}</Ext> });
  if (lead.handles.hn) rows.push({ key: "hn", icon: <span className="text-[10px] font-bold">Y</span>, label: "HN", value: <Ext href={`https://news.ycombinator.com/user?id=${lead.handles.hn}`}>{lead.handles.hn}</Ext> });
  if (li) rows.push({ key: "li", icon: <Briefcase className="size-3.5" />, label: "LinkedIn", value: <Ext href={li}>{li.replace(/^https?:\/\/(www\.)?/, "")}</Ext> });
  if (web) rows.push({ key: "web", icon: <Globe className="size-3.5" />, label: "Website", value: <Ext href={web}>{web.replace(/^https?:\/\//, "")}</Ext> });
  if (e.location) rows.push({ key: "loc", icon: <MapPin className="size-3.5" />, label: "Location", value: <span className="truncate text-strong">{e.location}</span> });
  if (lead.email)
    rows.push({
      key: "mail",
      icon: <Mail className="size-3.5" />,
      label: "Email",
      value: (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-[12.5px] text-strong">{lead.email.address}</span>
          <span
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-pill bg-raised px-2 text-[11px] font-semibold text-charcoal"
            title="Public address. We draft, we never email real leads."
          >
            <Lock className="size-2.5" strokeWidth={2.5} />
            Draft only
          </span>
        </span>
      ),
    });

  return (
    <section aria-label="Contact" className="space-y-5 text-[14px]">
      {rows.length ? (
        <div>
          <h3 className="mb-2 text-[16px] font-semibold tracking-[-0.01em] text-strong">Where they are</h3>
          <dl className="divide-y divide-hairline">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[28px_84px_minmax(0,1fr)] items-center gap-3 py-2">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-raised text-forest">{r.icon}</span>
                <dt className="text-[13px] text-muted">{r.label}</dt>
                <dd className="min-w-0 text-[13.5px]">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {lead.xProfile?.bioSnippet ? (
        <blockquote className="border-l-2 border-hairline-strong pl-3.5 text-[13.5px] italic leading-relaxed text-body">“{lead.xProfile.bioSnippet}”</blockquote>
      ) : null}

      {authored.length ? (
        <div>
          <h3 className="mb-2 text-[16px] font-semibold tracking-[-0.01em] text-strong">What they wrote</h3>
          <ul className="space-y-2">
            {authored.slice(0, 5).map((ev) => (
              <li key={ev.url}>
                <a
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-card border border-hairline px-4 py-3 transition-colors duration-150 hover:border-forest/35 hover:bg-[#f6fbf2]"
                >
                  <span className="block text-[13.5px] leading-relaxed text-strong">“{ev.quote}”</span>
                  <span className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-muted">
                    <Favicon url={ev.url} />
                    <span className="min-w-0 truncate font-medium text-charcoal">{ev.title}</span>
                    <span className="shrink-0">· {ev.source.replace("_", " ")}</span>
                    <ArrowUpRight className="ml-auto size-3.5 shrink-0 group-hover:text-forest" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Favicon({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {}
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`} alt="" width={14} height={14} loading="lazy" className="size-3.5 shrink-0 rounded-[3px]" />;
}

function GhMark() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function Ext({ href, children, after, className }: { href: string; children: React.ReactNode; after?: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("group flex min-w-0 items-center gap-1.5 font-medium text-forest", className)}>
      <span className="truncate underline decoration-forest/30 decoration-[1.5px] underline-offset-4 transition-colors group-hover:decoration-forest">{children}</span>
      {after ? <span className="shrink-0 text-[12px] font-normal text-muted">{after}</span> : null}
      <ArrowUpRight className="size-3 shrink-0 text-muted transition-colors group-hover:text-forest" />
    </a>
  );
}
