/**
 * Zod request validation (M7-F).
 *
 * Every body, query and param that reaches a service has been parsed by a schema
 * first, so a service never has to defend against a missing or wrongly-typed
 * field. Unknown keys are stripped rather than passed through, which keeps
 * unexpected client fields (an attempt to set `userId`, a price, a role) from
 * ever reaching a handler.
 */
import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { AppError, type FieldError } from '../errors';

export interface ValidatedRequest<B = unknown, Q = unknown, P = unknown> extends Request {
  validated: { body: B; query: Q; params: P };
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

export function validate<B = unknown, Q = unknown, P = unknown>(schemas: {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}) {
  return function validateRequest(req: Request, res: Response, next: NextFunction): void {
    try {
      const body = schemas.body ? schemas.body.parse(req.body ?? {}) : ({} as B);
      const query = schemas.query ? schemas.query.parse(req.query ?? {}) : ({} as Q);
      const params = schemas.params ? schemas.params.parse(req.params ?? {}) : ({} as P);
      (req as ValidatedRequest<B, Q, P>).validated = { body, query, params };
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fields = toFieldErrors(error);
        next(AppError.validation(fields[0]?.message ?? 'Check the submitted values.', fields));
        return;
      }
      next(error);
    }
  };
}

export function body<B extends ZodTypeAny>(schema: B) {
  return validate({ body: schema });
}

export const idParam = z.object({ id: z.string().min(1).max(120) });
export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.');
export const passwordField = z.string().min(8, 'Password must be at least 8 characters.');
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(120).optional(),
  sellerId: z.string().trim().max(120).optional(),
});
