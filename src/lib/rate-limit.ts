/**
 * 进程内滑动窗口限流：够用、零依赖。
 * 单机部署直接生效；将来上多实例时换成 Redis 版即可（接口保持不变）。
 */

type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的次数 */
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < options.windowMs);

  if (bucket.hits.length >= options.max) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((options.windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // 简单的内存回收，避免长期运行无限增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - (v.hits.at(-1) ?? 0) > options.windowMs * 4) buckets.delete(k);
    }
  }

  return { allowed: true, remaining: options.max - bucket.hits.length, retryAfterSec: 0 };
}
