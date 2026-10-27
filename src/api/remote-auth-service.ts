/**
 * Remote auth service (M7-Q).
 *
 * Implements the same surface as the local `AuthService` so the session context,
 * account screen and forgot-password screen need no knowledge of which mode they
 * are running in. What changes is where the work happens:
 *
 *   local  — password hashing, session creation and profile edits run on-device
 *            against the local database.
 *   remote — the server hashes, authenticates and stores sessions. This class
 *            only persists the opaque bearer token it is handed and maps the
 *            server's public user onto the device `User` shape.
 *
 * Two security properties are preserved by construction:
 *
 *   1. The client never sees a password hash in remote mode. `User` requires the
 *      fields, so they are filled with empty strings and are never read: no
 *      verification happens here, the server does that.
 *   2. Ownership stays server-side. `updateProfile` and `changePassword` take a
 *      `userId` for signature compatibility, but remote mode never sends it — the
 *      server derives the actor from the bearer token and would reject any client
 *      supplied identifier.
 */
import type { Role, User } from '@/domain/types';
import { ApiError, getApiClient, onUnauthorized } from './api-client';
import type { ApiUser } from './vanta-api';
import { vantaApi } from './vanta-api';
import { getContainer } from '@/infrastructure/container';
import { AuthError } from '@/services/auth-error';
import type { SessionStorage } from '@/storage/storage-adapter';

/**
 * Maps the server's public user onto the device entity. `passwordHash` and
 * `passwordSalt` are intentionally empty: the server never sends them, and the
 * remote path never verifies passwords locally.
 */
function toDeviceUser(apiUser: ApiUser): User {
  return {
    id: apiUser.id,
    name: apiUser.name,
    email: apiUser.email,
    phone: apiUser.phone,
    passwordHash: '',
    passwordSalt: '',
    avatar: apiUser.avatar,
    hasPassword: apiUser.hasPassword,
    roles: [...apiUser.roles],
    createdAt: apiUser.createdAt,
    updatedAt: apiUser.updatedAt,
  };
}

/** Turns any thrown value into the AuthError the screens already handle. */
function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof ApiError) return new AuthError(error.message, error.field);
  if (error instanceof Error) return new AuthError(error.message);
  return new AuthError('Something went wrong. Try again.');
}

export class RemoteAuthService {
  private store(): SessionStorage {
    return getContainer().sessionStorage;
  }

  /**
   * Called once during remote boot. Registers the 401 hook so an expired or
   * revoked token clears the local copy and the UI returns to signed-out, rather
   * than retrying forever with a token the server will keep rejecting.
   */
  installUnauthorizedHandler(): void {
    onUnauthorized(() => this.clearToken());
  }

