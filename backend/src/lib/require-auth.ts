import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./auth.js";

// Augment Express's Request type so `req.user` is recognized by
// TypeScript everywhere this middleware is used, instead of needing an
// `as any` cast at every route handler.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { userId: string; username: string };
    }
  }
}

/**
 * Express middleware: requires a valid `Authorization: Bearer <token>`
 * header. On success, attaches the decoded user to `req.user` and calls
 * `next()`. On failure, responds with 401 directly and does not call
 * `next()` — so a route handler behind this middleware can safely assume
 * `req.user` is always present.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header.", code: "UNAUTHENTICATED" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token. Please log in again.", code: "INVALID_TOKEN" });
    return;
  }

  req.user = payload;
  next();
}
