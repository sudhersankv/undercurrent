import { z } from "zod";
import type { CompanyProfile, DraftChannel, Lead, Noticed, StyleProfile } from "@/lib/contracts";

// Tide prompts (SPEC §5.5). Typed builders + the structured-output schemas they pair with.

export const BANNED_PHRASES = [
  "amazing",
  "awesome project",
  "game-changer",
  "game changer",
  "revolutionize",
  "synergy",
  "i hope this email finds you well",
  "quick question",
  "circle back",
  "cutting-edge",
  "cutting edge",
  "leverage",
  "unlock",
  "seamless",
  "10x",
  "reach out",
  "empower",
  "solution",
];

export const DISCLOSURE_LINE = "If you end up sharing anything about it, just mention the credits came from us.";

const VOICE_RULES = `Voice rules (mirror, don't cosplay):
- Use the lead's casing, sentence length and emoji habits (none if they use none).
- Slang/abbreviations (ngl, fwiw, tbh, lmk, imo, lgtm) ONLY if they appear in the lead's vocab list, max one per message.
- Talk about the work like a peer: name the file, flag, issue number, tradeoff. Numbers with units.
- Short lines, one idea per line, no paragraph over 2 sentences. No greeting fluff, no sign-off speech.
- Plain verbs: shipped, built, broke, hit (a limit), swapped, benchmarked, ran into, works offline.
- Never use: ${BANNED_PHRASES.join(", ")}.
- Honest and a bit dry beats hype. "might be useful, might not" > "perfect for you".`;

// ---- Step B: what we noticed ----
export const NoticedOut = z.object({
  noticed: z
    .array(z.object({ detail: z.string(), sourceUrl: z.string(), relevanceToUs: z.string() }))
    .min(1)
    .max(4),
});

export function noticedPrompt(args: { company: CompanyProfile; lead: Lead; material: string; sourceUrls: string[] }) {
  return {
    system: `You read a developer's public work and list 2-4 specific, non-obvious details (a design choice, a workaround, an open issue, a recent change) that relate to what ${args.company.name} does. Reject generic items ("great project", "nice README"). Each item cites one of the given source URLs exactly. detail ≤200 chars, relevanceToUs ≤160 chars.`,
    user: `${args.company.name}: ${args.company.oneLiner}
Lead: ${args.lead.displayName}${args.lead.primaryRepo ? ` (repo ${args.lead.primaryRepo})` : ""}
Allowed source URLs:
${args.sourceUrls.map((u) => `- ${u}`).join("\n")}

Their work:
${args.material.slice(0, 12_000)}`,
  };
}

// ---- Step B2: voice ----
export const StyleOut = z.object({
  casing: z.enum(["lowercase", "sentence", "mixed"]),
  avgSentenceWords: z.number(),
  usesEmoji: z.boolean(),
  vocab: z.array(z.string()),
  formality: z.enum(["casual", "neutral", "formal"]),
});

export function stylePrompt(samples: string[]) {
  return {
    system:
      "You profile how a developer writes. Report casing, average sentence length in words, whether they use emoji, the slang/abbreviations they ACTUALLY use (e.g. ngl, lmk, fwiw, shipped; only tokens that literally appear in the samples), and formality.",
    user: samples.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  };
}

// ---- Step C: draft ----
export const DraftOut = z.object({ subject: z.string().nullable(), body: z.string() });

export const CHANNEL_LIMITS: Record<DraftChannel, { words?: number; chars?: number; subjectWords?: number }> = {
  email: { words: 120, subjectWords: 7 },
  followup_email: { words: 80, subjectWords: 7 },
  linkedin: { chars: 300 },
  x_dm: { chars: 280 },
  x_reply: { chars: 280 },
  x_post: { chars: 280 },
};

export function styleSummary(style: StyleProfile | null): string {
  if (!style || style.thinCorpus)
    return "Thin corpus: default dev register (lowercase-tolerant, short, concrete, NO slang, no emoji).";
  return `casing=${style.casing}, ~${Math.round(style.avgSentenceWords)} words/sentence, emoji=${style.usesEmoji ? "yes" : "no"}, formality=${style.formality}, vocab=[${style.vocab.join(", ")}]
Samples:
${style.samples
  .slice(0, 4)
  .map((s) => `- ${s.text}`)
  .join("\n")}`;
}

