/**
 * Typed API errors (M7-F).
 *
 * A single error shape crosses the whole HTTP layer: services throw `AppError`,
 * the error middleware is the only place that formats a response body. Stack
 * traces and driver messages never leave the process.
 */
export type ErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal_error: 500,
};

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: FieldError[];

  constructor(code: ErrorCode, message: string, fields: FieldError[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = fields;
  }

  static validation(message = 'Some fields need attention.', fields: FieldError[] = []): AppError {
    return new AppError('validation_failed', message, fields);
  }

  static unauthorized(message = 'Sign in to continue.'): AppError {
    return new AppError('unauthorized', message);
  }

  static forbidden(message = 'You do not have access to this resource.'): AppError {
    return new AppError('forbidden', message);
  }

  static notFound(message = 'Not found.'): AppError {
    return new AppError('not_found', message);
  }

  static conflict(message: string): AppError {
    return new AppError('conflict', message);
  }

  static unprocessable(message: string, fields: FieldError[] = []): AppError {
    return new AppError('unprocessable', message, fields);
  }
}

/** Raised when the storage layer is unreachable or misconfigured. */
export class StorageUnavailableError extends AppError {
  constructor(message = 'The datastore is unavailable.') {
    super('internal_error', message);
    this.name = 'StorageUnavailableError';
  }
}
