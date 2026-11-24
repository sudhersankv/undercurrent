import type { RetrievalStats } from "./types";

/** Median of our own measured timings (never a vendor benchmark). */
export function p50(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 100) / 100;
}

/** Rolling window of per-query timings (last 500). */
export class StatsRecorder {
  private timings: number[] = [];
  private total = 0;

  record(ms: number) {
    this.total += 1;
    this.timings.push(ms);
    if (this.timings.length > 500) this.timings.shift();
  }

  stats(backend: RetrievalStats["backend"]): RetrievalStats {
    return { backend, p50Ms: p50(this.timings), count: this.total };
  }

  reset() {
    this.timings = [];
    this.total = 0;
  }
}
