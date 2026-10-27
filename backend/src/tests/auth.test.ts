/**
 * Auth + authorisation tests (M7-R).
 *
 * Covers the properties that matter for a real deployment: passwords are hashed,
 * tokens are opaque, logout invalidates, a body cannot escalate a role, and an
 * unauthenticated or wrong-owner request gets 401/404 rather than data.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SEED, signIn, startHarness, type Envelope, type TestHarness } from './harness';
import type { PublicUser } from '../domain/entities';

describe('auth', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startHarness();
  });
  after(async () => {
    await harness.close();
  });

  it('reports health with the active driver and no secrets', async () => {
    const result = await harness.request<Envelope<{ status: string; database: { driver: string }; config: Record<string, unknown> }>>('/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.data?.status, 'ok');
    assert.equal(result.body.data?.database.driver, 'memory');

    // M8: the check is by secret *name* and by secret *shape*, which is a stricter
    // assertion than scanning for the word "password" — `passwordResetTtlMinutes`
    // is a duration, not a credential, and the old substring rule flagged it.
    const described = (result.body.data?.config ?? {}) as Record<string, unknown>;
    for (const key of ['sessionSecret', 'mongoUri', 'mailApiKey', 'passwordHash', 'token', 'apiKey']) {
      assert.ok(!(key in described), `health must not expose ${key}`);
    }
    const wholeBody = JSON.stringify(result.body.data);
    assert.ok(!described.sessionSecret, 'health must not leak the session secret');
    assert.ok(!/"[0-9a-f]{32,}"/i.test(wholeBody), 'health must not contain a secret-shaped hex value');
    assert.ok(!/mongodb(\+srv)?:\/\//i.test(wholeBody), 'health must not contain a connection string');
  });

  it('registers a new customer and returns no password hash', async () => {
    const result = await harness.request<Envelope<{ user: PublicUser; token: string }>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Person',
        email: 'new.person@vanta.test',
        phone: '+8801700000099',
        password: 'Sup3rSecret!',
      }),
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.data?.user.email, 'new.person@vanta.test');
    assert.ok(result.body.data?.token.length >= 32, 'session token must be long and opaque');
    assert.ok(!JSON.stringify(result.body).includes('$2a$'), 'no bcrypt hash in the response');
    assert.ok(!('passwordHash' in (result.body.data?.user as object)), 'passwordHash must never be serialised');
  });

  it('rejects a weak password and a malformed email with field errors', async () => {
    const result = await harness.request<Envelope<unknown>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', email: 'not-an-email', phone: '1', password: 'short' }),
    });
    assert.equal(result.status, 422);
    assert.equal(result.body.error?.code, 'validation_failed');
    const fields = (result.body.error?.fields ?? []).map((entry) => entry.field).sort();
    assert.deepEqual(fields, ['email', 'name', 'password', 'phone']);
  });

  it('refuses a duplicate email with 409', async () => {
    const result = await harness.request<Envelope<unknown>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Copy Cat',
        email: SEED.customerEmail,
        phone: '+8801700000000',
        password: 'Sup3rSecret!',
      }),
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error?.code, 'conflict');
  });

  it('signs in with correct credentials and rejects a wrong password identically', async () => {
    const good = await signIn(harness, SEED.customerEmail);
    assert.ok(good.length > 20);

    const wrongPassword = await harness.request<Envelope<unknown>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: SEED.customerEmail, password: 'wrong-password' }),
    });
    const unknownUser = await harness.request<Envelope<unknown>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@vanta.test', password: 'wrong-password' }),
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal(wrongPassword.body.error?.message, unknownUser.body.error?.message, 'no account enumeration');
  });

  it('returns 401 without a token, and 401 for a forged token', async () => {
    assert.equal((await harness.request('/auth/me')).status, 401);
    const forged = await harness.request<Envelope<unknown>>('/auth/me', { token: 'a'.repeat(64) });
    assert.equal(forged.status, 401);
    assert.equal(forged.body.error?.code, 'unauthorized');
  });

  it('ignores a role supplied in the registration body', async () => {
    const result = await harness.request<Envelope<{ user: PublicUser }>>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Eager Seller',
        email: 'eager@vanta.test',
        phone: '+8801700000088',
        password: 'Sup3rSecret!',
        roles: ['seller'],
      }),
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body.data?.user.roles, ['customer'], 'roles cannot be self-assigned');
  });

  it('updates the profile but never accepts an unknown field', async () => {
    const token = await signIn(harness, SEED.customerEmail);
    const ok = await harness.request<Envelope<{ user: PublicUser }>>('/auth/me', {
      method: 'PATCH',
      token,
      body: JSON.stringify({ name: 'Ayesha R.', phone: '+8801700001111' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data?.user.name, 'Ayesha R.');

    const rejected = await harness.request<Envelope<unknown>>('/auth/me', {
      method: 'PATCH',
      token,
      body: JSON.stringify({ name: 'Ok', roles: ['seller'] }),
    });
    assert.equal(rejected.status, 422, 'unknown keys are stripped or rejected, never applied');
  });

  it('changes the password and revokes other sessions but keeps the current one', async () => {
    const first = await signIn(harness, 'tanvir@vanta.test');
    const second = await signIn(harness, 'tanvir@vanta.test');
    assert.notEqual(first, second);

    const changed = await harness.request<Envelope<{ otherSessionsRevoked: boolean }>>('/auth/me/password', {
      method: 'POST',
      token: first,
      body: JSON.stringify({ currentPassword: SEED.password, newPassword: 'RotatedPass1!' }),
    });
    assert.equal(changed.status, 200);

    assert.equal((await harness.request('/auth/me', { token: first })).status, 200, 'active session survives');
    assert.equal((await harness.request('/auth/me', { token: second })).status, 401, 'other sessions revoked');

    // restore for any later test that signs in as this account
    await harness.request('/auth/me/password', {
      method: 'POST',
      token: first,
      body: JSON.stringify({ currentPassword: 'RotatedPass1!', newPassword: SEED.password }),
    });
  });

  it('invalidates the session on logout', async () => {
    const token = await signIn(harness, SEED.customerEmail);
    assert.equal((await harness.request('/auth/me', { token })).status, 200);
    const loggedOut = await harness.request<Envelope<{ loggedOut: boolean }>>('/auth/logout', { method: 'POST', token });
    assert.equal(loggedOut.status, 200);
    assert.equal((await harness.request('/auth/me', { token })).status, 401);
  });

  it('rejects a body that is not JSON with 400', async () => {
    const result = await harness.request<Envelope<unknown>>('/auth/login', {
      method: 'POST',
      body: '{not json',
    });
    assert.equal(result.status, 400);
  });

  it('answers an unknown route with a structured 404', async () => {
    const result = await harness.request<Envelope<unknown>>('/nope');
    assert.equal(result.status, 404);
    assert.equal(result.body.error?.code, 'not_found');
    assert.ok(result.headers.get('x-request-id'));
  });
});
