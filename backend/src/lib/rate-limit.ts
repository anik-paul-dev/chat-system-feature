import { redis } from "./redis.js";

// ---- Fixed-window rate limiter, backed by Redis ------------------------
//
// This is the same fixed-window (timestamp + counter) idea used in the
// booking project, moved into Redis instead of an in-process Map. That
// move matters here specifically because this app runs as two separate
// server instances behind a load balancer: a user's requests can land on
// either instance from one moment to the next. An in-memory counter would
// mean each instance enforces its own separate limit, effectively letting
// a user get double the intended rate by bouncing between instances.
// Redis is the one piece of shared state both instances already talk to,
// so it's the natural place for a limit that has to hold true no matter
// which instance answers the request.
//
// The counting logic itself is intentionally simple: one Redis key per
// user, holding a count, with a TTL equal to the window length. The key
// expires and disappears entirely once the window ends — Redis does that
// cleanup for us, no separate sweep job needed like the in-memory version.

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds?: number;
};

/**
 * Record a hit for `key` under a fixed window of `windowSeconds`, allowing
 * at most `limit` requests per window. Uses Redis INCR + EXPIRE so the
 * count and its lifetime are atomic from Redis's point of view — two
 * requests arriving at the same instant still get correctly counted,
 * because INCR is a single atomic operation in Redis itself.
 */
export async function hit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;

  // INCR both creates the key at 1 if it doesn't exist yet, and atomically
  // adds 1 if it does. There's no race between "check if it exists" and
  // "create/increment it" because this is one Redis command, not two.
  const count = await redis.incr(redisKey);

  if (count === 1) {
    // This is the first request in a brand new window: attach an
    // expiry so the key (and the count) disappears on its own once the
    // window ends, instead of needing a separate cleanup process.
    await redis.expire(redisKey, windowSeconds);
  }

  if (count > limit) {
    const ttl = await redis.ttl(redisKey);
    return {
      allowed: false,
      remaining: 0,
      limit,
      // ttl can be -1 if, in a rare race, the key exists with no expiry
      // set yet — fall back to the full window length rather than
      // reporting a nonsensical negative wait time.
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    limit,
  };
}
