# Vanta API (M8)

Express 5 + MongoDB backend for the Vanta marketplace. It owns identity, pricing,
stock, checkout and seller authorisation. The Expo app can run fully offline
against its own device datastore (`local` mode) or delegate all of that to this
server (`remote` mode).

- Base path: `/api/v1`
- Response envelope: `{ ok: true, data }` / `{ ok: false, error, meta }`
- Auth: opaque bearer sessions (`Authorization: Bearer <token>`)

## Running it

```bash
cd backend
npm install
cp .env.example .env          # then edit
npm run seed                  # optional: load the deterministic dev dataset
npm run dev                   # or: npm run build && npm start
```

Without a reachable MongoDB the server refuses to start unless
`ALLOW_MEMORY_DB=true` is set explicitly, and it logs that it is using the
in-memory driver. That driver is for development only: data is lost on restart and
`/health` reports `driver: "memory"` so a misconfigured deployment is visible
rather than silent.

`npm run seed -- --fresh` drops and re-inserts the dataset. It refuses to run
when `NODE_ENV=production`.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `API_BASE_PATH` | `/api/v1` | |
| `NODE_ENV` | `development` | `production` tightens CORS, body limits and cookie behaviour |
| `MONGO_URI` | — | Required in production |
| `ALLOW_MEMORY_DB` | `false` | Must be explicitly `true` to boot without Mongo |
| `MONGO_TRANSACTIONS` | `true` | Multi-document checkout. `true` + non-transactional topology is a startup failure in production |
| `SESSION_SECRET` | — | Required in production, >= 32 chars. Rotating it invalidates every session |
| `SESSION_TTL_DAYS` | `30` | |
| `SESSION_MAX_PER_USER` | `10` | Live sessions per account. `0` means no cap |
| `BCRYPT_ROUNDS` | `12` | |
| `CORS_ORIGINS` | — | Comma-separated. `*` rejected in production |
| `BODY_LIMIT` | `100kb` | |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `RATE_LIMIT_MAX` | `60` | Per IP, write routes |
| `AUTH_RATE_LIMIT_MAX` | `10` | Per IP, credential routes |
| `PASSWORD_RESET_RATE_LIMIT_MAX` | `5` | Per IP, reset routes |
| `MAIL_PROVIDER` | `console` (dev) | `console` \| `http` \| `smtp`. Only `http` is accepted in production |
| `MAIL_FROM` | `no-reply@vanta.test` | Must be a real sender in production |
| `MAIL_HTTP_ENDPOINT` | — | Required when `MAIL_PROVIDER=http` |
| `MAIL_HTTP_API_KEY` | — | Sent as a bearer token when set |
| `PUBLIC_APP_URL` | `http://127.0.0.1:8099/reset-password` | The route the mailed reset link points at |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | Single-use, stored hashed |
| `IDEMPOTENCY_TTL_HOURS` | `24` | How long a spent checkout key replays instead of re-running |
| `SEED_ON_START` | `false` | Deterministic dev dataset only |

Under `NODE_ENV=test` the server generates an ephemeral session secret instead of
requiring one, so a test run can never reuse or depend on a developer's secret.

### Production refuses to start on

A wildcard or empty CORS allowlist · the `console` mail transport · the `smtp`
transport (no SMTP client is bundled) · the default test sender · a missing
`MONGO_URI` · `SEED_ON_START=true` · a weak `SESSION_SECRET` · a negative
`SESSION_MAX_PER_USER` · `MONGO_TRANSACTIONS=true` against a topology that cannot
commit transactions.

Each of those is proved by booting this server with the bad configuration and
watching it exit, in `src/tests/config.test.ts` — not by inspecting a config object
from inside the test that set it.

## Endpoints

**Capability** — `GET /health`, `GET /health/ready`, `GET /meta/payment-methods`,
`GET /meta/delivery-methods`, `GET /meta/media-providers`

