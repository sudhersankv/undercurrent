import type { Draft, Evidence, Lead, LeadStage } from "@/lib/contracts";
import type { RunStore } from "./run-store";

/**
 * GTM-workspace derivations over the run store: people vs accounts, authored evidence,
 * pipeline counts. Pure functions; Lead GTM fields (kind, account, linkedinUrl, …) are optional
 * and read defensively since Pilot adds them.
 */

export type SizeBand = "solo" | "startup" | "smb" | "enterprise";
export const SIZE_BANDS: SizeBand[] = ["solo", "startup", "smb", "enterprise"];
export const SIZE_LABEL: Record<SizeBand, string> = { solo: "Solo", startup: "Startup", smb: "SMB", enterprise: "Enterprise" };

export interface LeadAccount {
  name: string;
  domain?: string;
  sizeBand?: SizeBand;
  sizeSource?: string;
  industry?: string;
  contactIds?: string[];
}

export type LeadExt = Lead & {
  kind?: "person" | "account";
  account?: LeadAccount;
  linkedinUrl?: string;
  website?: string;
  location?: string;
  role?: string;
  title?: string;
};

export const ext = (l: Lead) => l as LeadExt;

export function isAccount(l: Lead): boolean {
  return ext(l).kind === "account";
}

export function people(store: RunStore): LeadExt[] {
  return Object.values(store.leads).filter((l) => !isAccount(l)) as LeadExt[];
}

export function linkedinUrl(l: Lead): string | null {
  const e = ext(l);
  const h = e.linkedinUrl ?? l.handles.linkedin;
  if (!h) return null;
  return /^https?:/.test(h) ? h : `https://www.linkedin.com/in/${h.replace(/^@/, "")}`;
}

export function websiteUrl(l: Lead): string | null {
  const e = ext(l);
  if (e.website) return /^https?:/.test(e.website) ? e.website : `https://${e.website}`;
  const d = e.account?.domain ?? l.company?.domain;
  return d ? `https://${d.replace(/^https?:\/\//, "")}` : null;
}

export function roleLine(l: Lead): string | null {
  const e = ext(l);
  const role = e.role ?? e.title ?? null;
  const company = e.account?.name ?? l.company?.name ?? null;
  return [role, company].filter(Boolean).join(" · ") || null;
}

function handlesOf(l: Lead): Set<string> {
  const hs = [l.handles.github, l.handles.x, l.handles.hn, l.xProfile?.handle].filter(Boolean) as string[];
  return new Set(hs.map((h) => h.replace(/^@/, "").toLowerCase()));
}

/** Evidence this person wrote (author matches one of their handles), across every segment. */
export function authoredEvidence(store: RunStore, l: Lead): Evidence[] {
  const hs = handlesOf(l);
  if (!hs.size) return [];
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const list of Object.values(store.evidence))
    for (const e of list) {
      const a = e.author?.replace(/^@/, "").toLowerCase();
      if (a && hs.has(a) && !seen.has(e.url)) {
        seen.add(e.url);
        out.push(e);
      }
    }
  return out;
}

/** The GitHub issue they opened (authored evidence first, else a brief link that looks like an issue). */
export function openedIssue(store: RunStore, l: Lead): { url: string; title: string } | null {
  const e = authoredEvidence(store, l).find((x) => x.source === "github_issue");
  if (e) return { url: e.url, title: e.title };
  const b = store.briefs[l.id]?.evidence.find((x) => /github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(x.url));
  return b ? { url: b.url, title: b.text } : null;
}

/** Their X pain post: an authored x_post, else the most relevant recent post URL. */
export function painPost(store: RunStore, l: Lead): { url: string; text: string | null } | null {
  const e = authoredEvidence(store, l).find((x) => x.source === "x_post");
  if (e) return { url: e.url, text: e.quote || e.title };
  const u = l.xProfile?.recentPostUrls?.[0];
  return u ? { url: u, text: null } : null;
}

