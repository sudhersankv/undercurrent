import type { RunEvent, RunState } from "@/lib/contracts";
import type { LocalItem } from "./run-context";

/** SPEC §8 feed rendering: stage groups, handoff cards, collapsed thinking, highlighted results, right-aligned human lines. */
export type FeedItem =
  | { kind: "handoff" | "result" | "action" | "warning" | "human" | "persona" | "chat" | "end"; key: string; e: RunEvent }
  | { kind: "thinking"; key: string; events: RunEvent[] }
  | { kind: "local"; key: string; item: LocalItem }
  | { kind: "stage"; key: string; state: RunState; at: string; count: number };

/** Telemetry ticks live in the header/footer, not the feed. State changes become stage headers. */
const HIDDEN = new Set(["llm.usage", "retrieval.stats", "run.created"]);
const END = new Set(["run.fake_done", "run.done"]);

export const isPersona = (e: RunEvent) => e.type === "swarm.persona_reacted";

/** Items that matter at a glance ("Key moments" filter). */
export function isKeyMoment(it: FeedItem): boolean {
  if (it.kind === "stage" || it.kind === "handoff" || it.kind === "human" || it.kind === "chat" || it.kind === "local" || it.kind === "warning" || it.kind === "end") return true;
  if (it.kind === "result") {
    const t = it.e.type;
    return t === "sounding.verdict" || t === "sonar.profile_ready" || t === "swarm.reliability" || t === "wake.classified" || t === "wake.referral_created" || t === "tide.sent" || t === "wake.calibration_updated";
  }
  return false;
}

/**
 * @param shownPersonas persona events allowed through so far (UI throttle ≤5/s); others are skipped, not queued,
 *   so the feed never lags behind the run.
 */
export function buildFeed(events: RunEvent[], local: LocalItem[], shownPersonas: ReadonlySet<number>): FeedItem[] {
  const out: FeedItem[] = [];
  let thinking: RunEvent[] = [];
  let lastStage: RunState | null = null;
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
    if (e.type === "run.state_changed") {
      const to = (e.payload as { to?: RunState }).to;
      if (to && to !== "INTAKE" && to !== lastStage) {
        flush();
        out.push({ kind: "stage", key: `s-${e.seq}`, state: to, at: e.at, count: 0 });
        lastStage = to;
      }
      pushLocal(e.seq);
      continue;
    }
    if (END.has(e.type)) {
      flush();
      out.push({ kind: "end", key: `e-${e.seq}`, e });
    } else if (isPersona(e)) {
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

  // stage headers show how many items they hold
  let head: Extract<FeedItem, { kind: "stage" }> | null = null;
  for (const it of out) {
    if (it.kind === "stage") head = it;
    else if (head && it.kind !== "local") head.count += it.kind === "thinking" ? it.events.length : 1;
  }
  return out;
}
