import { z } from "zod";
import type { Capability, CompanyProfile, Competitor, SonarInput } from "@/lib/contracts";

/** What the LLM returns (lenient: URLs are strings, ids are assigned by us). */
export const ProfileDraft = z.object({
  name: z.string(),
  oneLiner: z.string(),
  category: z.string(),
  capabilities: z.array(
    z.object({
      statement: z.string(),
      sourceUrls: z.array(z.string()),
      confidence: z.number().min(0).max(1),
      inferred: z.boolean(),
      fromIntake: z.boolean(),
    }),
  ),
  integrations: z.array(z.string()),
  pricing: z.object({ summary: z.string().nullable(), sourceUrls: z.array(z.string()) }),
  statedTargetUsers: z.array(z.object({ description: z.string(), sourceUrls: z.array(z.string()), fromIntake: z.boolean() })),
  proofPoints: z.array(z.object({ claim: z.string(), vendorReported: z.boolean(), sourceUrls: z.array(z.string()) })),
  competitors: z.array(
    z.object({
      name: z.string(),
      url: z.string().nullable(),
      kind: z.enum(["direct", "indirect", "alternative"]),
      positioning: z.string(),
      pricingSummary: z.string().nullable(),
      ourDifferentiator: z.string(),
      sourceUrls: z.array(z.string()),
    }),
  ),
  corpusPhrases: z.array(z.string()),
});
export type ProfileDraft = z.infer<typeof ProfileDraft>;

export const normUrl = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

function isUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/** Keep only URLs that were actually in the provided sources (exact after normalization). */
export function keepSourced(urls: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const u of urls) if (isUrl(u) && allowed.has(normUrl(u)) && !out.includes(u)) out.push(u);
  return out;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "x";

/**
 * SPEC §5.1 step 3–5 post-processing: enforce sourcing (unsourced → inferred, confidence ≤ 0.4),
 * intake facts tagged source "intake", 3–6 competitors (sourced first), ids assigned.
 */
export function finalizeProfile(
  runId: string,
  draft: ProfileDraft,
  opts: { mode: "url" | "intake_notes"; url: string | null; allowed: Set<string>; input: SonarInput },
): CompanyProfile {
  const { allowed, input, mode } = opts;
  const capabilities: Capability[] = draft.capabilities
    .filter((c) => c.statement.trim())
    .map((c, i) => {
      const sourceUrls = keepSourced(c.sourceUrls, allowed);
      const id = `${runId}-cap-${i + 1}`;
      if (c.fromIntake && input.notes) {
        return { id, statement: c.statement.trim(), sourceUrls, source: "intake", inferred: false, confidence: 0.7 } satisfies Capability;
      }
      const inferred = c.inferred || sourceUrls.length === 0;
      const confidence = inferred ? Math.min(c.confidence, 0.4) : c.confidence;
      return { id, statement: c.statement.trim(), sourceUrls, source: "web", inferred, confidence } satisfies Capability;
    });

  // Contract needs ≥3 capabilities: pad from intake sentences if the model came up short.
  if (capabilities.length < 3 && input.notes) {
    for (const s of splitSentences(input.notes)) {
      if (capabilities.length >= 3) break;
      if (capabilities.some((c) => c.statement === s)) continue;
      capabilities.push({ id: `${runId}-cap-${capabilities.length + 1}`, statement: s, sourceUrls: [], source: "intake", inferred: false, confidence: 0.7 });
    }
  }

  const competitors: Competitor[] = draft.competitors
    .filter((c) => c.name.trim())
    .map((c) => {
      const sourceUrls = keepSourced(c.sourceUrls, allowed);
      const url = c.url && isUrl(c.url) ? c.url : undefined;
      return {
        id: `${runId}-comp-${slug(c.name)}`,
        name: c.name.trim(),
        ...(url ? { url } : {}),
        kind: c.kind,
        positioning: c.positioning,
        pricingSummary: sourceUrls.length ? c.pricingSummary : null,
        ourDifferentiator: c.ourDifferentiator,
        sourceUrls,
      };
    })
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)
    .sort((a, b) => Number(b.sourceUrls.length > 0) - Number(a.sourceUrls.length > 0))
    .slice(0, 6);

  const statedTargetUsers = draft.statedTargetUsers
    .filter((t) => t.description.trim())
    .map((t) => ({ description: t.description.trim(), sourceUrls: keepSourced(t.sourceUrls, allowed), fromIntake: t.fromIntake }))
    .filter((t) => t.sourceUrls.length > 0 || (t.fromIntake && Boolean(input.notes || input.targetUsers)))
    .map(({ description, sourceUrls }) => ({ description, sourceUrls }));
  if (statedTargetUsers.length === 0 && input.targetUsers) statedTargetUsers.push({ description: input.targetUsers, sourceUrls: [] });
  // Still nothing: keep the model's reading rather than hand Swarm no known segments.
  if (statedTargetUsers.length === 0) {
    for (const t of draft.statedTargetUsers.slice(0, 2)) if (t.description.trim()) statedTargetUsers.push({ description: t.description.trim(), sourceUrls: [] });
  }

  const pricingUrls = keepSourced(draft.pricing.sourceUrls, allowed);
  return {
    name: draft.name.trim(),
    url: opts.url,
    profileMode: mode,
    oneLiner: draft.oneLiner,
    category: draft.category,
    capabilities,
    integrations: draft.integrations,
    pricing: { summary: pricingUrls.length || input.pricingNotes || mode === "intake_notes" ? draft.pricing.summary : null, sourceUrls: pricingUrls },
    statedTargetUsers,
    proofPoints: draft.proofPoints.map((p) => ({ claim: p.claim, vendorReported: p.vendorReported, sourceUrls: keepSourced(p.sourceUrls, allowed) })),
    competitors,
    ...(input.notes ? { notesFromUser: input.notes } : {}),
  };
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter((s) => s.length > 8);
}

/** No-LLM fallback (missing gateway key): an intake-notes profile built from the notes alone. */
export function notesOnlyProfile(runId: string, input: SonarInput): CompanyProfile {
  const sentences = splitSentences(input.notes ?? "");
  while (sentences.length < 3) sentences.push(sentences[0] ?? "Developer tool described in the intake");
  let name = "Your company";
  if (input.url) {
    try {
      const host = new URL(input.url).hostname.replace(/^www\./, "");
      name = host.split(".")[0].replace(/^./, (c) => c.toUpperCase());
    } catch {}
  }
  return {
    name,
    url: input.url ?? null,
    profileMode: "intake_notes",
    oneLiner: sentences[0],
    category: "developer tool",
    capabilities: sentences.slice(0, 5).map((s, i) => ({ id: `${runId}-cap-${i + 1}`, statement: s, sourceUrls: [], source: "intake", confidence: 0.7, inferred: false })),
    integrations: [],
    pricing: { summary: input.pricingNotes ?? null, sourceUrls: [] },
    statedTargetUsers: input.targetUsers ? [{ description: input.targetUsers, sourceUrls: [] }] : [],
    proofPoints: [],
    competitors: [],
    ...(input.notes ? { notesFromUser: input.notes } : {}),
  };
}
