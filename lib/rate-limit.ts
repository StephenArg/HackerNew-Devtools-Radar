import { sleep } from "@/lib/utils";

function msFromEnv(key: string, fallback: number): number {
  const value = parseInt(process.env[key] ?? String(fallback), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function rpmFromEnv(key: string, fallback: number): number {
  const value = parseInt(process.env[key] ?? String(fallback), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Minimum spacing derived from RPM: 10 RPM → 6s between calls. */
export function minIntervalFromRpm(rpm: number): number {
  return Math.ceil(60_000 / rpm);
}

/** Sliding-window rate limiter with optional minimum spacing between consecutive calls. */
export class RateLimiter {
  private timestamps: number[] = [];
  private lastAcquireAt = 0;

  constructor(
    private readonly maxPerMinute: number,
    private readonly minIntervalMs: number,
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);

    if (this.timestamps.length >= this.maxPerMinute) {
      const waitMs = 60_000 - (now - this.timestamps[0]) + 100;
      await sleep(waitMs);
      return this.acquire();
    }

    if (this.lastAcquireAt > 0 && this.minIntervalMs > 0) {
      const sinceLast = Date.now() - this.lastAcquireAt;
      if (sinceLast < this.minIntervalMs) {
        await sleep(this.minIntervalMs - sinceLast);
      }
    }

    this.lastAcquireAt = Date.now();
    this.timestamps.push(this.lastAcquireAt);
  }
}

const embeddingRpm = rpmFromEnv("OPENAI_EMBEDDING_RPM", 100);
const chatRpm = rpmFromEnv("OPENAI_CHAT_RPM", 10);

export const embeddingRateLimiter = new RateLimiter(
  embeddingRpm,
  msFromEnv(
    "OPENAI_EMBEDDING_MIN_INTERVAL_MS",
    minIntervalFromRpm(embeddingRpm),
  ),
);

export const chatRateLimiter = new RateLimiter(
  chatRpm,
  msFromEnv("OPENAI_CHAT_MIN_INTERVAL_MS", minIntervalFromRpm(chatRpm)),
);

export function getEmbeddingBatchSize(): number {
  return rpmFromEnv("OPENAI_EMBEDDING_BATCH_SIZE", 64);
}

/** Pause after embeddings before a chat call so RPM/TPM windows can recover. */
export async function pauseBeforeChat(): Promise<void> {
  const delayMs = msFromEnv(
    "OPENAI_EMBEDDING_TO_CHAT_DELAY_MS",
    minIntervalFromRpm(chatRpm),
  );
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

export function getOpenAIRetryDelayMs(error: unknown, attempt: number): number {
  if (error && typeof error === "object") {
    const err = error as { headers?: Record<string, string> };
    const retryAfter =
      err.headers?.["retry-after"] ??
      err.headers?.["x-ratelimit-reset-requests"];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!Number.isNaN(seconds)) {
        return Math.max(1000, Math.ceil(seconds * 1000));
      }
    }
  }
  return Math.min(60_000, 5000 * (attempt + 1));
}
