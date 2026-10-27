/**
 * API v1 router (M7-G / M8-B).
 *
 * Endpoint surface, kept to the real core flows of this milestone:
 *   health · auth · catalog · cart · orders · seller · admin · meta
 *
 * M8 additions, all server-authorised:
 *   - `POST /auth/password-reset/*` — real reset with a hashed single-use token.
 *   - `GET  /seller/application` — the applicant's own status, readable while
 *     `pending` (the seller area itself correctly refuses until approved).
 *   - `/admin/sellers/*` — the approval queue, gated on the `seller_approver`
 *     role that no customer-facing route can grant.
 */
import { Router } from 'express';
import { z } from 'zod';
import { config, describeConfig, readinessChecks } from '../config/env';
import { actorOf, bearerToken, requireAuth, requireRole, requireSeller } from './middleware/auth';
import { createRateLimiter } from './middleware/rate-limit';
import { body, idParam, pageQuery, validate } from './middleware/validate';
import { sendCreated, sendData } from './response';
import { AppError } from './errors';
import { emailField, passwordField, type ValidatedRequest } from './middleware/validate';
import { paymentMethods } from '../services/payment.service';
import { describeMediaProviders } from '../services/media.service';
import { deliveryMethods } from '../../../shared/delivery';
import type { AppContext } from '../app-context';
import type { AddressEntity, DeliveryMethodId, PaymentMethod } from '../domain/entities';

const registerSchema = z.object({
  name: z.string().min(2, 'Please enter your full name.').max(120),
  email: emailField,
  phone: z.string().min(6).max(20),
  password: passwordField,
});

const loginSchema = z.object({ email: emailField, password: z.string().min(1, 'Enter your password.') });

const profileSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    email: emailField.optional(),
    phone: z.string().min(6).max(20).optional(),
    avatar: z.string().max(2048).optional(),
  })
  .strict();

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordField,
});

const cartAddSchema = z.object({
  productId: z.string().min(1, 'Choose a product.'),
  quantity: z.coerce.number().int().min(1).max(999).optional(),
  variantId: z.string().min(1).optional(),
});

const cartPatchSchema = z
  .object({
    quantity: z.coerce.number().int().min(1).max(999).optional(),
    selected: z.coerce.boolean().optional(),
  })
  .refine((value) => value.quantity !== undefined || value.selected !== undefined, {
    message: 'Nothing to update.',
  });

const addressSchema = z.object({
  id: z.string().optional(),
  label: z.string().max(60).optional().default('Home'),
  recipientName: z.string().min(2, 'Recipient name is required.').max(120),
  phone: z.string().min(6, 'Phone number is required.').max(20),
  division: z.string().min(2, 'Division is required.').max(60),
  district: z.string().min(2, 'District is required.').max(60),
  area: z.string().max(120).optional().default(''),
  addressLine: z.string().min(4, 'Address is required.').max(400),
  postalCode: z.string().max(12).optional().default(''),
  instructions: z.string().max(400).optional(),
  isDefault: z.boolean().optional().default(false),
});

const orderSchema = z.object({
  address: addressSchema,
  paymentMethod: z.enum(['cod', 'bkash', 'nagad', 'card']),
  deliveryMethod: z.enum(['standard', 'express']).optional(),
  voucherCode: z.string().trim().max(40).optional(),
  idempotencyKey: z.string().trim().max(80).optional(),
});

const cancelSchema = z.object({ reason: z.string().min(3, 'Tell the seller why you cancelled.').max(400) });

const statusSchema = z.object({
  status: z.enum(['draft', 'pending', 'active', 'paused', 'out_of_stock', 'archived']),
});

const stockSchema = z.object({
  quantity: z.coerce.number().int().refine((value) => value !== 0, 'Enter a non-zero quantity.'),
  variantId: z.string().min(1).optional(),
  reason: z.enum(['sale', 'restock', 'manual', 'cancellation', 'return']).optional(),
});

