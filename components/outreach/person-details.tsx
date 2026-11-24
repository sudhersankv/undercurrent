"use client";

import { ExternalLink, GitBranch, Globe, Briefcase, Mail, MapPin } from "lucide-react";
import type { Lead } from "@/lib/contracts";
import type { RunStore } from "@/lib/client/run-store";
import { authoredEvidence, ext, linkedinUrl, openedIssue, painPost, roleLine, websiteUrl } from "@/lib/client/gtm";
import { Eyebrow } from "@/components/ui";
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
    <div className="space-y-3 text-[13px]">
      <div>
        <p className="text-[15px] font-medium text-strong">{lead.displayName}</p>
        {role ? <p className="text-body">{role}</p> : null}
        {e.location ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
            <MapPin className="size-3" />
            {e.location}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
        {gh ? (
          <>
            <dt className="text-muted">GitHub</dt>
            <dd className="min-w-0 space-y-0.5">
              <Ext href={`https://github.com/${gh}`}>@{gh}</Ext>
              {lead.primaryRepo ? (
                <Ext href={`https://github.com/${lead.primaryRepo}`} icon={<GitBranch className="size-3" />}>
                  {lead.primaryRepo}
                </Ext>
              ) : null}
              {issue ? <Ext href={issue.url}>{/^issue/i.test(issue.title) ? issue.title : `Issue: ${issue.title}`}</Ext> : null}
            </dd>
          </>
        ) : lead.primaryRepo ? (
          <>
            <dt className="text-muted">Repo</dt>
            <dd>
              <Ext href={`https://github.com/${lead.primaryRepo}`}>{lead.primaryRepo}</Ext>
            </dd>
          </>
        ) : null}
        {x ? (
          <>
            <dt className="text-muted">X</dt>
            <dd className="min-w-0 space-y-0.5">
              <Ext href={x.url} icon={<XGlyph size={11} />}>
                @{x.handle}
                {lead.xProfile?.followers != null ? <span className="text-muted"> · {compact(lead.xProfile.followers)} followers</span> : null}
              </Ext>
              {post ? <Ext href={post.url}>{post.text ? `Pain post: “${post.text.slice(0, 90)}”` : "Their post"}</Ext> : null}
            </dd>
          </>
        ) : null}
        {lead.handles.hn ? (
          <>
            <dt className="text-muted">HN</dt>
            <dd>
              <Ext href={`https://news.ycombinator.com/user?id=${lead.handles.hn}`}>{lead.handles.hn}</Ext>
            </dd>
          </>
        ) : null}
        {li ? (
          <>
            <dt className="text-muted">LinkedIn</dt>
            <dd>
              <Ext href={li} icon={<Briefcase className="size-3" />}>
                {li.replace(/^https?:\/\/(www\.)?/, "")}
              </Ext>
            </dd>
          </>
        ) : null}
        {web ? (
          <>
            <dt className="text-muted">Website</dt>
            <dd>
              <Ext href={web} icon={<Globe className="size-3" />}>
                {web.replace(/^https?:\/\//, "")}
              </Ext>
            </dd>
          </>
        ) : null}
        {lead.email ? (
          <>
            <dt className="text-muted">Email</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <Mail className="size-3 text-muted" />
              <span className="font-mono text-body">{lead.email.address}</span>
              <span className="rounded-full border border-hairline-strong px-1.5 text-[10.5px] text-muted" title="Public address. We draft, we never email real leads.">
                draft only
              </span>
              <span className="text-[10.5px] text-muted">{lead.email.source === "github_public" ? "GitHub public" : "Hunter"}</span>
            </dd>
          </>
        ) : null}
      </dl>

      {lead.xProfile?.bioSnippet ? <p className="text-[12px] italic text-body">“{lead.xProfile.bioSnippet}”</p> : null}

      {authored.length ? (
        <section>
          <Eyebrow className="mb-1">What they wrote</Eyebrow>
          <ul className="space-y-1.5">
            {authored.slice(0, 5).map((ev) => (
              <li key={ev.url}>
                <a href={ev.url} target="_blank" rel="noopener noreferrer" className="block rounded-control border border-hairline bg-recessed px-2.5 py-2 hover:border-hairline-strong">
                  <span className="block text-strong">“{ev.quote}”</span>
                  <span className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-muted">
                    {ev.source.replace("_", " ")} · <span className="truncate">{ev.title}</span>
                    <ExternalLink className="size-3 shrink-0" />
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
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 text-strong underline decoration-hairline-strong underline-offset-2 hover:decoration-lichen">
      {icon}
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted" />
    </a>
  );
}
