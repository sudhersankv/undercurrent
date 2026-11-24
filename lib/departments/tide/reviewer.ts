import type { Draft, DraftChannel, Lead, Noticed, StyleProfile } from "@/lib/contracts";
import { callStructured } from "@/lib/llm";
import { BANNED_PHRASES, CHANNEL_LIMITS, DISCLOSURE_LINE, ReviewLlmOut, reviewPrompt, type ReviewLlmOut as ReviewLlm } from "@/lib/llm/prompts/tide";
import { tryLlm } from "./llm";

/**
 * SPEC §5.5 Step D: reviewer. Eight checks:
 * 1 swap_token (deterministic)   2 swap_llm   3 banned_phrases   4 grounding (LLM)
 * 5 length                       6 disclosure 7 specificity (score; <60 is a warning, not a failure)
 * 8 voice (slang ∈ vocab, emoji only if they use it, LLM peer-vs-marketer)
 */

export type Review = Draft["review"];
export type Failure = Review["failures"][number];

/** Slang/abbreviations that need to be in the lead's own vocab ("shipped" is a plain verb, allowed). */
export const SLANG = ["ngl", "fwiw", "tbh", "lmk", "imo", "imho", "lgtm", "cooked", "afaik", "iirc", "idk", "rn", "fr", "smh", "lol", "lmao", "btw", "tl;dr", "tldr", "gonna", "wanna", "kinda", "lowkey", "highkey", "based", "goated", "bussin", "no cap", "vibe"];

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const STOP = new Set(["the", "and", "for", "with", "that", "this", "your", "from", "open", "issue", "issues", "repo", "about", "search", "readme", "github", "project", "notes", "app", "local", "commit", "commits", "slow", "past", "more", "than", "into", "uses", "using", "their", "they"]);

/** Tokens that only this lead's message would contain: repo name, issue numbers, file/flag/feature names. */
export function leadUniqueTokens(lead: Pick<Lead, "primaryRepo" | "displayName" | "handles">, noticed: Noticed[]): string[] {
  const out = new Set<string>();
  const add = (t: string | undefined | null) => {
    const v = (t ?? "").trim().toLowerCase();
    if (v.length >= 3 && !STOP.has(v)) out.add(v);
  };
  if (lead.primaryRepo) {
    const [owner, name] = lead.primaryRepo.split("/");
    add(name);
    add(owner);
    for (const part of (name ?? "").split(/[-_.]/)) if (part.length >= 5) add(part);
  }
  add(lead.handles.github);
  add(lead.handles.x?.replace(/^@/, ""));
  if (lead.displayName && !/\s/.test(lead.displayName.trim())) add(lead.displayName);
  for (const n of noticed) {
    const m = /\/(?:issues|pull|discussions)\/(\d+)/.exec(n.sourceUrl);
    if (m) out.add(`#${m[1]}`);
    for (const h of n.detail.match(/#\d+/g) ?? []) out.add(h);
    for (const b of n.detail.match(/`([^`]+)`/g) ?? []) add(b.replace(/`/g, ""));
    // numbers with units they stated ("~5k notes", "20 minutes", "320ms") are lead-specific too
    for (const u of n.detail.match(/\d+(?:\.\d+)?\s?(?:k|ms|s|mb|gb|minutes|min|notes|docs)\b/gi) ?? []) out.add(u.toLowerCase());
    // file names, flags, camelCase / snake_case identifiers, version tags
    for (const w of n.detail.match(/(?:--?[a-z][\w-]+|[\w-]+\.(?:ts|js|py|rs|go|md|json|toml|yaml|tsx|wasm)|[a-z]+[A-Z]\w*|\w+_\w+|v\d+\.\d+(?:\.\d+)?)/g) ?? []) add(w);
  }
  return [...out];
}

export function checkSwapToken(body: string, tokens: string[]): Failure | null {
  const b = body.toLowerCase();
  const hit = tokens.find((t) => (t.startsWith("#") ? new RegExp(`${t}\\b`).test(b) : b.includes(t)));
  return hit ? null : { check: "swap_token", reason: "No lead-specific detail (repo, issue number, file or feature name)." };
}

export function findBanned(text: string): string[] {
  const t = text.toLowerCase();
  return BANNED_PHRASES.filter((p) => new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(t));
}

