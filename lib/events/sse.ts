import type { RunEvent } from "@/lib/contracts";
import { bus } from "./bus";

const HEARTBEAT_MS = 15_000;

export function formatSse(e: RunEvent): string {
  return `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
}

/**
 * SSE response for a run: replays history after `afterSeq` (Last-Event-ID), then live events.
 * No gaps / no duplicates: we subscribe first, buffer, then send history, then drain the buffer by seq.
 */
export function runEventStream(runId: string, afterSeq: number, signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSent = afterSeq;
      let ready = false;
      const buffer: RunEvent[] = [];
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const sendEvent = (e: RunEvent) => {
        if (e.seq <= lastSent) return;
        lastSent = e.seq;
        send(formatSse(e));
      };

      const unsub = bus.subscribe(runId, (e) => (ready ? sendEvent(e) : buffer.push(e)));
      const hb = setInterval(() => send(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsub();
        clearInterval(hb);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal?.addEventListener("abort", cleanup);

      send(`retry: 2000\n: connected ${runId}\n\n`);
      try {
        for (const e of await bus.history(runId, afterSeq)) sendEvent(e);
      } catch (err) {
        send(`: history error ${err instanceof Error ? err.message : "unknown"}\n\n`);
      }
      buffer.sort((x, y) => x.seq - y.seq).forEach(sendEvent);
      ready = true;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