**Auth** — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`,
`PATCH /auth/me`, `POST /auth/me/password`, `POST /auth/logout`,
`POST /auth/logout-all`, `POST /auth/password-reset/request`,
`POST /auth/password-reset/confirm`

**Catalog** — `GET /catalog/categories`, `GET /catalog/products`,
`GET /catalog/products/:id`, `GET /catalog/stores/:sellerOrStoreId`,
`GET /catalog/summary`

**Cart** (auth required) — `GET /cart`, `POST /cart/items`,
`PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart/items`

**Orders** (auth required) — `POST /orders`, `GET /orders`, `GET /orders/:id`,
`POST /orders/:id/cancel`

**Seller** — `GET /seller/application` (auth only — an applicant needs to see
their own status before they are a seller), `POST /seller/register` (auth only),
then with auth + an **active** seller profile:
`GET /seller/profile`, `GET /seller/dashboard`, `GET /seller/products`,
`PATCH /seller/products/:id/status`, `POST /seller/products/:id/stock`,
`GET /seller/inventory/summary`, `GET /seller/inventory/adjustments`,
`GET /seller/orders`, `GET /seller/orders/:id`, `POST /seller/orders/:id/advance`

**Admin** (auth + the `seller_approver` role) — `GET /admin/sellers` (optional
`?status=pending|active|rejected|suspended`), `POST /admin/sellers/:id/decision`,
`GET /admin/sellers/:id/history`

### Checkout is atomic when the database allows it

`POST /orders` runs its whole write set — order, seller orders, payment, stock
decrements, cart clear, notifications — inside one `withTransaction` when the
topology supports it, and as compensating writes when it does not. Which mode is
live is reported by `GET /health/ready` (`transactions.strategy` is
`"multi-document"` or `"compensating-writes"`), not left to be inferred.

A crash between the commit and the idempotency record being marked complete is
recoverable: the order id is reserved *before* the claim and written into it, so a
retry that finds the order behind an `in_flight` key finishes the record and
returns the original order instead of dead-ending until the TTL expires.

### Idempotency

`POST /orders` accepts `Idempotency-Key` (header) or `idempotencyKey` (body). The
key is claimed by an insert against a unique `(scope, ownerId, key)` index, so
mutual exclusion is enforced by the server rather than by a read-then-write in
application code. A retry with the same payload replays the original response; the
same key with a different payload is a 409; a failed attempt releases its key.

### Password reset

`POST /auth/password-reset/request` mails a single-use link and answers
identically for a known and an unknown address, so the form is not an
account-enumeration oracle. Only a hash of the token is stored. A successful
`POST /auth/password-reset/confirm` revokes every session for the account. Both
routes are unauthenticated and separately rate limited.

### Seller onboarding

`POST /seller/register` creates the store and the seller profile, and is recorded
as `pending` with **no** `seller` role granted — an unreviewed account cannot
publish products or fulfil orders, and a client cannot grant itself the role. An
operator with `seller_approver` decides via `POST /admin/sellers/:id/decision`,
which moves the seller status, the store visibility and the role together and
writes an audit entry readable at `GET /admin/sellers/:id/history`. A decision that
would change nothing is a 409 rather than a silent no-op, and a repeat of a
settled state is refused the same way.

### Error codes

`validation_failed` (422) · `unauthorized` (401) · `forbidden` (403) ·
`not_found` (404) · `conflict` (409) · `unprocessable` (422) ·
`rate_limited` (429) · `internal_error` (500)

Validation failures carry `error.fields[]` with `{ field, message }` so a form can
attach the message to the offending input.

## Security properties

- Passwords are bcrypt-hashed server-side. The client never receives a hash.
- Sessions are opaque random tokens stored server-side, so logout, password change
  and password reset revoke access immediately. `POST /auth/me/password` revokes
  every other session, and a reset revokes all of them.
- Live sessions per account are capped by `SESSION_MAX_PER_USER`.
- Password-reset tokens are single-use, stored hashed, and expire; the TTL index
  is what reaps them.
- Seller routes resolve the seller from the authenticated user, never from a
  request field, so a caller cannot act on another seller's products or orders.
- Only an `active` seller profile reaches the seller area; `pending`, `rejected`
  and `suspended` are all refused.
- Checkout recomputes prices, discounts, shipping and totals from the database and
  ignores any client-supplied amount, seller id or order code.
- `POST /orders` is idempotent per key and owner, so a retried submit cannot create
  two orders and one customer cannot replay another's.
- Helmet, a CORS allow-list, a JSON body cap and per-IP rate limits on credential,
  reset and write routes are applied globally.

## Tests

```bash
cd backend
npm test           # in-memory driver, default: builds, then runs the suite
npm run test:mongo # real MongoDB replica set, via mongodb-memory-server
npm run test:all   # both
```

Two suites, because they prove different things.

**`npm test`** (in-memory driver, `BCRYPT_ROUNDS=4`) covers auth, catalog
visibility and pricing, cart mutation, checkout, seller authorisation, order
transitions, seed determinism, and the production boot rules.

**`npm run test:mongo`** starts a disposable single-node replica set and runs the
same shared contract scenarios against the real driver, plus the guarantees only a
database can make: that a failure part-way through checkout rolls back every write
it had already made, that the commit path persists all of it, that the unique
index behind an idempotency claim is enforced by the server, and that the TTL
indexes hang off real BSON dates and are reaped by the TTL monitor.

The shared scenarios in `src/contract/scenarios.ts` run in both suites, so a
guarantee that only holds for one driver is caught rather than assumed.

`mongodb-memory-server` downloads a MongoDB binary on first run; the launcher
pins `7.0.14`.

## Known limitations

- **Compensating writes are still reachable.** With `MONGO_TRANSACTIONS=false`, or
  against a standalone mongod in development, checkout is not atomic and a crash
  between two writes can leave drift. Production refuses to start in that
  combination rather than serving the weaker guarantee quietly.
- **No SMTP transport.** `MAIL_PROVIDER=smtp` is a declared option with no
  implementation, and production rejects it. Use a mail API over `http`.
- **No public seller listing.** Seller profiles are only available to their owner
  via `/seller/profile`, so the client's remote catalogue mirror carries stores
  but not seller entities.
- **The Expo client only calls part of this API in remote mode.** Auth, health,
  catalogue reads, and seller application/profile go over HTTP. Cart, checkout,
  orders, wishlist, reviews, vouchers and seller inventory mutations are served
  here but are not yet called by the app, so in a remote-mode build those screens
  still read the on-device database. Every endpoint below is real and covered by
  the contract suite — the client side is the gap, not the server.
- **Payments are simulated.** Only COD settles with a courier; the other methods
  move no money.
- **Media is device-local.** `GET /meta/media-providers` reports what is
  configured; no cloud provider is hardcoded.
- **Rate limiting is in-process.** A fixed window per instance, so a multi-instance
  deployment would need a shared store to enforce a global limit.
