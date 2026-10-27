/**
 * Shared contract scenarios (M8).
 *
 * These are the guarantees VANTA makes regardless of which datastore is wired in.
 * The same list runs twice:
 *   - against the in-memory driver, in `src/tests/contract.test.ts` (fast, default)
 *   - against a real MongoDB replica set, in `src/tests-mongo/contract.test.ts`
 *
 * Anything only one driver can do — multi-document rollback, unique index
 * enforcement — lives in `src/tests-mongo` instead, because a scenario that cannot
 * hold on both drivers is a driver quirk, not a product guarantee.
 *
 * Each scenario gets a freshly seeded bundle and a recording mail transport, so no
 * scenario can depend on another's writes and the suites cannot leak state.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SEED, signIn, type Envelope, type TestHarness } from './harness';
import type { SellerProfileEntity, UserEntity } from '../domain/entities';
import type { MailMessage } from '../mail/mail';

export interface ScenarioContext {
  harness: TestHarness;
  /** Everything the transport was asked to deliver during this scenario. */
  mail: MailMessage[];
}

export interface Scenario {
  name: string;
  run(context: ScenarioContext): Promise<void>;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const checkout = (overrides: Record<string, unknown> = {}) => ({
  address: { ...SEED.address },
  paymentMethod: 'cod',
  ...overrides,
});

async function addToCart(harness: TestHarness, token: string, productId: string, quantity: number): Promise<void> {
  const result = await harness.request('/cart/items', {
    method: 'POST',
    token,
    body: JSON.stringify({ productId, quantity }),
  });
  assert.equal(result.status, 200, `adding ${productId} to the cart should succeed`);
}

async function stockOf(harness: TestHarness, productId: string): Promise<number> {
  const product = await harness.repos.products.findById(productId);
  return product?.stock ?? -1;
}

async function currentUserId(harness: TestHarness, token: string): Promise<string> {
  const me = await harness.request<Envelope<{ user: UserEntity }>>('/auth/me', { token });
  if (!me.body.data) throw new Error('could not resolve the current user');
  return me.body.data.user.id;
}

/** A distinct email per scenario, so a shared-uniqueness bug cannot pass silently. */
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}.${emailCounter}@vanta.test`;
}

const APPLICANT_PASSWORD = 'Applic4ntPass!';

async function registerCustomer(harness: TestHarness, email: string): Promise<UserEntity> {
  const result = await harness.request<Envelope<{ user: UserEntity }>>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Person', email, phone: '+8801700000099', password: APPLICANT_PASSWORD }),
  });
  if (result.status !== 201) throw new Error(`register failed: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.data!.user as UserEntity;
}

async function applyToSell(
  harness: TestHarness,
  email: string,
): Promise<{ token: string; userId: string; sellerId: string; storeId: string }> {
  const user = await registerCustomer(harness, email);
  const token = await signIn(harness, email, APPLICANT_PASSWORD);
  const applied = await harness.request<Envelope<{ profile: SellerProfileEntity; store: { id: string } }>>('/seller/register', {
    method: 'POST',
    token,
    body: JSON.stringify({ ...SEED.sellerRegistration, email, storeName: `${email} Store` }),
  });
  if (applied.status !== 201) throw new Error(`seller application failed: ${applied.status} ${JSON.stringify(applied.body)}`);
  return { token, userId: user.id, sellerId: applied.body.data!.profile.id, storeId: applied.body.data!.store.id };
}

function extractToken(text: string): string {
  const match = /[A-Za-z0-9_-]{32,}/.exec(text);
  if (!match) throw new Error(`no reset token found in mail body: ${text.slice(0, 120)}`);
  return match[0];
}

