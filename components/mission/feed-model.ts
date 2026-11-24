import type { RunEvent } from "@/lib/contracts";
import type { LocalItem } from "./run-context";

/** SPEC §8 feed rendering: handoff cards, collapsed thinking, highlighted results, right-aligned human lines. */
export type FeedItem =
  | { kind: "handoff" | "result" | "action" | "warning" | "human" | "persona" | "chat"; key: string; e: RunEvent }
  | { kind: "thinking"; key: string; events: RunEvent[] }
  | { kind: "local"; key: string; item: LocalItem };

/** Telemetry and state ticks live in the header/footer, not the feed. */
const HIDDEN = new Set(["llm.usage", "retrieval.stats", "run.state_changed", "run.created"]);

export const isPersona = (e: RunEvent) => e.type === "swarm.persona_reacted";

/**
 * @param shownPersonas persona events allowed through so far (UI throttle ≤5/s); others are skipped, not queued,
 *   so the feed never lags behind the run.
 */
export function buildFeed(events: RunEvent[], local: LocalItem[], shownPersonas: ReadonlySet<number>): FeedItem[] {
  const out: FeedItem[] = [];
  let thinking: RunEvent[] = [];
  const flush = () => {
    if (!thinking.length) return;
    out.push({ kind: "thinking", key: `t-${thinking[0].seq}`, events: thinking });
    thinking = [];
  };
  const localByAfter = new Map<number, LocalItem[]>();
  for (const l of local) localByAfter.set(l.afterSeq, [...(localByAfter.get(l.afterSeq) ?? []), l]);
  const pushLocal = (seq: number) => {
    const ls = localByAfter.get(seq);
    if (!ls) return;
    flush();
    for (const item of ls) out.push({ kind: "local", key: `l-${item.id}`, item });
  };

  pushLocal(0);
  for (const e of events) {
    if (HIDDEN.has(e.type)) {
      pushLocal(e.seq);
      continue;
    }
    if (isPersona(e)) {
      if (shownPersonas.has(e.seq)) {
        flush();
        out.push({ kind: "persona", key: `e-${e.seq}`, e });
      }
    } else if (e.type === "helm.chat_reply") {
      flush();
      out.push({ kind: "chat", key: `e-${e.seq}`, e });
    } else if (e.level === "thinking") {
      thinking.push(e);
    } else {
      flush();
      const kind = e.level === "handoff" ? "handoff" : e.level === "result" ? "result" : e.level === "warning" ? "warning" : e.level === "human" ? "human" : "action";
      out.push({ kind, key: `e-${e.seq}`, e });
    }
    pushLocal(e.seq);
  }
  flush();
  return out;
}