export function draftPrompt(args: {
  company: CompanyProfile;
  lead: Lead;
  channel: DraftChannel;
  noticed: Noticed[];
  style: StyleProfile | null;
  creditUsd: number | null;
  instruction?: string;
  previousFailures?: string[];
  referral?: { referrerName: string; fromLeadName: string; role?: string };
  followupOf?: string;
  replyTo?: { url: string; text: string } | null;
}) {
  const lim = CHANNEL_LIMITS[args.channel];
  const limit = lim.words ? `≤${lim.words} words, subject ≤${lim.subjectWords} words` : `≤${lim.chars} characters, subject null`;
  const spine =
    args.channel === "x_reply"
      ? `A PUBLIC reply on X to their post${args.replyTo ? `:\n"""${args.replyTo.text.slice(0, 500)}"""` : "."}
1. React to THEIR specific point first (the number, the tool, the failure they described). No "great post".
2. One line on how ${args.company.name} handles exactly that, concretely (no link dump, no pitch deck words).
3. Optional: offer to send credits. Never put the disclosure line in a public reply; no hashtags; no @mentions (the reply already addresses them).
≤280 characters total. Sound like a dev replying, not a brand account.`
      : args.channel === "x_dm"
        ? `A short X DM (≤280 characters).
1. One line proving we read their posts / work (specific).
2. One line on what ${args.company.name} does for that problem.
3. Soft optional ask. No greeting fluff.`
        : args.channel === "followup_email"
      ? "A short follow-up with ONE new piece of info (not 'bumping this'). Reference the earlier note in a few words."
      : `Structure:
1. One line proving we looked (a noticed item, specific).
2. One line bridging to THEIR problem, not our product.
3. One-two lines: what ${args.company.name} does for that problem, concretely.
${args.creditUsd ? `4. The gift: "$${args.creditUsd} in credits, no strings." then the exact line: "${DISCLOSURE_LINE}"` : "4. (no gift)"}
5. Soft optional ask ("if you try it and hit anything weird, I'd like to hear").`;
  return {
    system: `You write ${args.channel} outreach from a developer at ${args.company.name} to another developer. ${VOICE_RULES}
Channel: ${args.channel}, ${limit}. Do not add a footer (added at send time).`,
    user: `${args.company.name}: ${args.company.oneLiner}
Capabilities: ${args.company.capabilities
      .slice(0, 5)
      .map((c) => c.statement)
      .join("; ")}
Lead: ${args.lead.displayName}${args.lead.primaryRepo ? ` (${args.lead.primaryRepo})` : ""}
What we noticed:
${args.noticed.map((n) => `- ${n.detail} (${n.sourceUrl}); why it matters: ${n.relevanceToUs}`).join("\n")}
Their voice: ${styleSummary(args.style)}
${args.referral ? `Referral: ${args.referral.referrerName} (${args.referral.fromLeadName}) said this person handles ${args.referral.role ?? "this area"}. Open with that, e.g. "${args.referral.referrerName} mentioned you handle ${args.referral.role ?? "search"}".` : ""}
${args.followupOf ? `Earlier note:\n${args.followupOf}` : ""}
${args.channel.startsWith("x_") ? "Their voice above comes mostly from their X posts: mirror it (casing, length, emoji habits) without copying phrases." : ""}
${spine}
${args.instruction ? `Human instruction: ${args.instruction}` : ""}
${args.previousFailures?.length ? `The previous draft failed review: ${args.previousFailures.join("; ")}. Fix these.` : ""}`,
  };
}

// ---- Step D: reviewer LLM checks (2, 4, 7, 8) in one fast call ----
export const ReviewLlmOut = z.object({
  swappable: z.boolean(),
  swapReason: z.string(),
  ungrounded: z.array(z.string()),
  specificity: z.number().min(0).max(100),
  voice: z.enum(["peer", "marketer"]),
  voiceReason: z.string(),
});
export type ReviewLlmOut = z.infer<typeof ReviewLlmOut>;

export function reviewPrompt(args: { body: string; otherLead: string; noticed: Noticed[] }) {
  return {
    system: `You review cold outreach between developers. Answer four things:
1. swappable: could this exact message be sent unchanged to the OTHER lead described? (true = generic)
2. ungrounded: list sentences that make claims about the recipient's project that are NOT supported by the noticed facts.
3. specificity 0-100: how specific and non-obvious is it to this recipient?
4. voice: does it read like a peer dev ("peer") or a marketer trying to sound like one ("marketer")?`,
    user: `Message:
"""
${args.body}
"""
Noticed facts:
${args.noticed.map((n) => `- ${n.detail} (${n.sourceUrl})`).join("\n")}
Other lead: ${args.otherLead}`,
  };
}

// ---- Step F: campaign ----
export const CampaignOut = z.object({
  listenQueries: z.array(z.string()).min(1).max(8),
  hooks: z
    .array(z.object({ angle: z.string(), evidenceUrls: z.array(z.string()), vendorReportedNumbers: z.boolean() }))
    .min(1)
    .max(3),
  posts: z.array(z.string()).min(1).max(5), // 3-5 asked; topped up to 3 deterministically
  framing: z.string(),
});

export function campaignPrompt(args: { company: CompanyProfile; segmentName: string; pain: string; evidence: Array<{ title: string; url: string; quote: string; source?: string }> }) {
  return {
    system: `You plan an X (Twitter) listening + seeding campaign for ${args.company.name} in one market segment. Developers live on X; this is the core launch channel. We NEVER auto-post: every post is a draft a human opens and posts.
listenQueries: 4-8 short X search phrases (2-5 words) in the words devs actually use in the X posts below (pain phrasing, not product names).
Hooks must be tied to the given evidence URLs; set vendorReportedNumbers=true if a hook relies on a vendor-run benchmark.
posts: 3-5 posts, each ≤280 chars, dev voice (lowercase ok, concrete numbers/tools, no hashtags, no emoji), no hype words (${BANNED_PHRASES.slice(0, 8).join(", ")}...).
Framing: how to offer simulated credits ("build something, share if it's good").`,
    user: `${args.company.name}: ${args.company.oneLiner}
Segment: ${args.segmentName}. Pain: ${args.pain}
Evidence:
${args.evidence.map((e) => `- ${e.source === "x_post" ? "[X post] " : ""}${e.title} (${e.url}): "${e.quote}"`).join("\n")}`,
  };
}

// ---- chat ----
export const TideChatOut = z.object({
  action: z.enum(["rewrite_draft", "build_campaign", "none"]),
  draftId: z.string().nullable(),
  segmentId: z.string().nullable(),
  instruction: z.string().nullable(),
  reply: z.string(),
});

export function tideChatPrompt(message: string, snapshot: string) {
  return {
    system:
      "You are Undercurrent Tide (outreach). Pick one action: rewrite_draft (needs draftId + instruction), build_campaign (needs segmentId), or none (just answer). Keep reply ≤2 sentences.",
    user: `Run snapshot:\n${snapshot.slice(0, 4000)}\n\nUser: ${message}`,
  };
}