  async register(input: { name: string; email: string; phone: string; password: string }): Promise<User> {
    try {
      const result = await vantaApi.register({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        password: input.password,
      });
      getApiClient().setToken(result.token);
      await this.store().setToken(result.token);
      return toDeviceUser(result.user);
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /**
   * M14: frictionless onboarding. The server owns every credential except the
   * phone the customer supplies and starts the session itself, so this behaves
   * like `register` on the wire. Any stored token is sent along so the server
   * resumes that account rather than minting a duplicate for the same device.
   */
  async quickAccount(phone: string): Promise<User> {
    try {
      const result = await vantaApi.quickAccount({ phone: phone.trim() });
      getApiClient().setToken(result.token);
      await this.store().setToken(result.token);
      return toDeviceUser(result.user);
    } catch (error) {
      throw toAuthError(error);
    }
  }

  async login(email: string, password: string): Promise<User> {
    try {
      const result = await vantaApi.login({ email: email.trim().toLowerCase(), password });
      getApiClient().setToken(result.token);
      await this.store().setToken(result.token);
      return toDeviceUser(result.user);
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /**
   * No-op in remote mode: `/auth/login` and `/auth/register` already created the
   * server session and stored the token. The local implementation needs this call
   * because it has to mint the session itself, which is why the session context
   * calls both and both modes satisfy it.
   */
  async createSession(_userId: string): Promise<string> {
    const token = await this.store().getToken();
    if (!token) {
      throw new AuthError('You are signed in, but the session token was lost. Please sign in again.');
    }
    getApiClient().setToken(token);
    return token;
  }

  /**
   * Validates the stored token against the server on every boot. A token the
   * server does not recognise means signed out — the client never assumes a
   * stored token is still good.
   */
  async getCurrentUser(): Promise<User | null> {
    const token = await this.store().getToken();
    if (!token) return null;
    getApiClient().setToken(token);
    try {
      const { user } = await vantaApi.me();
      return toDeviceUser(user);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        await this.clearToken();
        return null;
      }
      // A network or server fault is NOT treated as "signed out": that would
      // silently discard a valid session and look like a logout.
      throw toAuthError(error);
    }
  }

  async logout(): Promise<void> {
    try {
      await vantaApi.logout();
    } catch (error) {
      // The local token must still be cleared when the server is unreachable,
      // otherwise the user is stuck in a half-signed-in state.
      if (!(error instanceof ApiError && (error.isUnauthorized || error.isRetryable))) {
        throw toAuthError(error);
      }
    } finally {
      await this.clearToken();
    }
  }

  async logoutEverywhere(): Promise<void> {
    try {
      await vantaApi.logoutEverywhere();
    } finally {
      await this.clearToken();
    }
  }

  /**
   * Not supported in remote mode.
   *
   * Answering this from the client would mean asking the server "does this address
   * have an account?", which is exactly the account-enumeration oracle the reset
   * request endpoint is built to avoid. The reset flow must not use it.
   */
  async emailExists(): Promise<boolean> {
    throw new AuthError('This cannot be checked from the app. Request a reset link instead.');
  }

  /** Kept for parity with the local service; the app uses the two-step flow below. */
  async resetPassword(): Promise<void> {
    throw new AuthError('Use the emailed reset link to choose a new password.');
  }

  /**
   * M8: ask the server to mail a reset link.
   *
   * The server answers identically for known and unknown addresses, and so does
   * this method: it resolves in both cases, so the screen can show one message
   * without learning whether the account exists.
   */
  async requestPasswordReset(email: string): Promise<{ localToken?: string }> {
    try {
      await vantaApi.requestPasswordReset({ email: email.trim() });
      return {};
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /**
   * M8: exchange the mailed token for a new password.
   *
   * The server is the only thing that can judge the token, so every failure here —
   * unknown, expired, already used — arrives as one message. Distinguishing them
   * for the user would leak whether a token ever existed.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new AuthError('Password must be at least 8 characters.', 'newPassword');
    }
    try {
      await vantaApi.confirmPasswordReset({ token: token.trim(), newPassword });
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /** `userId` is accepted for signature parity and deliberately not sent. */
  async updateProfile(
    _userId: string,
    patch: { name?: string; email?: string; phone?: string; avatar?: string },
  ): Promise<User> {
    try {
      const { user } = await vantaApi.updateProfile(patch);
      return toDeviceUser(user);
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /** `userId` is accepted for signature parity and deliberately not sent. */
  async changePassword(_userId: string, currentPassword: string, newPassword: string): Promise<void> {
    try {
      await vantaApi.changePassword({ currentPassword, newPassword });
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /**
   * First password on a quick account. `userId` is accepted for signature parity
   * and deliberately not sent — the server derives the actor from the bearer
   * token and refuses (409) an account that already has a password.
   */
  async setInitialPassword(_userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new AuthError('Password must be at least 8 characters.', 'newPassword');
    }
    try {
      await vantaApi.setInitialPassword({ newPassword });
    } catch (error) {
      throw toAuthError(error);
    }
  }

  /** Roles are assigned server-side; the client cannot grant itself a seller role. */
  async addRole(_userId: string, _role: Role): Promise<void> {
    throw new AuthError('Roles are granted by an administrator, not from the app.');
  }

  private async clearToken(): Promise<void> {
    getApiClient().setToken(null);
    await this.store().clearToken();
  }
}