export const scenarios: Scenario[] = [
  // ------------------------------------------------------------ idempotency
  {
    name: 'checkout: an identical retry with the same idempotency key returns the original order',
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      // The seed already ships this customer one order, so the assertion is a
      // delta: a replay must add nothing, whichever driver produced the baseline.
      const baseline = (await harness.repos.orders.listForCustomer(customerId)).length;
      await addToCart(harness, token, SEED.productActive, 2);
      const before = await stockOf(harness, SEED.productActive);
      const payload = { ...checkout(), idempotencyKey: 'retry-key-alpha' };

      const first = await harness.request<Envelope<{ order: { id: string; orderCode: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(first.status, 201);
      const second = await harness.request<Envelope<{ order: { id: string; orderCode: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });

      assert.equal(second.status, 201, 'a replay is a success, not a second order');
      assert.equal(second.body.data?.order.id, first.body.data?.order.id, 'both responses name the same order');
      assert.equal(second.body.data?.order.orderCode, first.body.data?.order.orderCode);
      assert.equal(await stockOf(harness, SEED.productActive), before - 2, 'stock moved exactly once across both attempts');
      assert.equal((await harness.repos.orders.listForCustomer(customerId)).length, baseline + 1, 'exactly one new order');
    },
  },
  {
    name: 'checkout: the same key with a different payload is refused as a conflict',
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      const baseline = (await harness.repos.orders.listForCustomer(customerId)).length;
      await addToCart(harness, token, SEED.productActive, 1);
      const first = await harness.request<Envelope<unknown>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...checkout(), idempotencyKey: 'reused-key' }),
      });
      assert.equal(first.status, 201);

      await addToCart(harness, token, SEED.productCheap, 1);
      const conflicting = await harness.request<Envelope<unknown>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...checkout({ voucherCode: SEED.voucherPlatform }), idempotencyKey: 'reused-key' }),
      });
      assert.equal(conflicting.status, 409, 'a changed payload under a spent key is a conflict, not a replay');
      assert.equal((await harness.repos.orders.listForCustomer(customerId)).length, baseline + 1, 'the conflict created nothing');
    },
  },
  {
    name: 'checkout: a failed attempt releases its key so a corrected retry can succeed',
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      const failed = await harness.request<Envelope<unknown>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...checkout(), idempotencyKey: 'retry-after-failure' }),
      });
      assert.equal(failed.status, 422, 'an empty cart cannot be checked out');

      await addToCart(harness, token, SEED.productCheap, 1);
      const retry = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...checkout(), idempotencyKey: 'retry-after-failure' }),
      });
      assert.equal(retry.status, 201, 'a released key is reusable');
    },
  },
  {
    name: "checkout: an idempotency key is scoped to its owner, so one customer cannot replay another's order",
    async run({ harness }) {
      const ayesha = await signIn(harness, SEED.customerEmail);
      const tanvir = await signIn(harness, SEED.otherCustomerEmail);
      await addToCart(harness, ayesha, SEED.productCheap, 1);
      await addToCart(harness, tanvir, SEED.productCheap, 1);

      const shared = 'per-customer-key';
      const first = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token: ayesha,
        body: JSON.stringify({ ...checkout(), idempotencyKey: shared }),
      });
      const second = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token: tanvir,
        body: JSON.stringify({ ...checkout(), idempotencyKey: shared }),
      });
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.notEqual(second.body.data?.order.id, first.body.data?.order.id, 'two customers, two distinct orders');
    },
  },
  {
    name: 'checkout: a submission interrupted after the order committed is recovered, not stranded',
    async run({ harness }) {
      // Reproduces the one window the happy path cannot: the transaction committed
      // the order, and the process died before it marked the key complete. Left
      // alone, the record stays `in_flight` for the whole TTL window and the
      // customer is permanently locked out of an order they already paid for.
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      await addToCart(harness, token, SEED.productActive, 1);
      const payload = { ...checkout(), idempotencyKey: 'crash-window' };
      const first = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(first.status, 201);
      const orderId = first.body.data!.order.id;

      // Rewind the record to exactly the state the crash would have left.
      const record = await harness.repos.idempotency.find('orders', customerId, 'crash-window');
      assert.ok(record, 'the claim exists');
      await harness.repos.idempotency.complete('orders', customerId, 'crash-window', {
        state: 'in_flight',
        resourceId: orderId,
      });

      const retry = await harness.request<Envelope<{ order: { id: string; orderCode: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(retry.status, 201, `the retry found the committed order, got ${retry.status}`);
      assert.equal(retry.body.data?.order.id, orderId, 'it is the order that was already placed');

      const healed = await harness.repos.idempotency.find('orders', customerId, 'crash-window');
      assert.equal(healed?.state, 'completed', 'the stranded key was completed on the way past');
      assert.equal(healed?.resourceId, orderId);
    },
  },
  {
    name: 'checkout: a submission that never reached the order is released once it is clearly dead',
    async run({ harness }) {
      // The other half of the same window: the claim is written, then the attempt
      // dies *before* the order. There is nothing to replay, so the key has to be
      // freed or it is unusable for the rest of the TTL window.
      //
      // The claim is produced by a real checkout and then rewound, because the
      // request fingerprint is an internal hash — hand-writing a record would
      // collide with it and this would end up testing the wrong refusal.
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      await addToCart(harness, token, SEED.productCheap, 1);
      const payload = { ...checkout(), idempotencyKey: 'orphan-claim' };
      const first = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(first.status, 201);

      // The state a crash before the commit would leave: a young-looking claim is
      // not assumed dead, so this one is dated well outside any plausible checkout.
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      await harness.repos.idempotency.complete('orders', customerId, 'orphan-claim', {
        state: 'in_flight',
        resourceId: 'ord_never_written',
      });
      const rewound = await harness.repos.idempotency.find('orders', customerId, 'orphan-claim');
      await harness.repos.idempotency.release('orders', customerId, 'orphan-claim');
      await harness.repos.idempotency.claim({ ...rewound!, createdAt: stale, updatedAt: stale });

      await addToCart(harness, token, SEED.productCheap, 1);
      const attempt = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(attempt.status, 409, 'a long-dead claim is reported, not silently retried forever');
      assert.equal(await harness.repos.idempotency.find('orders', customerId, 'orphan-claim'), null, 'and the key is free again');

      const retry = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(retry.status, 201, 'so the customer can actually check out');
    },
  },
  {
    name: 'checkout: the Idempotency-Key header is honoured',
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      await addToCart(harness, token, SEED.productActive, 1);
      const body = JSON.stringify(checkout());
      const headers = { 'idempotency-key': 'header-key' };
      const first = await harness.request<Envelope<{ order: { id: string } }>>('/orders', { method: 'POST', token, headers, body });
      const second = await harness.request<Envelope<{ order: { id: string } }>>('/orders', { method: 'POST', token, headers, body });
      assert.equal(first.status, 201);
      assert.equal(second.body.data?.order.id, first.body.data?.order.id);
    },
  },
  {
    name: "checkout: the client's money fields are discarded and the server price is authoritative",
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      await addToCart(harness, token, SEED.productActive, 1);
      const result = await harness.request<Envelope<{ order: { id: string; total: number; subtotal: number } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(checkout({ total: 1, subtotal: 1, shippingFee: 0, paymentStatus: 'paid', status: 'cancelled' })),
      });
      assert.equal(result.status, 201);
      const { order } = result.body.data!;
      assert.notEqual(order.total, 1, 'a submitted total is discarded');
      assert.notEqual(order.subtotal, 1);
      assert.ok(order.total > 0);
      const payment = (await harness.repos.payments.listForOrder(order.id))[0];
      assert.notEqual(payment?.status, 'paid', 'a client cannot mark itself paid');
    },
  },
  {
    name: 'checkout: a completed key keeps replaying after the cart has moved on',
    async run({ harness }) {
      // M8 keeps completed records past the "in-flight" window so a late retry still
      // replays. The TTL that eventually expires them is a time-based behaviour, so
      // it is covered by the TTL index test in the Mongo suite rather than here.
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      const baseline = (await harness.repos.orders.listForCustomer(customerId)).length;
      await addToCart(harness, token, SEED.productCheap, 1);
      const payload = { ...checkout(), idempotencyKey: 'durable-key' };
      const first = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      await addToCart(harness, token, SEED.productCheap, 1);
      const later = await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      assert.equal(first.status, 201);
      assert.equal(later.body.data?.order.id, first.body.data?.order.id, 'a later retry still replays');
      assert.equal((await harness.repos.orders.listForCustomer(customerId)).length, baseline + 1);
    },
  },

  // --------------------------------------------------------- password reset
  {
    name: 'expiring records come back from storage as real instants, not as empty objects',
    async run({ harness, mail }) {
      // The three entities whose expiry has to be enforced are read back on every
      // request, so a driver that mangles a `Date` on the way out is not cosmetic:
      // `new Date({})` is Invalid Date, every comparison against it is false, and an
      // expired session or reset token never looks expired.
      const token = await signIn(harness, SEED.customerEmail);
      const customerId = await currentUserId(harness, token);
      const session = await harness.repos.sessions.findByToken(token);
      assert.ok(session, 'the session was stored');
      assert.ok(session.expiresAt instanceof Date, `session expiry is a Date, got ${JSON.stringify(session.expiresAt)}`);

      await harness.request('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: SEED.customerEmail }),
      });
      const resetToken = extractToken(mail[mail.length - 1].text);
      const storedToken = await harness.repos.passwordResets.findByTokenHash(sha256(resetToken));
      assert.ok(storedToken, 'the reset token is stored');
      assert.ok(
        storedToken.expiresAt instanceof Date,
        `reset token expiry is a Date, got ${JSON.stringify(storedToken.expiresAt)}`,
      );

      await addToCart(harness, token, SEED.productCheap, 1);
      await harness.request<Envelope<{ order: { id: string } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...checkout(), idempotencyKey: 'date-roundtrip' }),
      });
      const record = await harness.repos.idempotency.find('orders', customerId, 'date-roundtrip');
      assert.ok(record, 'the idempotency record was stored');
      assert.ok(record.expiresAt instanceof Date, `idempotency expiry is a Date, got ${JSON.stringify(record.expiresAt)}`);
    },
  },
  {
    name: 'password reset: a request mails a link and stores only a hash of the token',
    async run({ harness, mail }) {
      const result = await harness.request<Envelope<unknown>>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: SEED.customerEmail }),
      });
      assert.equal(result.status, 200);
      assert.equal(mail.length, 1, 'exactly one reset mail');
      assert.equal(mail[0].to, SEED.customerEmail);

      const token = extractToken(mail[0].text);
      assert.ok(token.length >= 32, 'the token is long enough to be unguessable');
      const byHash = await harness.repos.passwordResets.findByTokenHash(sha256(token));
      assert.ok(byHash, 'the token is retrievable by its hash');
      const byPlaintext = await harness.repos.passwordResets.findByTokenHash(token);
      assert.equal(byPlaintext, null, 'the raw token is not the stored lookup value');
      assert.equal(byHash!.userId, (await currentUserId(harness, await signIn(harness, SEED.customerEmail))));
      assert.ok(byHash!.expiresAt, 'the token carries an expiry');
    },
  },
  {
    name: 'password reset: an unknown address gets the same answer as a known one',
    async run({ harness, mail }) {
      const unknown = await harness.request<Envelope<{ accepted?: boolean }>>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: uniqueEmail('nobody') }),
      });
      const known = await harness.request<Envelope<{ accepted?: boolean }>>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: SEED.customerEmail }),
      });
      assert.equal(unknown.status, known.status, 'the endpoint is not an account-existence oracle');
      assert.deepEqual(unknown.body.data, known.body.data);
      assert.equal(mail.length, 1, 'only the real account was mailed');
    },
  },
  {
    name: 'password reset: confirming swaps the password, revokes every session, and is single-use',
    async run({ harness, mail }) {
      const oldToken = await signIn(harness, SEED.customerEmail);
      const secondSession = await signIn(harness, SEED.customerEmail);
      await harness.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: SEED.customerEmail }) });
      const token = extractToken(mail[0].text);

      const confirmed = await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: 'N3wResetPass!' }),
      });
      assert.equal(confirmed.status, 200);

      const oldPassword = await harness.request<Envelope<unknown>>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: SEED.customerEmail, password: SEED.password }),
      });
      assert.equal(oldPassword.status, 401, 'the old password no longer works');
      assert.equal(
        (await harness.request<Envelope<{ token: string }>>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: SEED.customerEmail, password: 'N3wResetPass!' }),
        })).status,
        200,
      );

      for (const revoked of [oldToken, secondSession]) {
        assert.equal((await harness.request('/auth/me', { token: revoked })).status, 401, 'a reset revokes every session');
      }

      const replay = await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: 'An0therPass!' }),
      });
      assert.equal(replay.status, 422, 'a used token cannot be replayed');
      assert.equal(
        (await harness.request<Envelope<unknown>>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: SEED.customerEmail, password: 'An0therPass!' }),
        })).status,
        401,
        'the replay attempt did not change the password',
      );
    },
  },
  {
    name: 'password reset: a garbage or tampered token is rejected without touching the account',
    async run({ harness, mail }) {
      await harness.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: SEED.customerEmail }) });
      const real = extractToken(mail[0].text);
      const tampered = real.slice(0, -1) + (real.slice(-1) === 'a' ? 'b' : 'a');

      for (const candidate of ['not-a-real-token', tampered, `${real}extra`]) {
        const result = await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: candidate, newPassword: 'H4ckedPass!' }),
        });
        assert.equal(result.status, 422, `token "${candidate.slice(0, 12)}…" must not be accepted`);
      }
      assert.equal(
        (await harness.request<Envelope<unknown>>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: SEED.customerEmail, password: SEED.password }),
        })).status,
        200,
        'the original password still works',
      );
    },
  },
  {
    name: 'password reset: requesting twice invalidates the first token',
    async run({ harness, mail }) {
      await harness.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: SEED.customerEmail }) });
      const first = extractToken(mail[0].text);
      await harness.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: SEED.customerEmail }) });
      const second = extractToken(mail[1].text);
      assert.notEqual(first, second, 'each request mints a distinct token');

      const stale = await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: first, newPassword: 'St4lePass!' }),
      });
      assert.equal(stale.status, 422, 'only the newest outstanding token is honoured');
      assert.equal(
        (await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: second, newPassword: 'Fr3shPass!' }),
        })).status,
        200,
      );
    },
  },
  {
    name: 'password reset: a weak new password is refused by validation, not by the service',
    async run({ harness, mail }) {
      await harness.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: SEED.customerEmail }) });
      const token = extractToken(mail[0].text);
      const result = await harness.request<Envelope<unknown>>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: 'short' }),
      });
      assert.equal(result.status, 422, 'validation_failed is 422 app-wide');
      assert.equal(result.body.error?.fields?.[0].field, 'newPassword');
    },
  },

  // ------------------------------------------------------ session security
  {
    name: 'sessions: a malformed or absent bearer token is refused',
    async run({ harness }) {
      for (const bad of ['short', 'z'.repeat(64), 'not a token', '../../etc/passwd']) {
        assert.equal((await harness.request('/auth/me', { token: bad })).status, 401, `token "${bad}" is not a session`);
      }
      assert.equal((await harness.request('/auth/me')).status, 401, 'no token is not a session');
    },
  },
  {
    name: 'sessions: logout-all invalidates every session for that account only',
    async run({ harness }) {
      const a = await signIn(harness, SEED.customerEmail);
      const b = await signIn(harness, SEED.customerEmail);
      await harness.request('/auth/logout-all', { method: 'POST', token: a });
      assert.equal((await harness.request('/auth/me', { token: a })).status, 401);
      assert.equal((await harness.request('/auth/me', { token: b })).status, 401);
      const other = await signIn(harness, SEED.otherCustomerEmail);
      assert.equal((await harness.request('/auth/me', { token: other })).status, 200, 'another account is unaffected');
    },
  },

  // -------------------------------------------------------- seller approval
  {
    name: 'seller approval: registration leaves the applicant pending and the seller area closed',
    async run({ harness }) {
      const email = uniqueEmail('applicant');
      const { token, sellerId } = await applyToSell(harness, email);

      const profile = await harness.repos.sellers.findById(sellerId);
      assert.equal(profile?.status, 'pending', 'a new application is not approved on submission');
      const user = await harness.repos.users.findById(await currentUserId(harness, token));
      assert.equal(user?.roles.includes('seller'), false, 'the seller role is withheld until approval');
      assert.equal((await harness.request('/seller/dashboard', { token })).status, 403, 'the seller area stays closed');
      assert.equal((await harness.request('/seller/products', { token })).status, 403, 'every seller route stays closed');

      const status = await harness.request<Envelope<{ profile: SellerProfileEntity }>>('/seller/application', { token });
      assert.equal(status.status, 200, 'a pending applicant can still read their own status');
      assert.equal(status.body.data?.profile.status, 'pending');
      assert.equal((await harness.request('/seller/application')).status, 401, 'the status endpoint still needs a token');
    },
  },
  {
    name: 'seller approval: a customer cannot read the queue or approve anyone, least of all themselves',
    async run({ harness }) {
      const token = await signIn(harness, SEED.customerEmail);
      assert.equal((await harness.request('/admin/sellers?status=pending', { token })).status, 403, 'the queue is not customer-readable');
      assert.equal((await harness.request('/admin/sellers')).status, 401, 'the queue is never anonymous');

      const { token: applicantToken, sellerId } = await applyToSell(harness, uniqueEmail('selfapprove'));
      const selfApproval = await harness.request<Envelope<unknown>>(`/admin/sellers/${sellerId}/decision`, {
        method: 'POST',
        token: applicantToken,
        body: JSON.stringify({ decision: 'approve' }),
      });
      assert.equal(selfApproval.status, 403);
      assert.equal((await harness.repos.sellers.findById(sellerId))?.status, 'pending', 'the application is still pending');
    },
  },
  {
    name: 'seller approval: an approver activates the seller, audits the decision and notifies the applicant',
    async run({ harness }) {
      const email = uniqueEmail('approved');
      const { token, userId, sellerId, storeId } = await applyToSell(harness, email);
      const approverToken = await signIn(harness, SEED.approverEmail);

      const queue = await harness.request<Envelope<{ applications: SellerProfileEntity[] }>>('/admin/sellers?status=pending', {
        token: approverToken,
      });
      assert.equal(queue.status, 200);
      assert.ok(
        queue.body.data?.applications.some((application) => application.id === sellerId),
        'a new application appears in the pending queue',
      );

      const decided = await harness.request<Envelope<{ profile: SellerProfileEntity; audit: { action: string }[] }>>(
        `/admin/sellers/${sellerId}/decision`,
        { method: 'POST', token: approverToken, body: JSON.stringify({ decision: 'approve', note: 'Documents look good.' }) },
      );
      assert.equal(decided.status, 200);
      assert.equal(decided.body.data?.profile.status, 'active');
      assert.ok(decided.body.data?.audit.some((entry) => entry.action === 'seller_application_approved'));

      const approved = await harness.repos.users.findById(userId);
      assert.equal(approved?.roles.includes('seller'), true, 'approval grants the role');
      assert.equal((await harness.repos.stores.findById(storeId))?.status, 'active', 'the store activates with the seller');
      assert.equal((await harness.request('/seller/dashboard', { token })).status, 200, 'the seller area opens');
      assert.ok((await harness.repos.notifications.listForUser(userId)).length > 0, 'the applicant was notified');

      // Durable, not merely echoed: a fresh sign-in reads the same state back.
      const fresh = await signIn(harness, email, APPLICANT_PASSWORD);
      assert.equal((await harness.request('/seller/dashboard', { token: fresh })).status, 200);
    },
  },
  {
    name: 'seller approval: a rejection records the reason and keeps the seller area closed',
    async run({ harness }) {
      const email = uniqueEmail('rejected');
      const { token, userId, sellerId } = await applyToSell(harness, email);
      const approverToken = await signIn(harness, SEED.approverEmail);

      const rejected = await harness.request<Envelope<{ profile: SellerProfileEntity }>>(`/admin/sellers/${sellerId}/decision`, {
        method: 'POST',
        token: approverToken,
        body: JSON.stringify({ decision: 'reject', note: 'National ID could not be verified.' }),
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body.data?.profile.status, 'rejected');

      const profile = await harness.repos.sellers.findById(sellerId);
      assert.equal(profile?.reviewNote, 'National ID could not be verified.');
      assert.ok(profile?.reviewedAt, 'the decision is timestamped');
      assert.ok(profile?.reviewedBy, 'the decision names an approver');
      assert.equal((await harness.repos.users.findById(userId))?.roles.includes('seller'), false);
      assert.equal((await harness.request('/seller/dashboard', { token })).status, 403);
      const status = await harness.request<Envelope<{ profile: SellerProfileEntity }>>('/seller/application', { token });
      assert.equal(status.body.data?.profile.reviewNote, 'National ID could not be verified.', 'the applicant can see why');
    },
  },
  {
    name: 'seller approval: suspending an active seller closes the area again and keeps the audit trail',
    async run({ harness }) {
      const approverToken = await signIn(harness, SEED.approverEmail);
      const sellerToken = await signIn(harness, SEED.sellerEmail);
      assert.equal((await harness.request('/seller/dashboard', { token: sellerToken })).status, 200);

      const me = await harness.request<Envelope<{ user: UserEntity }>>('/auth/me', { token: sellerToken });
      const sellerId = (await harness.repos.sellers.findByUserId(me.body.data!.user.id))!.id;

      const suspended = await harness.request<Envelope<{ profile: SellerProfileEntity }>>(`/admin/sellers/${sellerId}/decision`, {
        method: 'POST',
        token: approverToken,
        body: JSON.stringify({ decision: 'suspend', note: 'Chargeback rate exceeded the threshold.' }),
      });
      assert.equal(suspended.status, 200);
      assert.equal(suspended.body.data?.profile.status, 'suspended');

      const reissued = await signIn(harness, SEED.sellerEmail);
      assert.equal((await harness.request('/seller/dashboard', { token: reissued })).status, 403, 'a fresh session is closed too');
      const history = await harness.request<Envelope<{ history: { action: string }[] }>>(`/admin/sellers/${sellerId}/history`, {
        token: approverToken,
      });
      assert.equal(history.status, 200);
      assert.ok(history.body.data!.history.some((entry) => entry.action === 'seller_suspended'));
    },
  },
  {
    name: 'seller approval: an unknown or already-decided application is refused',
    async run({ harness }) {
      const approverToken = await signIn(harness, SEED.approverEmail);
      const missing = await harness.request<Envelope<unknown>>('/admin/sellers/sel_does_not_exist/decision', {
        method: 'POST',
        token: approverToken,
        body: JSON.stringify({ decision: 'approve' }),
      });
      assert.equal(missing.status, 404);

      const sellerToken = await signIn(harness, SEED.sellerEmail);
      const me = await harness.request<Envelope<{ user: UserEntity }>>('/auth/me', { token: sellerToken });
      const activeSellerId = (await harness.repos.sellers.findByUserId(me.body.data!.user.id))!.id;
      const reapprove = await harness.request<Envelope<unknown>>(`/admin/sellers/${activeSellerId}/decision`, {
        method: 'POST',
        token: approverToken,
        body: JSON.stringify({ decision: 'approve' }),
      });
      assert.equal(reapprove.status, 409, 'an already-active seller is not re-approvable');
    },
  },
  {
    name: 'seller approval: a decision with an unknown field is refused instead of silently dropped',
    async run({ harness }) {
      const { sellerId } = await applyToSell(harness, uniqueEmail('strict'));
      const approverToken = await signIn(harness, SEED.approverEmail);
      const result = await harness.request<Envelope<unknown>>(`/admin/sellers/${sellerId}/decision`, {
        method: 'POST',
        token: approverToken,
        body: JSON.stringify({ decision: 'approve', status: 'active', roles: ['seller'] }),
      });
      assert.equal(result.status, 422, 'a client cannot smuggle a status or a role through the decision body');
      assert.equal((await harness.repos.sellers.findById(sellerId))?.status, 'pending');
    },
  },

  // ---------------------------------------------------------------- health
  {
    name: 'health: liveness is dependency-free and readiness reports named checks',
    async run({ harness }) {
      const live = await harness.request<Envelope<{ live: boolean; uptimeSeconds?: number }>>('/health/live');
      assert.equal(live.status, 200);
      assert.equal(live.body.data?.live, true);
      assert.equal(typeof live.body.data?.uptimeSeconds, 'number');

      const ready = await harness.request<Envelope<{ ready: boolean; checks: { name: string; ok: boolean }[] }>>('/health/ready');
      assert.equal(ready.status, 200);
      assert.equal(ready.body.data?.ready, true);
      const names = ready.body.data!.checks.map((check) => check.name);
      assert.ok(names.includes('database'), 'readiness proves the datastore rather than assuming it');
      for (const check of ready.body.data!.checks) {
        assert.equal(check.ok, true, `check ${check.name} should pass against a healthy bundle`);
      }
    },
  },
  {
    name: 'health: the reported transaction strategy matches what the driver can actually do',
    async run({ harness }) {
      const result = await harness.request<Envelope<{ transactions: { supported: boolean; strategy: string } }>>('/health');
      assert.equal(result.status, 200);
      const { supported, strategy } = result.body.data!.transactions;
      assert.equal(supported, harness.repos.supportsTransactions, 'health does not overstate the driver');
      assert.equal(strategy, supported ? 'multi-document' : 'compensating-writes');
    },
  },
];
