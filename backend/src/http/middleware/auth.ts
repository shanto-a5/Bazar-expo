/**
 * Authentication + authorisation middleware (M7-H).
 *
 * Identity always comes from the bearer token: the token is looked up, its user
 * is re-read from the datastore, and the request's `actor` is that user. Nothing
 * in `req.body` can influence who the caller is. Seller routes then resolve the
 * seller profile from the *user*, so a body or query `sellerId` is never
 * authoritative.
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import type { AuthService } from '../../services/auth.service';
import type { SellerService } from '../../services/seller.service';
import type { Role, UserEntity } from '../../domain/entities';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: UserEntity;
      bearerToken?: string;
    }
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

export function requireAuth(authService: AuthService) {
  return async function authGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const token = bearerToken(req);
      const { user, session } = await authService.authenticate(token);
      req.actor = user;
      req.bearerToken = session.token;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireSeller(sellerService: SellerService) {
  return async function sellerGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.actor) throw AppError.unauthorized('Sign in to continue.');
      await sellerService.sellerForUser(req.actor.id);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function actorOf(req: Request): UserEntity {
  if (!req.actor) throw AppError.unauthorized('Sign in to continue.');
  return req.actor;
}

/**
 * M8: role gate for privileged routes (seller approval).
 *
 * The role is read from the user the *token* resolved to, re-read from the
 * datastore on every request — never from a body field, a header or a query
 * parameter. That is what makes "a customer cannot approve themselves" a
 * property of the system rather than a rule a future endpoint might forget.
 */
export function requireRole(role: Role) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
      const actor = actorOf(req);
      if (!actor.roles.includes(role)) {
        throw AppError.forbidden('This action is restricted to platform staff.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
