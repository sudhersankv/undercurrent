import { embedMany } from "ai";
import { neon } from "@neon/ai-sdk-provider";
import { hasGateway } from "@/lib/llm/models";

/**
 * Embeddings for the in-memory fallback.
 *   1. Neon AI Gateway `qwen3-embedding-0-6b` (AMENDMENTS: LLM) when a gateway token exists.
 *   2. Otherwise (or if the gateway errors) a deterministic hashed bag-of-words vector,
 *      so the fallback index still works fully offline.
 * Vectors are L2-normalized, so cosine = dot product.
 */
export const GATEWAY_EMBED_MODEL = "qwen3-embedding-0-6b";
const GATEWAY_BATCH = 150; // NEON_MAX_EMBEDDINGS_PER_CALL
export const HASH_DIM = 512;

export type EmbedSource = "gateway" | "hash";
export interface Embedder {
  /** Stable id: vectors from different embedders are never compared. */
  id: EmbedSource;
  embed(texts: string[]): Promise<number[][]>;
}

const STOP = new Set(
  "the and for are but not you all any can had her was one our out has his how its may new now see two who did get let put say she too use with that this from they have been were what when your will into than then them some more also just only over very about which their there would could should these those other after being where while each most such".split(
    " ",
  ),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Light stemming so "embeddings" ~ "embedding", "indexing" ~ "index". */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** FNV-1a 32-bit. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n ? v.map((x) => x / n) : v;
}

/** Deterministic hashed bag-of-words (unigrams + bigrams, signed hashing, sublinear tf). */
export function hashEmbed(text: string, dim = HASH_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const toks = tokenize(text).map(stem);
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (let i = 0; i + 1 < toks.length; i++) {
    const b = `${toks[i]}_${toks[i + 1]}`;
    tf.set(b, (tf.get(b) ?? 0) + 0.5);
  }
  for (const [f, w] of tf) {
    const h = fnv(f);
    const sign = h & 0x80000000 ? -1 : 1;
    v[h % dim] += sign * (1 + Math.log(w + 1));
  }
  return normalize(v);
}

export const hashEmbedder: Embedder = {
  id: "hash",
  async embed(texts) {
    return texts.map((t) => hashEmbed(t));
  },
};

export const gatewayEmbedder: Embedder = {
  id: "gateway",
  async embed(texts) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += GATEWAY_BATCH) {
      const { embeddings } = await embedMany({
        model: neon.embeddingModel(GATEWAY_EMBED_MODEL),
        values: texts.slice(i, i + GATEWAY_BATCH),
        maxRetries: 1,
      });
      out.push(...embeddings.map((e) => normalize([...e])));
    }
    return out;
  },
};

/** Gateway if configured, else hashed BoW. */
export function defaultEmbedder(): Embedder {
  return hasGateway() ? gatewayEmbedder : hashEmbedder;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
