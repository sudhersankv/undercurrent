import { describe, expect, it } from "vitest";
import { EventBus, runEventStream } from "@/lib/events";
import { bus } from "@/lib/events";
import { LICHEN_ALIAS, type RunEvent } from "@/lib/contracts";
import { setRunAlias } from "@/lib/llm/alias";

describe("EventBus", () => {
  it("assigns monotonic per-run seq, fans out, keeps history", async () => {
    const b = new EventBus();
    const got: RunEvent[] = [];
    b.subscribe("A", (e) => got.push(e));
    b.emit("A", { dept: "sonar", type: "sonar.search", level: "thinking", message: "q1", payload: {} });
    b.emit("B", { dept: "sonar", type: "sonar.search", level: "thinking", message: "other", payload: {} });
    b.emit("A", { dept: "sonar", type: "sonar.search", level: "thinking", message: "q2", payload: {} });
    expect(got.map((e) => e.seq)).toEqual([1, 2]);
    expect((await b.history("A", 1)).map((e) => e.message)).toEqual(["q2"]);
    expect(b.lastSeq("B")).toBe(1);
  });

  it("aliases and clips messages", () => {
    const b = new EventBus();
    setRunAlias("AL", LICHEN_ALIAS);
    const e = b.emit("AL", { dept: "sonar", type: "x", level: "thinking", message: "Read Moss pricing at https://moss.dev/pricing", payload: {} });
    expect(e.message).toBe("Read Lichen pricing at https://moss.dev/pricing");
    const long = b.emit("AL", { dept: "sonar", type: "x", level: "thinking", message: "a".repeat(300), payload: {} });
    expect(long.message.length).toBe(200);
  });
});

async function readEvents(res: Response, count: number): Promise<RunEvent[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: RunEvent[] = [];
  while (out.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (data) out.push(JSON.parse(data.slice(6)));
    }
  }
  await reader.cancel();
  return out;
}

describe("SSE", () => {
  it("replays history after Last-Event-ID then streams live, without duplicates", async () => {
    const runId = `sse-${Date.now()}`;
    for (let i = 0; i < 5; i++) bus.emit(runId, { dept: "swarm", type: "t", level: "thinking", message: `m${i}`, payload: {} });
    const ac = new AbortController();
    const res = runEventStream(runId, 2, ac.signal);
    setTimeout(() => bus.emit(runId, { dept: "swarm", type: "t", level: "thinking", message: "live", payload: {} }), 20);
    const evs = await readEvents(res, 4);
    ac.abort();
    expect(evs.map((e) => e.seq)).toEqual([3, 4, 5, 6]);
    expect(evs[3].message).toBe("live");
  });
});