export function draftsFor(store: RunStore, leadId: string): Draft[] {
  return Object.values(store.drafts).filter((d) => d.leadId === leadId);
}

// ---------- accounts ----------

export interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  sizeBand: SizeBand | null;
  sizeSource: string | null;
  industry: string | null;
  segmentName: string;
  segmentId: string;
  why: string | null;
  fitScore: number;
  stage: LeadStage | null;
  contacts: LeadExt[];
  /** The account lead itself, when Pilot produced one. */
  lead: LeadExt | null;
}

const keyOf = (name: string, domain?: string | null) => (domain ? domain.toLowerCase().replace(/^www\./, "") : name.toLowerCase().trim());

/** Accounts = Pilot's account leads, plus companies of people leads (grouped), with linked contacts. */
export function accountRows(store: RunStore): AccountRow[] {
  const leads = Object.values(store.leads) as LeadExt[];
  const byKey = new Map<string, AccountRow>();
  const byId = new Map(leads.map((l) => [l.id, l]));
  const seg = (id: string) => store.segments[id]?.name ?? "Unknown segment";

  for (const l of leads.filter((x) => x.kind === "account")) {
    const a = l.account ?? { name: l.company?.name ?? l.displayName, domain: l.company?.domain };
    const key = keyOf(a.name, a.domain);
    byKey.set(key, {
      id: l.id,
      name: a.name,
      domain: a.domain ?? null,
      sizeBand: a.sizeBand ?? null,
      sizeSource: a.sizeSource ?? null,
      industry: a.industry ?? null,
      segmentName: seg(l.segmentId),
      segmentId: l.segmentId,
      why: store.briefs[l.id]?.howWeFit ?? null,
      fitScore: l.fitScore,
      stage: l.stage,
      contacts: (a.contactIds ?? []).map((id) => byId.get(id)).filter((x): x is LeadExt => !!x),
      lead: l,
    });
  }
  for (const p of leads.filter((x) => x.kind !== "account")) {
    const a = p.account ?? (p.company ? { name: p.company.name, domain: p.company.domain } : null);
    if (!a?.name) continue;
    const key = keyOf(a.name, a.domain);
    let row = byKey.get(key);
    if (!row) {
      row = {
        id: `acct:${key}`,
        name: a.name,
        domain: a.domain ?? null,
        sizeBand: (a as LeadAccount).sizeBand ?? null,
        sizeSource: (a as LeadAccount).sizeSource ?? null,
        industry: (a as LeadAccount).industry ?? null,
        segmentName: seg(p.segmentId),
        segmentId: p.segmentId,
        why: store.briefs[p.id]?.howWeFit ?? null,
        fitScore: p.fitScore,
        stage: null,
        contacts: [],
        lead: null,
      };
      byKey.set(key, row);
    }
    if (!row.contacts.some((c) => c.id === p.id)) row.contacts.push(p);
    row.fitScore = Math.max(row.fitScore, p.fitScore);
  }
  return [...byKey.values()].sort((x, y) => y.fitScore - x.fitScore);
}

// ---------- pipeline ----------

export const PIPELINE: { stage: LeadStage; label: string }[] = [
  { stage: "discovered", label: "Discovered" },
  { stage: "approved", label: "Approved" },
  { stage: "contacted", label: "Contacted" },
  { stage: "replied", label: "Replied" },
  { stage: "meeting", label: "Meeting" },
  { stage: "won", label: "Won" },
  { stage: "lost", label: "Lost" },
];

export function pipelineCounts(store: RunStore): Record<LeadStage, number> {
  const c = { discovered: 0, approved: 0, contacted: 0, replied: 0, meeting: 0, won: 0, lost: 0 } as Record<LeadStage, number>;
  for (const l of Object.values(store.leads)) c[l.stage] = (c[l.stage] ?? 0) + 1;
  return c;
}
