/**
 * Error middleware (M7-F).
 *
 * The only place an error becomes a response. `AppError`s keep their status and
 * machine code; anything else is logged server-side and answered with a flat 500
 * so a driver message, stack frame or connection string can never leak.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import { sendFailure } from '../response';

export function notFoundHandler(req: Request, res: Response): void {
  sendFailure(res, 404, 'not_found', `No route matches ${req.method} ${req.path}.`);
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  void next;
  const requestId = res.locals.requestId ?? 'unknown';
  if (res.headersSent) return;

  if (error instanceof AppError) {
    sendFailure(res, error.status, error.code, error.message, error.fields);
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    sendFailure(res, 400, 'unprocessable', 'The request body is not valid JSON.');
    return;
  }

  console.error(`[error] ${requestId} ${req.method} ${req.path}`, error);
  sendFailure(res, 500, 'internal_error', 'Something went wrong on our side. Please try again.');
}
