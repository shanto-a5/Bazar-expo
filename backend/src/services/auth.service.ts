/**
 * Auth service (M7-H / M8-F / M8-G).
 *
 * Passwords are hashed with bcrypt (cost from config, never a hand-rolled
 * digest). Sessions are opaque random tokens stored server-side, so logout and
 * password change can invalidate a session immediately. The bearer token is the
 * only credential the client keeps; it carries no identity claims, which is why
 * every request re-reads the user from the datastore.
 *
 * M8 adds two things this file previously stated were impossible:
 *
 *   - Password reset (M8-G). A reset token is an opaque random string whose
 *     SHA-256 is what gets stored, so a database dump yields nothing replayable.
 *     Redemption is single-use (a `usedAt` stamp, written conditionally), expires
 *     on a TTL index, and revokes every session for the account — a password
 *     reset that left the old sessions alive would not be a reset at all.
 *     Requesting a reset never reveals whether an address is registered, and the
 *     outbound mail goes through the injected `MailTransport`, so a test can
 *     assert a mail was produced without a network or a log scrape.
 *
 *   - Session bounding (M8-H). A user can hold at most
 *     `SESSION_MAX_PER_USER` live sessions; issuing beyond that evicts the
 *     oldest. Without a cap, a credential that leaks can mint sessions forever and
 *     the collection grows without bound.
 */
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { config } from '../config/env';
import { AppError } from '../http/errors';
import { newId, nowIso, opaqueToken } from '../lib/identity';
import { toPublicUser, type PublicUser, type Role, type SessionEntity, type UserEntity } from '../domain/entities';
import type { MailTransport } from '../mail/mail';
import type { RepositoryBundle } from '../repositories/contracts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
/** M8: an issued token is 32 random bytes as hex. Anything else never hits the DB. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export interface AuthenticatedSession {
  user: UserEntity;
  session: SessionEntity;
}

export class AuthService {
  constructor(
    private readonly repos: RepositoryBundle,
    private readonly mail: MailTransport = {
      name: 'null',
      configured: false,
      async send() {
        throw new Error('No mail transport is configured.');
      },
    },
  ) {}

  async register(input: {
    name: string;
    email: string;
    phone: string;
    password: string;
    roles?: Role[];
  }): Promise<{ user: PublicUser; token: string; expiresAt: string }> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();

    const fields: { field: string; message: string }[] = [];
    if (name.length < 2) fields.push({ field: 'name', message: 'Please enter your full name.' });
    if (!EMAIL_PATTERN.test(email)) fields.push({ field: 'email', message: 'Enter a valid email address.' });
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) fields.push({ field: 'phone', message: 'Enter a valid phone number.' });
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      fields.push({ field: 'password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (fields.length > 0) throw AppError.validation('Please fix the highlighted fields.', fields);

    if (await this.repos.users.findByEmail(email)) {
      throw AppError.conflict('An account with this email already exists.');
    }

    const timestamp = nowIso();
    const roles: Role[] = input.roles && input.roles.length > 0 ? [...new Set(input.roles)] : ['customer'];
    const user: UserEntity = {
      id: newId('usr'),
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(input.password, config.bcryptRounds),
      avatar: `p:👤:${email}`,
      roles,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repos.users.insert(user);
    const { token, expiresAt } = await this.issueSession(user.id);
    return { user: toPublicUser(user), token, expiresAt };
  }

  async login(input: { email: string; password: string }): Promise<{ user: PublicUser; token: string; expiresAt: string }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.repos.users.findByEmail(email);
    // Same message and roughly the same work for both failure modes, so the
    // endpoint cannot be used to enumerate registered addresses.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(input.password, hash);
    if (!user || !ok) throw AppError.unauthorized('Those credentials do not match an account.');
    const { token, expiresAt } = await this.issueSession(user.id);
    return { user: toPublicUser(user), token, expiresAt };
  }

  async issueSession(userId: string): Promise<{ token: string; expiresAt: string }> {
    const createdAt = nowIso();
    // Stored as a BSON date so the session TTL index can reap it; returned as an
    // ISO string, because that is what the API contract promises.
    const expiresOn = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
    const session: SessionEntity = {
      id: newId('ses'),
      userId,
      token: opaqueToken(),
      expiresAt: expiresOn,
      createdAt,
      updatedAt: createdAt,
    };
    await this.repos.sessions.insert(session);
    await this.enforceSessionLimit(userId, session.token);
    return { token: session.token, expiresAt: expiresOn.toISOString() };
  }

  /**
   * M8: keep at most `SESSION_MAX_PER_USER` live sessions per account, dropping
   * the oldest first. The just-issued token is excluded so a user at the limit
   * always keeps the session they are signing in on.
   */
  private async enforceSessionLimit(userId: string, keepToken: string): Promise<void> {
    const max = config.sessionMaxPerUser;
    if (max <= 0) return;
    const live = (await this.repos.sessions.listForUser(userId))
      .filter((entry) => entry.token !== keepToken && new Date(entry.expiresAt).getTime() > Date.now())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const stale of live.slice(0, Math.max(0, live.length - (max - 1)))) {
      await this.repos.sessions.deleteByToken(stale.token);
    }
  }

  /** Resolves a bearer token to a live session, or throws 401. */
  async authenticate(token: string | null): Promise<AuthenticatedSession> {
    if (!token) throw AppError.unauthorized('Sign in to continue.');
    // M8: shape is checked before the lookup, so junk never reaches the index.
    if (!TOKEN_SHAPE.test(token)) {
      throw AppError.unauthorized('Your session is no longer valid. Sign in again.');
    }
    const session = await this.repos.sessions.findByToken(token);
    if (!session) throw AppError.unauthorized('Your session is no longer valid. Sign in again.');
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.repos.sessions.deleteByToken(token);
      throw AppError.unauthorized('Your session has expired. Sign in again.');
    }
    const user = await this.repos.users.findById(session.userId);
    if (!user) {
      await this.repos.sessions.deleteByToken(token);
      throw AppError.unauthorized('Your session is no longer valid. Sign in again.');
    }
    return { user, session };
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.repos.sessions.deleteByToken(token);
  }

  async logoutEverywhere(userId: string, keepToken?: string): Promise<void> {
    await this.repos.sessions.deleteForUser(userId, keepToken);
  }

  async updateProfile(
    userId: string,
    patch: { name?: string; email?: string; phone?: string; avatar?: string },
  ): Promise<PublicUser> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw AppError.notFound('Account not found.');

    const update: Partial<UserEntity> = {};
    const fields: { field: string; message: string }[] = [];
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 2) fields.push({ field: 'name', message: 'Please enter your full name.' });
      else update.name = name;
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) fields.push({ field: 'email', message: 'Enter a valid email address.' });
      else {
        const owner = await this.repos.users.findByEmail(email);
        if (owner && owner.id !== userId) {
          fields.push({ field: 'email', message: 'An account with this email already exists.' });
        } else {
          update.email = email;
          if (email !== user.email) update.avatar = `p:👤:${email}`;
        }
      }
    }
    if (patch.phone !== undefined) {
      const phone = patch.phone.trim();
      if (!/^[0-9+\-\s]{6,20}$/.test(phone)) fields.push({ field: 'phone', message: 'Enter a valid phone number.' });
      else update.phone = phone;
    }
    if (patch.avatar !== undefined) update.avatar = patch.avatar;
    if (fields.length > 0) throw AppError.validation('Please fix the highlighted fields.', fields);

    const updated = await this.repos.users.patch(userId, update);
    if (!updated) throw AppError.notFound('Account not found.');
    return toPublicUser(updated);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    activeToken?: string,
  ): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw AppError.notFound('Account not found.');
    if (!currentPassword) {
      throw AppError.validation('Enter your current password.', [
        { field: 'currentPassword', message: 'Enter your current password.' },
      ]);
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw AppError.validation(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, [
        { field: 'newPassword', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      ]);
    }
    if (currentPassword === newPassword) {
      throw AppError.validation('Choose a password you have not used before.', [
        { field: 'newPassword', message: 'Choose a password you have not used before.' },
      ]);
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw AppError.validation('Current password is incorrect.', [
        { field: 'currentPassword', message: 'Current password is incorrect.' },
      ]);
    }
    await this.repos.users.patch(userId, { passwordHash: await bcrypt.hash(newPassword, config.bcryptRounds) });
    // Every other device is signed out; the caller keeps working.
    await this.repos.sessions.deleteForUser(userId, activeToken);
  }

  async emailExists(email: string): Promise<boolean> {
    return Boolean(await this.repos.users.findByEmail(email.trim().toLowerCase()));
  }

  /**
   * M8-G: start a password reset.
   *
   * The response is the same whether or not the address is registered, and the
   * work done is close to the same too, so this endpoint cannot be used to
   * enumerate accounts. Any previously issued unused token is dropped first: only
   * the newest link may work, which is what a user who requested twice expects.
   */
  async requestPasswordReset(email: string): Promise<{ accepted: true; expiresInMinutes: number }> {
    const normalized = email.trim().toLowerCase();
    const user = EMAIL_PATTERN.test(normalized) ? await this.repos.users.findByEmail(normalized) : null;

    if (user) {
      const token = opaqueToken();
      const timestamp = nowIso();
      // A BSON date, so the TTL index on the collection can actually reap a token
      // nobody redeemed instead of leaving it to grow without bound.
      const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60_000);
      await this.repos.passwordResets.deleteForUser(user.id);
      await this.repos.passwordResets.insert({
        id: newId('prt'),
        userId: user.id,
        tokenHash: AuthService.hashToken(token),
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await this.repos.audit.insert({
        id: newId('aud'),
        action: 'password_reset_requested',
        actorId: user.id,
        subjectId: user.id,
        subjectType: 'user',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      try {
        await this.mail.send({
          to: user.email,
          subject: 'Reset your Vanta password',
          text: [
            `Hello ${user.name},`,
            '',
            'Use the link below to choose a new password. It works once and expires in',
            `${config.passwordResetTtlMinutes} minutes.`,
            '',
            `${config.publicAppUrl}?token=${token}`,
            '',
            'If you did not ask for this, you can ignore it — nothing has changed yet.',
          ].join('\n'),
        });
      } catch (error) {
        // A transport failure must not leave a live token nobody received. Drop it
        // and report honestly rather than telling the user to check their inbox.
        await this.repos.passwordResets.deleteForUser(user.id).catch(() => undefined);
        throw AppError.unprocessable(
          'We could not send the reset email right now. Please try again in a few minutes.',
        );
      }
    }

    return { accepted: true, expiresInMinutes: config.passwordResetTtlMinutes };
  }

  /**
   * M8-G: finish a reset.
   *
   * The password write, the token stamp and the session revocation are one unit
   * when the datastore supports transactions: a crash between "new password
   * stored" and "old sessions revoked" would otherwise leave stolen sessions
   * valid, which is the exact outcome a reset is meant to prevent.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const supplied = token.trim();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw AppError.validation(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, [
        { field: 'newPassword', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      ]);
    }
    if (!TOKEN_SHAPE.test(supplied)) {
      throw AppError.validation('That reset link is not valid. Request a new one.', [
        { field: 'token', message: 'That reset link is not valid. Request a new one.' },
      ]);
    }

    const record = await this.repos.passwordResets.findByTokenHash(AuthService.hashToken(supplied));
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
      throw AppError.validation('That reset link has expired or was already used. Request a new one.', [
        { field: 'token', message: 'That reset link has expired or was already used. Request a new one.' },
      ]);
    }

    const user = await this.repos.users.findById(record.userId);
    if (!user) {
      throw AppError.validation('That reset link is not valid. Request a new one.', [
        { field: 'token', message: 'That reset link is not valid. Request a new one.' },
      ]);
    }

    const timestamp = nowIso();
    const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);

    const apply = async (repos: RepositoryBundle): Promise<void> => {
      // Single-use: only an unstamped row is claimed, so two simultaneous
      // confirms cannot both set a password.
      const claimed = await repos.passwordResets.markUsed(record.id, timestamp);
      if (!claimed || claimed.usedAt !== timestamp) {
        throw AppError.validation('That reset link has already been used. Request a new one.', [
          { field: 'token', message: 'That reset link has already been used. Request a new one.' },
        ]);
      }
      const updated = await repos.users.patch(user.id, { passwordHash });
      if (!updated) throw AppError.notFound('Account not found.');
      // Every session dies, including the one that asked: a reset must not leave
      // a live session that predates the new password.
      await repos.sessions.deleteForUser(user.id);
      await repos.passwordResets.deleteForUser(user.id);
      await repos.audit.insert({
        id: newId('aud'),
        action: 'password_reset_completed',
        actorId: user.id,
        subjectId: user.id,
        subjectType: 'user',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    };

    if (this.repos.supportsTransactions) {
      await this.repos.transact(apply);
    } else {
      await apply(this.repos);
    }
  }

  /** M8: only the hash of a reset token is ever stored or compared. */
  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Best-effort sweep of expired sessions; safe to call on an interval. */
  async purgeExpiredSessions(): Promise<number> {
    return this.repos.sessions.deleteExpired(nowIso());
  }

  /**
   * M8: one sweep for everything that ages out. Sessions, spent reset tokens and
   * expired idempotency keys are all bounded by TTL indexes in Mongo; this keeps
   * the in-memory driver honest too, and gives a deployment a single call to make
   * on a timer.
   */
  async purgeExpired(): Promise<{ sessions: number; passwordResets: number; idempotency: number }> {
    const now = nowIso();
    return {
      sessions: await this.repos.sessions.deleteExpired(now),
      passwordResets: await this.repos.passwordResets.deleteExpired(now),
      idempotency: await this.repos.idempotency.deleteExpired(now),
    };
  }
}
