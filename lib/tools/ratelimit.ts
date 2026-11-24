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

/**
 * Strict sliding-window limiter: at most `limit` starts in any `windowMs` window
 * (a token bucket allows up to 2x at the window edge; GitHub search counts per minute).
 */
export class SlidingWindowLimiter {
  private starts: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  take(): Promise<void> {
    const next = this.chain.then(async () => {
      for (;;) {
        const t = this.now();
        while (this.starts.length && t - this.starts[0] >= this.windowMs) this.starts.shift();
        if (this.starts.length < this.limit) {
          this.starts.push(t);
          return;
        }
        await new Promise((r) => setTimeout(r, this.windowMs - (t - this.starts[0]) + 1));
      }
    });
    this.chain = next;
    return next;
  }

  wrap<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
    return async (...a: A) => {
      await this.take();
      return fn(...a);
    };
  }
}

const gw = globalThis as unknown as { __ucWindows?: Map<string, SlidingWindowLimiter> };
const windows: Map<string, SlidingWindowLimiter> = (gw.__ucWindows ??= new Map());

/** Shared named sliding-window limiter, e.g. `windowLimiter("github-search", 30, 60_000)`. */
export function windowLimiter(name: string, limit: number, windowMs: number): SlidingWindowLimiter {
  let w = windows.get(name);
  if (!w) {
    w = new SlidingWindowLimiter(limit, windowMs);
    windows.set(name, w);
  }
  return w;
}

/** Test hook: drop a named limiter so the next call builds a fresh one. */
export function resetLimiter(name: string) {
  windows.delete(name);
  buckets.delete(name);
}
