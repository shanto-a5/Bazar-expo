/**
 * Response envelope (M7-F).
 *
 * One success shape and one error shape for the whole API, so the client's API
 * adapter can parse responses without probing. Errors carry a machine code and
 * optional per-field messages; they never carry a stack trace.
 */
import type { Response } from 'express';
import type { ErrorCode, FieldError } from './errors';

export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldError[];
  };
  meta: ApiMeta;
}

export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { ok: true, data, meta: { requestId: res.locals.requestId ?? 'unknown' } };
  res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendData(res, data, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}

export function sendFailure(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  fields?: FieldError[],
): void {
  const body: ApiFailure = {
    ok: false,
    error: fields && fields.length > 0 ? { code, message, fields } : { code, message },
    meta: { requestId: res.locals.requestId ?? 'unknown' },
  };
  res.status(status).json(body);
}