export function checkBanned(subject: string | null, body: string): Failure | null {
  const hits = findBanned(`${subject ?? ""}\n${body}`);
  return hits.length ? { check: "banned_phrases", reason: `Banned: ${hits.join(", ")}` } : null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function checkLength(channel: DraftChannel, subject: string | null, body: string): Failure | null {
  const lim = CHANNEL_LIMITS[channel];
  if (lim.words && words(body) > lim.words) return { check: "length", reason: `${words(body)} words (max ${lim.words}).` };
  if (lim.chars && body.length > lim.chars) return { check: "length", reason: `${body.length} chars (max ${lim.chars}).` };
  if (lim.subjectWords && subject && words(subject) > lim.subjectWords) return { check: "length", reason: `Subject is ${words(subject)} words (max ${lim.subjectWords}).` };
  return null;
}

export function checkDisclosure(body: string, creditOffer: Draft["creditOffer"]): Failure | null {
  if (!creditOffer) return null;
  return body.toLowerCase().includes("mention the credits came from us") ? null : { check: "disclosure", reason: `Credit offer needs: "${DISCLOSURE_LINE}"` };
}

/** Slang tokens used in the text (whole-word, case-insensitive). */
export function slangIn(text: string): string[] {
  const t = text.toLowerCase();
  return SLANG.filter((s) => new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\;]/g, "\\$&")}($|[^a-z0-9])`).test(t));
}

export function checkCringe(body: string, style: StyleProfile | null): Failure | null {
  const vocab = new Set((style?.vocab ?? []).map((v) => v.toLowerCase()));
  const bad = slangIn(body).filter((s) => !vocab.has(s));
  if (bad.length) return { check: "voice", reason: `Slang not in their vocab: ${bad.join(", ")}` };
  if (EMOJI_RE.test(body) && !style?.usesEmoji) return { check: "voice", reason: "Emoji, but they don't use emoji." };
  return null;
}

/** Fallback specificity without an LLM: lead tokens, numbers with units, code-ish names. */
export function heuristicSpecificity(body: string, tokens: string[]): number {
  const b = body.toLowerCase();
  const tokenHits = tokens.filter((t) => b.includes(t)).length;
  const numbers = (body.match(/\d+(\.\d+)?\s?(ms|k|kb|mb|gb|%|docs|notes|x)\b/gi) ?? []).length;
  const code = (body.match(/`[^`]+`|#\d+/g) ?? []).length;
  const banned = findBanned(body).length;
  return Math.max(0, Math.min(100, 30 + tokenHits * 18 + numbers * 8 + code * 8 - banned * 20));
}

export interface ReviewInput {
  channel: DraftChannel;
  subject: string | null;
  body: string;
  noticed: Noticed[];
  creditOffer: Draft["creditOffer"];
  lead: Pick<Lead, "primaryRepo" | "displayName" | "handles">;
  style: StyleProfile | null;
  /** 2-line summary of another random lead (swap test). */
  otherLead?: string;
  runId?: string;
}

export interface ReviewOpts {
  /** Replace the LLM checks (tests). Return null to skip them. */
  llmCheck?: (input: ReviewInput) => Promise<ReviewLlm | null>;
}

async function defaultLlmCheck(input: ReviewInput): Promise<ReviewLlm | null> {
  const p = reviewPrompt({ body: input.body, otherLead: input.otherLead ?? "a developer building a generic CRUD web app", noticed: input.noticed });
  return tryLlm("review", () => callStructured({ model: "fast", system: p.system, user: p.user, schema: ReviewLlmOut, runId: input.runId, dept: "tide", temperature: 0, applyAlias: false }));
}

export async function review(input: ReviewInput, opts: ReviewOpts = {}): Promise<Review> {
  const failures: Failure[] = [];
  const tokens = leadUniqueTokens(input.lead, input.noticed);
  const push = (f: Failure | null) => f && failures.push(f);

  push(checkSwapToken(input.body, tokens)); // 1
  push(checkBanned(input.subject, input.body)); // 3
  push(checkLength(input.channel, input.subject, input.body)); // 5
  push(checkDisclosure(input.body, input.creditOffer)); // 6
  push(checkCringe(input.body, input.style)); // 8 (deterministic)

  const llm = await (opts.llmCheck ?? defaultLlmCheck)(input);
  let specificity = heuristicSpecificity(input.body, tokens);
  if (llm) {
    if (llm.swappable) failures.push({ check: "swap_llm", reason: llm.swapReason || "Could be sent unchanged to another lead." }); // 2
    if (llm.ungrounded.length) failures.push({ check: "grounding", reason: `Ungrounded: ${llm.ungrounded.slice(0, 2).join(" | ")}`.slice(0, 300) }); // 4
    if (llm.voice === "marketer") failures.push({ check: "voice", reason: llm.voiceReason || "Reads like a marketer." }); // 8 (LLM)
    specificity = Math.round(llm.specificity); // 7
  }
  return { passed: failures.length === 0, specificity: Math.max(0, Math.min(100, specificity)), failures };
}
