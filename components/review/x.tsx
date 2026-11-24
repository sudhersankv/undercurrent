import * as React from "react";
import type { Draft, DraftChannel, Lead } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * X-first helpers shared by review, inbox, campaign and leads.
 * The engine adds these optional fields in parallel; until they land on main we read them defensively.
 */
export interface XProfile {
  handle: string;
  url: string;
  followers?: number;
  bioSnippet?: string;
  recentPostUrls: string[];
}
export type XLead = Lead & { xProfile?: XProfile };
export type XDraft = Draft & { xIntentUrl?: string; replyToUrl?: string };

export const X_LIMIT = 280;

export function isXChannel(c: DraftChannel | string | undefined): boolean {
  return c === "x_dm" || c === "x_reply" || c === "x_post";
}

export function isEmailChannel(c: DraftChannel | string | undefined): boolean {
  return c === "email" || c === "followup_email";
}

/** Review tab order: X reply, X DM, Email, LinkedIn (X post only when one exists). */
export const CHANNEL_TABS: { id: string; label: string; channels: DraftChannel[] }[] = [
  { id: "x_reply", label: "X reply", channels: ["x_reply"] },
  { id: "x_dm", label: "X DM", channels: ["x_dm"] },
  { id: "email", label: "Email", channels: ["email", "followup_email"] },
  { id: "linkedin", label: "LinkedIn", channels: ["linkedin"] },
  { id: "x_post", label: "X post", channels: ["x_post"] },
];

export function channelTab(c: DraftChannel): string {
  return CHANNEL_TABS.find((t) => t.channels.includes(c))?.id ?? "email";
}

export const CHANNEL_LABEL: Record<DraftChannel, string> = {
  email: "Email",
  followup_email: "Follow-up",
  linkedin: "LinkedIn",
  x_dm: "X DM",
  x_reply: "X reply",
  x_post: "X post",
};

/** Handle without "@", from the X profile or the lead's handles. */
export function xHandle(lead: Lead | undefined | null): string | null {
  const l = lead as XLead | undefined | null;
  const h = l?.xProfile?.handle ?? l?.handles?.x;
  return h ? h.replace(/^@/, "") : null;
}

export function xProfileUrl(lead: Lead | undefined | null): string | null {
  const l = lead as XLead | undefined | null;
  if (l?.xProfile?.url) return l.xProfile.url;
  const h = xHandle(lead);
  return h ? `https://x.com/${h}` : null;
}

export function xFollowers(lead: Lead | undefined | null): number | undefined {
  return (lead as XLead | undefined | null)?.xProfile?.followers;
}

function tweetId(url: string | undefined): string | null {
  return url ? (/\/status(?:es)?\/(\d+)/.exec(url)?.[1] ?? null) : null;
}

/** Engine-provided intent URL, else a post intent with the body (as a reply when we know the post id). */
export function xIntentUrl(d: Pick<Draft, "body" | "channel"> & { xIntentUrl?: string; replyToUrl?: string }): string {
  if (d.xIntentUrl) return d.xIntentUrl;
  const id = d.channel === "x_reply" ? tweetId(d.replyToUrl) : null;
  return `https://x.com/intent/post?text=${encodeURIComponent(d.body)}${id ? `&in_reply_to=${id}` : ""}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Monochrome X mark, 16x16 grid like the department glyphs. */
export function XGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" role="img" aria-label="X" className={cn("shrink-0", className)}>
      <path d="M9.47 6.77 14.82.5h-1.27L8.9 5.94 5.2.5H.9l5.6 8.17L.9 15.5h1.27l4.9-5.73 3.92 5.73h4.29L9.47 6.77Zm-1.74 2.03-.57-.81L2.63 1.46h1.95l3.64 5.21.57.81 4.73 6.77h-1.95L7.73 8.8Z" />
    </svg>
  );
}

/** Envelope on the same grid, stroke style like DeptGlyph. */
export function MailGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" role="img" aria-label="Email" className={cn("shrink-0", className)}>
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="m2 4 6 5 6-5" />
    </svg>
  );
}

export function ChannelGlyph({ channel, size = 14, className }: { channel: DraftChannel | string; size?: number; className?: string }) {
  if (isXChannel(channel)) return <XGlyph size={size} className={className} />;
  if (channel === "linkedin")
    return (
      <span aria-label="LinkedIn" className={cn("inline-flex items-center justify-center font-mono text-[10px] font-medium", className)} style={{ width: size, height: size }}>
        in
      </span>
    );
  return <MailGlyph size={size} className={className} />;
}

/** The post we're replying to, as a small link card (no iframe). */
export function ReplyToCard({ url, className }: { url: string; className?: string }) {
  let path = url;
  try {
    const u = new URL(url);
    path = u.pathname;
  } catch {
    /* keep raw */
  }
  const author = /^\/([^/]+)\/status/.exec(path)?.[1];
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("flex items-center gap-2.5 rounded-control border border-hairline bg-recessed px-3 py-2 transition-colors hover:border-hairline-strong", className)}
    >
      <XGlyph size={13} className="text-muted" />
      <span className="min-w-0 flex-1">
        <span className="eyebrow block text-[10px]">Replying to</span>
        <span className="block truncate font-mono text-[12px] text-strong">{author ? `@${author}` : "post"}</span>
      </span>
      <span className="truncate font-mono text-[11px] text-muted">{tweetId(url) ?? path}</span>
    </a>
  );
}
