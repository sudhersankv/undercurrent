"use client";

import { ExternalLink, GitBranch, Globe, Briefcase, Lock, Mail, MapPin } from "lucide-react";
import type { Lead } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { authoredEvidence, ext, linkedinUrl, openedIssue, painPost, roleLine, websiteUrl } from "@/lib/client/gtm";
import { Pill } from "@/components/ui";
import { compact, XGlyph } from "@/components/review/x";

/** Real, public data about one person: who they are, where they are, what they wrote. */
export function PersonDetails({ lead, store }: { lead: Lead; store: RunStore }) {
  const e = ext(lead);
  const gh = lead.handles.github;
  const issue = openedIssue(store, lead);
  const x = lead.xProfile ?? (lead.handles.x ? { handle: lead.handles.x.replace(/^@/, ""), url: `https://x.com/${lead.handles.x.replace(/^@/, "")}`, recentPostUrls: [] as string[] } : null);
  const post = painPost(store, lead);
  const li = linkedinUrl(lead);
  const web = websiteUrl(lead);
  const authored = authoredEvidence(store, lead);
  const role = roleLine(lead);

  return (
    <div className="space-y-4 text-[14px]">
      <div>
        <p className="text-[16px] font-semibold text-strong">{lead.displayName}</p>
        {role ? <p className="text-body">{role}</p> : null}
        {e.location ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[13px] text-muted">
            <MapPin className="size-3.5" />
            {e.location}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2.5 text-[13px]">
        {gh ? (
          <>
            <dt className="font-semibold text-muted">GitHub</dt>
            <dd className="min-w-0 space-y-1">
              <Ext href={`https://github.com/${gh}`}>@{gh}</Ext>
              {lead.primaryRepo ? (
                <Ext href={`https://github.com/${lead.primaryRepo}`} icon={<GitBranch className="size-3.5" />}>
                  {lead.primaryRepo}
                </Ext>
              ) : null}
              {issue ? <Ext href={issue.url}>{/^issue/i.test(issue.title) ? issue.title : `Issue: ${issue.title}`}</Ext> : null}
            </dd>
          </>
        ) : lead.primaryRepo ? (
          <>
            <dt className="font-semibold text-muted">Repo</dt>
            <dd>
              <Ext href={`https://github.com/${lead.primaryRepo}`}>{lead.primaryRepo}</Ext>
            </dd>
          </>
        ) : null}
        {x ? (
          <>
            <dt className="font-semibold text-muted">X</dt>
            <dd className="min-w-0 space-y-1">
              <Ext href={x.url} icon={<XGlyph size={11} />}>
                @{x.handle}
                {lead.xProfile?.followers != null ? <span className="font-normal text-muted"> · {compact(lead.xProfile.followers)} followers</span> : null}
              </Ext>
              {post ? <Ext href={post.url}>{post.text ? `Pain post: “${post.text.slice(0, 90)}”` : "Their post"}</Ext> : null}
            </dd>
          </>
        ) : null}
        {lead.handles.hn ? (
          <>
            <dt className="font-semibold text-muted">HN</dt>
            <dd>
              <Ext href={`https://news.ycombinator.com/user?id=${lead.handles.hn}`}>{lead.handles.hn}</Ext>
            </dd>
          </>
        ) : null}
        {li ? (
          <>
            <dt className="font-semibold text-muted">LinkedIn</dt>
            <dd>
              <Ext href={li} icon={<Briefcase className="size-3.5" />}>
                {li.replace(/^https?:\/\/(www\.)?/, "")}
              </Ext>
            </dd>
          </>
        ) : null}
        {web ? (
          <>
            <dt className="font-semibold text-muted">Website</dt>
            <dd>
              <Ext href={web} icon={<Globe className="size-3.5" />}>
                {web.replace(/^https?:\/\//, "")}
              </Ext>
            </dd>
          </>
        ) : null}
        {lead.email ? (
          <>
            <dt className="font-semibold text-muted">Email</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Mail className="size-3.5 text-muted" />
              <span className="min-w-0 truncate font-mono text-[12.5px] text-body">{lead.email.address}</span>
              <Pill tone="muted" className="gap-1 px-2 py-0 text-[11px] font-semibold text-charcoal" title="Public address. We draft, we never email real leads.">
                <Lock className="size-3" />
                draft only
              </Pill>
              <span className="text-[12px] text-muted">{lead.email.source === "github_public" ? "GitHub public" : "Hunter"}</span>
            </dd>
          </>
        ) : null}
      </dl>

      {lead.xProfile?.bioSnippet ? <blockquote className="rounded-card bg-recessed px-3.5 py-3 text-[13.5px] italic leading-relaxed text-body">“{lead.xProfile.bioSnippet}”</blockquote> : null}

      {authored.length ? (
        <section>
          <h3 className="mb-2 text-[15px] font-semibold text-strong">What they wrote</h3>
          <ul className="space-y-2">
            {authored.slice(0, 5).map((ev) => (
              <li key={ev.url}>
                <a href={ev.url} target="_blank" rel="noopener noreferrer" className="group block rounded-card bg-recessed px-3.5 py-3 transition-colors hover:bg-linen">
                  <span className="block text-[13.5px] leading-relaxed text-strong">“{ev.quote}”</span>
                  <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[12px] text-muted">
                    <span className="shrink-0">{ev.source.replace("_", " ")}</span> ·{" "}
                    <span className="truncate font-medium text-forest underline decoration-forest/40 underline-offset-4 group-hover:decoration-forest">{ev.title}</span>
                    <ExternalLink className="size-3 shrink-0 text-forest" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Ext({ href, children, icon }: { href: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 items-center gap-1.5 font-medium text-forest"
    >
      {icon ? <span className="shrink-0 text-forest">{icon}</span> : null}
      <span className="truncate underline decoration-forest/40 decoration-[1.5px] underline-offset-4 group-hover:decoration-forest">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted group-hover:text-forest" />
    </a>
  );
}
