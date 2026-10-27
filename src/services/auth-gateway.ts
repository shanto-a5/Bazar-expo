/**
 * Auth gateway.
 *
 * The single seam between the app and "who am I". Screens keep importing the one
 * `authService` object; this module wires it to the API-backed implementation.
 * The on-device simulator that used to live behind this seam was removed in M19,
 * so there is no runtime mode switch and no local fallback.
 *
 * The interface below is the contract the screens use, kept explicit so a screen
 * that calls a method the API does not implement fails at compile time rather
 * than at runtime.
 */
import type { Role, User } from '@/domain/types';
import { RemoteAuthService } from '@/api/remote-auth-service';

export { AuthError } from './auth-error';
export type { Role, User };

type RegisterInput = Parameters<RemoteAuthService['register']>[0];
type ProfilePatch = Parameters<RemoteAuthService['updateProfile']>[1];

export interface AuthGateway {
  register(input: RegisterInput): Promise<User>;
  /**
   * Frictionless onboarding: creates (or resumes) an account from a phone number
   * alone — the server mints the display name, email and password.
   */
  quickAccount(phone: string): Promise<User>;
  login(email: string, password: string): Promise<User>;
  createSession(userId: string): Promise<string>;
  getCurrentUser(): Promise<User | null>;
  logout(userId?: string): Promise<void>;
  /**
   * Signs every device out of the account, not just this one. The remote service
   * asks the server to revoke all of the account's sessions, then clears the
   * local token.
   */
  logoutEverywhere(userId?: string): Promise<void>;
  emailExists(email: string): Promise<boolean>;
  /**
   * M8 password recovery, as two steps because that is the only shape that works
   * without trusting the device: the request proves an address is reachable, and
   * the confirm proves possession of the mailed token.
   *
   * The request resolves for unknown addresses too, and the caller must render
   * the same confirmation either way — branching on the result would turn the
   * form into an account-enumeration oracle.
   */
  requestPasswordReset(email: string): Promise<{ localToken?: string }>;
  confirmPasswordReset(token: string, newPassword: string): Promise<void>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<User>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
  /**
   * Sets the first password on a quick account — the one-time path, with no
   * current password. The server refuses (409) an account that already has one.
   */
  setInitialPassword(userId: string, newPassword: string): Promise<void>;
  addRole(userId: string, role: Role): Promise<void>;
  installUnauthorizedHandler(): void;
}

const service = new RemoteAuthService();

/**
 * The one auth service the whole app uses: always the API-backed implementation.
 * `addRole` stays on the interface for call-site parity but always throws — roles
 * are granted server-side and the client cannot escalate.
 */
export function getAuthService(): AuthGateway {
  return service;
}

/**
 * Backwards-compatible alias so the existing `authService.foo(...)` call sites in
 * session-context, account and forgot-password keep working unchanged.
 */
export const authService: AuthGateway = {
  register: (input) => getAuthService().register(input),
  quickAccount: (phone) => getAuthService().quickAccount(phone),
  login: (email, password) => getAuthService().login(email, password),
  createSession: (userId) => getAuthService().createSession(userId),
  getCurrentUser: () => getAuthService().getCurrentUser(),
  logout: (userId) => getAuthService().logout(userId),
  logoutEverywhere: (userId) => getAuthService().logoutEverywhere(userId),
  emailExists: (email) => getAuthService().emailExists(email),
  requestPasswordReset: (email) => getAuthService().requestPasswordReset(email),
  confirmPasswordReset: (token, newPassword) => getAuthService().confirmPasswordReset(token, newPassword),
  updateProfile: (userId, patch) => getAuthService().updateProfile(userId, patch),
  changePassword: (userId, currentPassword, newPassword) =>
    getAuthService().changePassword(userId, currentPassword, newPassword),
  setInitialPassword: (userId, newPassword) => getAuthService().setInitialPassword(userId, newPassword),
  addRole: (userId, role) => getAuthService().addRole(userId, role),
  installUnauthorizedHandler: () => getAuthService().installUnauthorizedHandler(),
};

/** Test seam retained for callers that reset between specs. */
export function resetAuthServiceForTest(): void {
  // no-op: the gateway holds a single stateless API-backed service
}