const cartQuery = z.object({ deliveryMethod: z.enum(['standard', 'express']).optional() });
const storeParam = z.object({ sellerOrStoreId: z.string().min(1).max(120) });

/**
 * M8: a reset request is a credential-adjacent endpoint, so it gets the same
 * per-IP limit as login rather than the looser write limit.
 */
const passwordResetRequestSchema = z.object({ email: emailField });
const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(10, 'That reset link is not valid.').max(200),
  newPassword: passwordField,
});

const applicationStatusQuery = z.object({ status: z.enum(['pending', 'active', 'rejected', 'suspended']).optional() });
const applicationDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend']),
    note: z.string().trim().max(400).optional(),
  })
  .strict();

const sellerRegistrationSchema = z
  .object({
    fullName: z.string().min(2, 'Enter your full name.').max(120),
    phone: z.string().min(6, 'Enter a contact number.').max(20),
    email: z.string().email('Enter a valid email address.').max(200),
    nationalId: z.string().min(4, 'Enter your national id.').max(60),
    sellerType: z.enum(['individual', 'business']),
    entityName: z.string().max(160).optional(),
    storeName: z.string().min(2, 'Name your store.').max(120),
    storeDescription: z.string().min(10, 'Describe your store in a sentence or two.').max(1000),
    storeLogo: z.string().max(400).optional(),
    storeBanner: z.string().max(400).optional(),
    shippingFee: z.coerce.number().min(0).max(5000).optional(),
    freeShippingThreshold: z.coerce.number().min(0).max(1000000).optional(),
    deliveryEstimateDays: z
      .object({ min: z.coerce.number().int().min(0).max(60), max: z.coerce.number().int().min(0).max(60) })
      .refine((value) => value.max >= value.min, { message: 'The latest estimate must not be before the earliest.' })
      .optional(),
    pickupDivision: z.string().min(2, 'Pickup division is required.').max(60),
    pickupDistrict: z.string().min(2, 'Pickup district is required.').max(60),
    pickupArea: z.string().max(120).optional(),
    pickupAddressLine: z.string().min(4, 'Pickup address is required.').max(400),
    returnDivision: z.string().min(2, 'Return division is required.').max(60),
    returnDistrict: z.string().min(2, 'Return district is required.').max(60),
    returnArea: z.string().max(120).optional(),
    returnAddressLine: z.string().min(4, 'Return address is required.').max(400),
    bankName: z.string().min(2, 'Bank name is required.').max(120),
    accountName: z.string().min(2, 'Account holder is required.').max(120),
    accountNumber: z.string().min(4, 'Account number is required.').max(60),
    branch: z.string().max(120).optional(),
    agreement: z
      .object({
        marketplaceTerms: z.literal(true, { message: 'Accept the marketplace terms.' }),
        sellerPolicies: z.literal(true, { message: 'Accept the seller policies.' }),
        productAuthenticity: z.literal(true, { message: 'Confirm your products are authentic.' }),
        fulfillmentResponsibility: z.literal(true, { message: 'Accept the fulfillment responsibility.' }),
      })
      .strict(),
  })
  .strict();

