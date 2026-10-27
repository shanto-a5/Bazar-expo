/**
 * Fixed-window rate limiter (M7-S).
 *
 * Deliberately in-process and dependency-free: enough to blunt credential
 * stuffing and runaway clients on a single node. Behind more than one instance
 * this would move to a shared store, which is called out in the runbook rather
 * than pretended to be solved.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import { sendFailure } from '../response';

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; scope: string }) {
  const buckets = new Map<string, Bucket>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = `${options.scope}:${req.ip ?? 'unknown'}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      if (buckets.size > 10_000) {
        for (const [entryKey, entry] of buckets) {
          if (entry.resetAt <= now) buckets.delete(entryKey);
        }
      }
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      res.setHeader('retry-after', Math.ceil((bucket.resetAt - now) / 1000));
      sendFailure(res, new AppError('rate_limited', 'Too many requests. Try again shortly.').status, 'rate_limited', 'Too many requests. Try again shortly.');
      return;
    }
    next();
  };
}
