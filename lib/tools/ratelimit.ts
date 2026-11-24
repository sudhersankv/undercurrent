/**
 * Token-bucket limiter (SPEC §5.3: GitHub search 30 req/min).
 * `await bucket.take()` resolves when a token is available. FIFO.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Max burst. */
    private capacity: number,
    /** Tokens added per `intervalMs`. */
    private refill: number,
    private intervalMs: number,
    private now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = this.now();
  }

  private top() {
    const t = this.now();
    const add = ((t - this.last) / this.intervalMs) * this.refill;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.last = t;
    }
  }

  /** Non-blocking: true if a token was taken. */
  tryTake(): boolean {
    this.top();
    if (this.tokens >= 1 && this.queue.length === 0) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  take(): Promise<void> {
    if (this.tryTake()) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.schedule();
    });
  }

  private schedule() {
    if (this.timer) return;
    this.top();
    const wait = this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.refill) * this.intervalMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.top();
      while (this.queue.length && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()!();
      }
      if (this.queue.length) this.schedule();
    }, wait);
  }

  /** Wrap an async fn so each call takes a token first. */
  wrap<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
    return async (...a: A) => {
      await this.take();
      return fn(...a);
    };
  }
}

const g = globalThis as unknown as { __ucBuckets?: Map<string, TokenBucket> };
const buckets: Map<string, TokenBucket> = (g.__ucBuckets ??= new Map());

/** Shared named bucket, e.g. `bucket("github-search", 30, 60_000)` = 30/min. */
export function bucket(name: string, perInterval: number, intervalMs: number): TokenBucket {
  let b = buckets.get(name);
  if (!b) {
    b = new TokenBucket(perInterval, perInterval, intervalMs);
    buckets.set(name, b);
  }
  return b;
}
