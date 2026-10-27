/**
 * Request identity (M7-F).
 *
 * Every response carries a request id so a client-side failure can be traced to a
 * server log line. The id comes from the client only when it looks like a safe
 * opaque token, otherwise the server mints one.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  res.locals.requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', res.locals.requestId as string);
  next();
}
