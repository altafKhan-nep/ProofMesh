/**
 * Fixed-window rate limiting (P4).
 *
 * In-memory token counters keyed by client identity + route rule. Chosen over a
 * dependency because the semantics we need are small and explicit: a bounded
 * counter per (key, rule) that resets on a fixed window, returning Retry-After.
 *
 * Keys use the client IP plus, when known, the wallet — so one noisy script
 * cannot exhaust a shared NAT pool's budget for everyone, and one wallet cannot
 * spray challenges from many IPs.
 */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export type RateLimitRules = Record<string, RateLimitRule>;

export interface RateLimitDecision {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

/** Defaults are deliberately generous: they stop abuse, not real users. */
export const DEFAULT_RATE_LIMITS: RateLimitRules = {
  'POST /api/auth/challenge': { limit: 30, windowMs: 60_000 },
  'POST /api/auth/verify': { limit: 30, windowMs: 60_000 },
  'POST /api/auth/action-challenge': { limit: 60, windowMs: 60_000 },
  'POST /api/bind': { limit: 20, windowMs: 60_000 },
  'POST /api/analyze': { limit: 20, windowMs: 60_000 },
  'POST /api/invite': { limit: 30, windowMs: 60_000 },
  'POST /api/listings/:id/verified-link': { limit: 30, windowMs: 60_000 },
  'DELETE /api/listings/:id': { limit: 30, windowMs: 60_000 },
  'POST /api/search': { limit: 30, windowMs: 60_000 },
  'GET /api/stats': { limit: 60, windowMs: 60_000 },
  'POST /api/attest': { limit: 10, windowMs: 60_000 },
  'POST /api/reset': { limit: 10, windowMs: 60_000 }
};

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly rules: RateLimitRules = DEFAULT_RATE_LIMITS,
    private readonly now: () => number = Date.now
  ) {}

  ruleFor(method: string, route: string): RateLimitRule | undefined {
    return this.rules[`${method.toUpperCase()} ${route}`];
  }

  /** Consume one unit for `key` (ip and/or wallet). Unknown rules are allowed. */
  consume(key: string, rule: RateLimitRule | undefined): RateLimitDecision {
    if (!rule) return { ok: true, limit: 0, remaining: 0, retryAfterSec: 0 };
    const t = this.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + rule.windowMs });
      return { ok: true, limit: rule.limit, remaining: rule.limit - 1, retryAfterSec: 0 };
    }
    existing.count += 1;
    const ok = existing.count <= rule.limit;
    return {
      ok,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - existing.count),
      retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((existing.resetAt - t) / 1000))
    };
  }

  /** Drop expired buckets so a long-lived process does not leak memory. */
  sweep(): void {
    const t = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= t) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Build the limiter rules from env overrides, e.g. RATE_LIMIT_ANALYZE=5/60s. */
export function rateLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  base: RateLimitRules = DEFAULT_RATE_LIMITS
): RateLimitRules {
  const rules: RateLimitRules = { ...base };
  const parse = (spec: string): RateLimitRule | null => {
    const m = /^(\d+)\s*\/\s*(\d+)(s|m|h)?$/i.exec(spec.trim());
    if (!m) return null;
    const unit = (m[3] ?? 'm').toLowerCase();
    const mult = unit === 's' ? 1000 : unit === 'h' ? 3_600_000 : 60_000;
    return { limit: Number(m[1]), windowMs: Number(m[2]) * mult };
  };
  const envMap: Record<string, string> = {
    RATE_LIMIT_CHALLENGE: 'POST /api/auth/challenge',
    RATE_LIMIT_VERIFY: 'POST /api/auth/verify',
    RATE_LIMIT_ACTION_CHALLENGE: 'POST /api/auth/action-challenge',
    RATE_LIMIT_BIND: 'POST /api/bind',
    RATE_LIMIT_ANALYZE: 'POST /api/analyze',
    RATE_LIMIT_SEARCH: 'POST /api/search',
    RATE_LIMIT_ATTEST: 'POST /api/attest',
    RATE_LIMIT_RESET: 'POST /api/reset'
  };
  for (const [key, rule] of Object.entries(envMap)) {
    const spec = env[key];
    if (!spec) continue;
    const parsed = parse(spec);
    if (parsed) rules[rule] = parsed;
  }
  if (env.RATE_LIMIT_DISABLED === '1') return {};
  return rules;
}
