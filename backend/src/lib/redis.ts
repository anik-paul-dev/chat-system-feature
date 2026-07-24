import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// The Socket.IO Redis adapter needs two separate Redis connections: one
// dedicated to publishing, one dedicated to subscribing. A single Redis
// connection can't do both at once once it enters subscribe mode, so this
// is a hard requirement of how the adapter works, not a style choice.
export const pubClient = new Redis(REDIS_URL, {
  // Keep retrying instead of giving up — if Redis is briefly unavailable
  // (e.g. still starting up in Docker), the app should recover once it's
  // reachable rather than crash on the first failed connection.
  retryStrategy(attempt: number) {
    return Math.min(attempt * 200, 5000);
  },
});

export const subClient = pubClient.duplicate();

// A third, general-purpose client for anything that isn't specifically
// the Socket.IO adapter's pub/sub pair — currently used by the rate
// limiter, so rate-limit counters are shared across both server instances
// instead of each instance tracking its own separate counts.
export const redis = pubClient.duplicate();

pubClient.on("error", (err: Error) => console.error("[redis:pub] connection error:", err.message));
subClient.on("error", (err: Error) => console.error("[redis:sub] connection error:", err.message));
redis.on("error", (err: Error) => console.error("[redis:general] connection error:", err.message));