export function createApiRouter(context: AppContext): Router {
  const router = Router();
  const { auth, catalog, cart, orders, sellers } = context;
  const authGuard = requireAuth(auth);
  const sellerGuard = requireSeller(sellers);
  const credentialLimit = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    max: config.authRateLimitMax,
    scope: 'auth',
  });
  const writeLimit = createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax, scope: 'write' });
  /**
   * M8: password reset is rate-limited separately and more tightly than a normal
   * write, because it is the one endpoint that hands out a credential-adjacent
   * token to an unauthenticated caller.
   */
  const resetLimit = createRateLimiter({
    windowMs: config.rateLimitWindowMs,
    max: config.passwordResetRateLimitMax,
    scope: 'password-reset',
  });

  // ---------------------------------------------------------------- health
  // Health reports the bundle this app was built with, so an injected test bundle
  // and the connected production bundle are both described correctly.
  router.get('/health', async (_req, res) => {
    const database = await context.repos.ping();
    sendData(res, {
      status: database.ok ? 'ok' : 'degraded',
      service: 'vanta-api',
      version: '1.0.0',
      apiVersion: 'v1',
      database,
      // M8: the guarantee this deployment can actually offer, not the one the
      // code would prefer.
      transactions: {
        supported: context.repos.supportsTransactions,
        strategy: context.repos.supportsTransactions ? 'multi-document' : 'compensating-writes',
      },
      config: describeConfig(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /**
   * M8: liveness answers "is this process running?" and must not touch a
   * dependency — a database blip should never get the container killed. It is
   * deliberately synchronous and dependency-free.
   */
  router.get('/health/live', (_req, res) => {
    sendData(res, { live: true, uptimeSeconds: Math.round(process.uptime()) });
  });

  /**
   * M8: readiness answers "should this process receive traffic?", so it checks the
   * datastore for real and reports each individual check rather than one boolean.
   */
  router.get('/health/ready', async (_req, res) => {
    const database = await context.repos.ping();
    const readiness = readinessChecks(database);
    sendData(res, {
      ready: readiness.ok,
      database,
      transactions: {
        supported: context.repos.supportsTransactions,
        strategy: context.repos.supportsTransactions ? 'multi-document' : 'compensating-writes',
      },
      checks: readiness.checks,
    });
  });

  // ------------------------------------------------------------------ meta
  router.get('/meta/payment-methods', (_req, res) => {
    sendData(res, {
      methods: paymentMethods(),
      note: 'Only cash on delivery settles with the courier. Other methods are simulated locally and move no money.',
    });
  });

  router.get('/meta/delivery-methods', (_req, res) => {
    sendData(res, { methods: deliveryMethods() });
  });

  router.get('/meta/media-providers', (_req, res) => {
    sendData(res, describeMediaProviders());
  });

  // ------------------------------------------------------------------ auth
  router.post('/auth/register', credentialLimit, body(registerSchema), async (req, res) => {
    const { validated } = req as ValidatedRequest<z.infer<typeof registerSchema>>;
    sendCreated(res, await auth.register(validated.body));
  });

  router.post('/auth/login', credentialLimit, body(loginSchema), async (req, res) => {
    const { validated } = req as ValidatedRequest<z.infer<typeof loginSchema>>;
    sendData(res, await auth.login(validated.body));
  });

  router.get('/auth/me', authGuard, async (req, res) => {
    const actor = actorOf(req);
    sendData(res, { user: await auth.updateProfile(actor.id, {}) });
  });

  router.patch('/auth/me', authGuard, body(profileSchema), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof profileSchema>>;
    sendData(res, { user: await auth.updateProfile(actor.id, validated.body) });
  });

  router.post('/auth/me/password', authGuard, credentialLimit, body(passwordSchema), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof passwordSchema>>;
    await auth.changePassword(actor.id, validated.body.currentPassword, validated.body.newPassword, req.bearerToken);
    sendData(res, { changed: true, otherSessionsRevoked: true });
  });

  router.post('/auth/logout', authGuard, async (req, res) => {
    await auth.logout(bearerToken(req));
    sendData(res, { loggedOut: true });
  });

  router.post('/auth/logout-all', authGuard, async (req, res) => {
    const actor = actorOf(req);
    await auth.logoutEverywhere(actor.id);
    sendData(res, { loggedOutEverywhere: true });
  });

  // ------------------------------------------------- password reset (M8-G)
  // Unauthenticated by necessity — the caller has lost their password. Both
  // endpoints are rate-limited, and `request` answers identically for a known and
  // an unknown address so it cannot be used to enumerate accounts.
  router.post('/auth/password-reset/request', resetLimit, body(passwordResetRequestSchema), async (req, res) => {
    const { validated } = req as ValidatedRequest<z.infer<typeof passwordResetRequestSchema>>;
    sendData(res, await auth.requestPasswordReset(validated.body.email));
  });

  router.post('/auth/password-reset/confirm', resetLimit, body(passwordResetConfirmSchema), async (req, res) => {
    const { validated } = req as ValidatedRequest<z.infer<typeof passwordResetConfirmSchema>>;
    await auth.confirmPasswordReset(validated.body.token, validated.body.newPassword);
    sendData(res, { reset: true, sessionsRevoked: true });
  });

  // --------------------------------------------------------------- catalog
  router.get('/catalog/categories', async (_req, res) => {
    sendData(res, { categories: await catalog.listCategories() });
  });

  router.get('/catalog/products', validate({ query: pageQuery }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, z.infer<typeof pageQuery>>;
    sendData(res, await catalog.listProducts(validated.query));
  });

  router.get('/catalog/products/:id', validate({ params: idParam }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, await catalog.getProduct(validated.params.id));
  });

  router.get('/catalog/stores/:sellerOrStoreId', validate({ params: storeParam }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof storeParam>>;
    sendData(res, await catalog.getStore(validated.params.sellerOrStoreId));
  });

  router.get('/catalog/summary', async (_req, res) => {
    sendData(res, await catalog.summary());
  });

  // ------------------------------------------------------------------ cart
  router.get('/cart', authGuard, validate({ query: cartQuery }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, z.infer<typeof cartQuery>>;
    sendData(res, await cart.priceCart(actorOf(req).id, { deliveryMethod: validated.query.deliveryMethod }));
  });

  router.post('/cart/items', authGuard, writeLimit, body(cartAddSchema), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof cartAddSchema>>;
    sendData(res, await cart.addItem(actor.id, { ...validated.body, quantity: validated.body.quantity ?? 1 }));
  });

  router.patch('/cart/items/:id', authGuard, writeLimit, validate({ params: idParam, body: cartPatchSchema }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof cartPatchSchema>, unknown, z.infer<typeof idParam>>;
    sendData(res, await cart.patchItem(actor.id, validated.params.id, validated.body));
  });

  router.delete('/cart/items/:id', authGuard, writeLimit, validate({ params: idParam }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, await cart.removeItem(actor.id, validated.params.id));
  });

  router.delete('/cart/items', authGuard, writeLimit, async (req, res) => {
    sendData(res, await cart.clear(actorOf(req).id));
  });

  // ---------------------------------------------------------------- orders
  router.post('/orders', authGuard, writeLimit, body(orderSchema), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof orderSchema>>;
    // M8: the key may arrive in the body or in the standard `Idempotency-Key`
    // header. The header is preferred when both are present, because that is the
    // one a generic HTTP client can attach without touching the payload.
    const headerKey = req.header('idempotency-key')?.trim();
    const idempotencyKey = headerKey || validated.body.idempotencyKey;
    if (idempotencyKey && idempotencyKey.length > 80) {
      throw AppError.validation('That idempotency key is too long.', [
        { field: 'idempotencyKey', message: 'Use at most 80 characters.' },
      ]);
    }
    const receipt = await orders.createOrder(actor.id, {
      address: validated.body.address as AddressEntity,
      paymentMethod: validated.body.paymentMethod as PaymentMethod,
      deliveryMethod: validated.body.deliveryMethod as DeliveryMethodId | undefined,
      voucherCode: validated.body.voucherCode,
      idempotencyKey,
    });
    sendCreated(res, receipt);
  });

  router.get('/orders', authGuard, async (req, res) => {
    const actor = actorOf(req);
    const list = await orders.listForCustomer(actor.id);
    sendData(res, { orders: list });
  });

  router.get('/orders/:id', authGuard, validate({ params: idParam }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, await orders.getForCustomer(actor.id, validated.params.id));
  });

  router.post('/orders/:id/cancel', authGuard, writeLimit, validate({ params: idParam, body: cancelSchema }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof cancelSchema>, unknown, z.infer<typeof idParam>>;
    sendData(res, await orders.cancelOrder(actor.id, validated.params.id, validated.body.reason));
  });

  // ---------------------------------------------------------------- seller
  const seller = Router();
  // Onboarding is a customer action, so it must run before the seller guard:
  // the account is not a seller yet. It authorises from the token only.
  seller.post('/register', authGuard, writeLimit, validate({ body: sellerRegistrationSchema }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof sellerRegistrationSchema>>;
    const result = await sellers.registerSeller(actor.id, validated.body);
    sendCreated(res, result);
  });

  // M8: also before the guard, because a `pending` applicant is refused by the
  // guard and still needs to read *why* their application is not active yet.
  seller.get('/application', authGuard, async (req, res) => {
    sendData(res, await sellers.applicationForUser(actorOf(req).id));
  });

  seller.use(authGuard, sellerGuard);

  seller.get('/profile', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, { profile, store: await sellers.store(profile.id) });
  });

  seller.get('/dashboard', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, await sellers.dashboard(profile.id));
  });

  seller.get('/products', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, { products: await sellers.listProducts(profile.id) });
  });

  seller.patch('/products/:id/status', writeLimit, validate({ params: idParam, body: statusSchema }), async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    const { validated } = req as ValidatedRequest<z.infer<typeof statusSchema>, unknown, z.infer<typeof idParam>>;
    sendData(res, await sellers.setProductStatus(profile.id, validated.params.id, validated.body.status));
  });

  seller.post('/products/:id/stock', writeLimit, validate({ params: idParam, body: stockSchema }), async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    const { validated } = req as ValidatedRequest<z.infer<typeof stockSchema>, unknown, z.infer<typeof idParam>>;
    sendData(
      res,
      await sellers.adjustStock(profile.id, validated.params.id, {
        quantity: validated.body.quantity,
        variantId: validated.body.variantId,
        reason: validated.body.reason ?? 'manual',
      }),
    );
  });

  seller.get('/inventory/summary', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, await sellers.inventorySummary(profile.id));
  });

  seller.get('/inventory/adjustments', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, { adjustments: await sellers.inventoryAdjustments(profile.id) });
  });

  seller.get('/orders', async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    sendData(res, { orders: await sellers.listOrders(profile.id) });
  });

  seller.get('/orders/:id', validate({ params: idParam }), async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, await sellers.getOrder(profile.id, validated.params.id));
  });

  seller.post('/orders/:id/advance', writeLimit, validate({ params: idParam }), async (req, res) => {
    const profile = await sellers.sellerForUser(actorOf(req).id);
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, await orders.advanceSellerOrder(profile.id, validated.params.id));
  });

  router.use('/seller', seller);

  // ----------------------------------------------------------------- admin
  /**
   * M8: seller approval. Mounted outside `/seller` on purpose — an approver is
   * not necessarily a seller, and gating these routes behind "has an active
   * seller profile" would make approving the first seller impossible.
   *
   * The gate is the `seller_approver` role on the token's user, read from the
   * datastore. No customer-facing route grants that role, so a customer cannot
   * reach this router by any payload it can construct.
   */
  const admin = Router();
  admin.use(authGuard, requireRole('seller_approver'));

  admin.get('/sellers', validate({ query: applicationStatusQuery }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, z.infer<typeof applicationStatusQuery>>;
    const status = validated.query.status ?? 'pending';
    sendData(res, { status, applications: await sellers.listApplications(status) });
  });

  admin.post('/sellers/:id/decision', writeLimit, validate({ params: idParam, body: applicationDecisionSchema }), async (req, res) => {
    const actor = actorOf(req);
    const { validated } = req as ValidatedRequest<z.infer<typeof applicationDecisionSchema>, unknown, z.infer<typeof idParam>>;
    const updated = await sellers.decideApplication(actor, validated.params.id, validated.body.decision, validated.body.note);
    sendData(res, { profile: updated, audit: await sellers.applicationHistory(validated.params.id) });
  });

  admin.get('/sellers/:id/history', validate({ params: idParam }), async (req, res) => {
    const { validated } = req as ValidatedRequest<unknown, unknown, z.infer<typeof idParam>>;
    sendData(res, { history: await sellers.applicationHistory(validated.params.id) });
  });

  router.use('/admin', admin);

  return router;
}
