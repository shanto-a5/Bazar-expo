# VANTA — Frontend & Content Architecture

Purpose of this document: record the architecture that exists today, in enough
detail that the backend can be designed and implemented phase by phase against
it as the source of truth. Nothing here is aspirational. Where something is a
gap, it is called a gap.

Written against the working tree of 2026-10-06 (frontend work committed as
`d11b71d`; logo asset changes uncommitted on top).

> **M19 update (remote-only).** The on-device "local marketplace" simulator and
> the `EXPO_PUBLIC_API_MODE` switch have since been removed. The Expo app is now
> remote-only: the API is the single source of truth and there is no local
> fallback. References below to "local mode", `isRemoteMode()` branches and the
> two-mode `local`/`remote` split are historical and describe the pre-M19
> architecture. Where this document quotes a `git` commit or a runtime rule that
> has changed, the README is authoritative for current behaviour.

## How to read this document

| Part | Content | Status |
| --- | --- | --- |
| **Part A** | Frontend & content architecture (the Expo app, `src/`, `shared/`) | Source of truth |
| **Part B** | Existing backend implementation (`backend/`) | Reference only — not frontend architecture |
| **Part C** | Gaps, invariants, phase-design notes | Derived from A + B |

---

# PART A — FRONTEND & CONTENT ARCHITECTURE

## A1. Stack & conventions

| Area | Choice |
| --- | --- |
| Framework | Expo SDK 57 (`expo ~57.0.24`), React `19.2.3`, React Native `0.86.3`, `react-native-web` `0.21.0` |
| Routing | `expo-router ~57.0.22` with `typedRoutes: true` — route strings are compile-time checked |
| Language | TypeScript `~6.0.3`; `tsc --noEmit` typecheck, `expo lint` |
| State | React context for session; `zustand ^5` is a dependency; durable state lives in repositories |
| Persistence | `@react-native-async-storage/async-storage` behind a `StorageAdapter` |
| Graphics/UI | `expo-image`, `expo-glass-effect`, `expo-symbols`, `react-native-safe-area-context`, `react-native-reanimated` 4.5 |
| Aliases | `@/` → `src/`, `@shared/` → `shared/` |

Conventions that matter when reading or extending the code:

- **Every non-obvious rule carries its reason in a doc comment.** The comments
  are load-bearing documentation; they explain *why*, and the "why" is usually a
  bug that used to happen.
- Milestone tags (`M2-A`, `M7-Q`, `M8`, `M9-B`, `M10-N1`) mark the change that
  introduced a rule.
- Payment simulator values are fixed and must not drift: COD; bKash/Nagad OTP
  `123456`, PIN `12121`; card `5555 5555 5555 4444`, `12/30`, CVV `123`, code
  `123456` (see A16).
- Seller Mode preference key is `vanta.prefs.sellerMode` (absent = OFF). It is a
  *view preference*, never a permission change.
- The customer Home route is `/`. There is no `/home`, `/index`,
  `/seller-home` or `/customer-home`.

### Root scripts (`package.json`)

| Script | Purpose |
| --- | --- |
| `start` / `android` / `ios` / `web` | Expo dev server |
| `typecheck` | `tsc --noEmit` |
| `lint` | `expo lint` |
| `export:web` | `expo export --platform web --output-dir dist` |
| `audit:routes` | `scripts/audit-routes.cjs` — every route reachable, no orphan screens (37/37) |
| `audit:empty` | `scripts/audit-empty.cjs` — empty-marketplace guarantee against a served `dist` |
| `audit:a11y` | `scripts/audit-a11y.cjs` — accessibility sweep |
| `audit:security` | `scripts/audit-security.cjs` — static security sweep |
| `verify` | `typecheck && lint && audit:routes && audit:a11y && audit:security` |
| `api:dev` / `api:build` / `api:start` / `api:seed` / `api:test` | Delegate to `backend/` npm scripts |
| `verify:api` | backend typecheck + backend tests |
| `verify:all` | `verify` + `verify:api` |

## A2. Terminology

| Term | Meaning in VANTA |
| --- | --- |
| **Marketplace** | The whole product. Multi-seller: customers browse stores, cart across sellers, check out with per-seller splits. |
| **Seller** | A `SellerProfile` (a person/business that applied). Distinct from the `User` account that owns it. |
| **Store** | One seller's shop front (`Store`), 1:1 with a seller. Carries shipping fee, free-shipping threshold, rating, delivery estimate. |
| **Seller Mode / Seller Center** | A device-level *view preference* (`vanta.prefs.sellerMode`) that decides which surface the app opens on. Not a role, not a permission. |
| **Customer dock** | `CustomerBottomDock`, the Liquid Glass bottom bar with 4 tabs: Home `/`, Cart `/cart`, Save `/wishlist`, Settings `/settings`. Rendered by both the `(home)` and `(seller)` shells. |
| **Guest cart** | A signed-out visitor owns a cart under `GUEST_OWNER_ID` (`GUEST_CART_OWNER_ID`), merged/rebound on sign-in. |
| **Effective price** | The price a customer actually pays for a product right now: `salePrice` when active and ≤ regular, else `regularPrice` (rule lives in `shared/catalog-rules`). |
| **Variant** | A `ProductVariant` with `attributes`, own `price`/`stock`/`sku`. `hasVariants` decides whether the cart line carries a `variantId`. |
| **Order vs SellerOrder** | One customer `Order` fans out into per-seller `SellerOrder`s. The customer status is a roll-up of the parts (bottleneck rule, see A13). |
| **Voucher** | `percentage` \| `fixed` \| `free_shipping`, scoped `platform` \| `seller`, with min order, cap, window, usage limits. |
| **Return request** | Per order *line*, with reason, images, preferred resolution, seller decision timeline. |
| **Taxonomy** | The fixed category vocabulary sellers publish against. Reference data, seeded once. Not marketplace content. |
| **Remote mode** | The only mode since M19. The Vanta API is the datastore; authority for identity, pricing, stock and the catalogue. Configured with `EXPO_PUBLIC_API_BASE_URL`. |
| **Local mode** | **Removed in M19.** The pre-M19 `EXPO_PUBLIC_API_MODE=local` switch, the on-device member auth and the local marketplace simulator no longer exist. |
| **Mirror** | The catalogue (categories/products/stores) is copied into the local DB at boot so synchronous read paths keep working. A cache, never a source of truth. |
| **Gateway** | A module that picks the local or remote implementation once, so no screen branches on mode (`auth-gateway.ts`). |
| **Envelope** | The response shape `{ ok: true, data }` / `{ ok: false, error, meta }`. |

## A3. Layering & directory map

Dependency direction (one way, no upward imports):

```
app (routes) → modules (feature UI + guards) → services (business rules)
                                              → api (remote transport, via gateways)
              → components / theme
services → repositories (interfaces) → database + storage
api → domain types, config
shared/ ← imported by BOTH src/ and backend/ (data-free rules only)
```

| Path | Files | Role |
| --- | --- | --- |
| `src/app/` | 41 | expo-router routes (37 screens + 4 group layouts) |
| `src/modules/` | 21 | Feature UI blocks and session/guard primitives |
| `src/services/` | 22 | Business rules over repositories |
| `src/repositories/` | 2 | Contracts (`interfaces.ts`, 195) + local impl (`local/local-repositories.ts`, 444) |
| `src/database/` | 1 | `local-database.ts` (173) — in-memory collections + async flush |
| `src/storage/` | 2 | `storage-adapter.ts` (18), `implementations.ts` (117) |
| `src/infrastructure/` | 2 | `container.ts` (112), `bootstrap.ts` (169) |
| `src/api/` | 10 | `vanta-api.ts`, `api-client.ts`, `remote-auth-service.ts`, `remote-hydration.ts` + per-feature mirrors (`remote-orders.ts`, `remote-seller.ts`, `remote-social.ts`, `remote-reviews.ts`, `remote-notifications.ts`, `remote-address.ts`) |
| `src/domain/types/` | 6 | Entity definitions + `CollectionKey` |
| `src/taxonomy/` | 0 | Empty since M19; taxonomy is seeded server-side and mirrored at boot |
| `src/components/` | 4 | `ui.tsx`, `back-button.tsx`, `customer-bottom-dock.tsx`, `customer-dock-inset.tsx` |
| `src/theme/` | 2 | `tokens.ts` (77), `vanta-theme.ts` (85) |
| `src/config/` | 1 | `runtime-config.ts` — API base URL + timeout (remote-only since M19) |
| `src/utils/` | 4 | `id.ts`, `image.ts`, `money.ts`, `time.ts` |
| `shared/` | 8 | Cross-runtime commerce rules (see A13) |
| `scripts/` | 4 | Audit scripts |

## A4. Runtime modes

> **Superseded in M19.** This section describes the pre-M19 two-mode split. The
> app is now remote-only — see the M19 note at the top of this document.

`src/config/runtime-config.ts`. The app ran in exactly one of two modes,
resolved **once per process** at import time:

| | `local` (default) | `remote` |
| --- | --- | --- |
| Datastore | the device (`AsyncStorage`) | the Vanta API |
| Network | none | required |
| Identity | on-device password hash + local sessions | server bcrypt + opaque bearer token |
| Checkout maths | on device | on the server, authoritative |
| First launch | empty marketplace + taxonomy | the server's catalogue snapshot |
| `apiRoot` | `''` | `${apiBaseUrl}/api/v1` |

Rules (pre-M19):

1. `EXPO_PUBLIC_API_MODE` must be exactly `local` or `remote`; anything else
   throws `ConfigurationError` **at boot**, not at first network call. Empty/absent
   means `local`.
2. Remote requires `EXPO_PUBLIC_API_BASE_URL` — must match `^https?://`, trailing
   slashes stripped, and must be `https` when `NODE_ENV=production`.
3. **No fallback.** If remote is selected and the server cannot be reached, boot
   fails with a visible error. It never reverts to local data.
4. Request timeout default 15 000 ms, overridable via `EXPO_PUBLIC_API_TIMEOUT_MS`.
5. Only `EXPO_PUBLIC_*` values reach the bundle. No secrets client-side: the
   server holds the session secret, DB URI and payment config; the client only
   ever holds an opaque bearer token.

Since M19 only the `remote` column survives: `EXPO_PUBLIC_API_BASE_URL` is the
only required config and there is no mode switch or local fallback. Because Expo
inlines `EXPO_PUBLIC_*` at build time, changing the base URL means rebuilding.

## A5. Cold start

`src/infrastructure/bootstrap.ts`. `boot()` is a module-level promise so every
caller awaits the same boot: no duplicate installs, no race.

```
1. Native splash stays visible.
2. Load all 21 collections from storage into the in-memory LocalDatabase.
3. Branch on mode:
   local  → purgeLegacyDemoData()            // clears pre-"empty marketplace" demo records, once
            installTaxonomy()                // guarded by TAXONOMY_MARKER_KEY = 'vanta.meta.taxonomy'
            // ONLY categories are written. No products, sellers, stores,
            // accounts, orders, reviews, vouchers, promotions or payments.
   remote → restore stored token onto the ApiClient
            register the 401 handler (reject token → clear → signed out)
            GET /api/v1/health → must be reachable and healthy
            warn if driver !== 'mongo' (in-memory driver = non-durable)
            hydrateRemoteCatalog()           // replaces categories/products/stores wholesale
            // a failure here FAILS THE BOOT. No local fallback.
4. Mount SessionProvider → authService.getCurrentUser() restores the session.
5. Hide splash only after the session resolves to a state.
```

`useBootGate()` exposes `{ status: 'loading' | 'ready' | 'failed', retry }`:

- `loading` → labelled spinner (never a blank frame)
- `ready` → `<SellerModeStartup />` + `<Stack />`
- `failed` → retryable failure card (a rejected boot clears the module promise so
  retry starts fresh instead of replaying the rejection)

`hydrateRemoteCatalog()` (`src/api/remote-hydration.ts`):

- Fetches categories, then pages products at `pageSize=60` (the server cap),
  stopping on a short page, max 60 pages.
- Fetches each referenced store (concurrency 6), drops the server's seller
  summary, keeps the authoritative product count.
- `db.replaceCollection(...)` for `categories`, `products`, `stores`, then
  `persistAll()`. **Wholesale replacement, not merge** — a delisted product must
  disappear.
- Catalogue only. Never sessions, cart, orders, payments or wishlist.
- Seller profiles are *not* mirrored (no public seller listing endpoint).

## A6. Routing map

Root layout (`src/app/_layout.tsx`):

- `SafeAreaProvider` (with `initialWindowMetrics`) → `SessionProvider` → boot
  gate → `Stack screenOptions={{ headerShown: false }}`.
- `unstable_settings.initialRouteName = '(home)'`.
- The root is a **`Stack`, not a `Slot`**: a `Slot` renders only the matched
  child, so crossing into `(auth)` unmounted `(home)` and threw its native stack
  state away. A `Stack` keeps each group mounted so each keeps its own history.
- `SellerModeStartup` sits beside the Stack — a launch-time decision only; it
  reads the preference once and never re-asserts it, so Back out of Seller Center
  is not fought by a redirect.

### `(auth)` — 4 screens, own native headers

| Route | Screen |
| --- | --- |
| `/login` | Sign in (accepts `next` for post-auth resume) |
| `/register` | Create account |
| `/forgot-password` | Step 1: request reset |
| `/reset-password` | Step 2: confirm with token |

### `(home)` — 20 screens, customer shell

Shell: `CustomerDockClearanceProvider` → `Stack` (via `vantaStackScreenOptions`)
→ `CustomerBottomDock` overlay. Clearance lets any screen push bottom content
clear of the dock without knowing the dock exists.

| Route | Notes |
| --- | --- |
| `/` | Home (entry surface) |
| `/browse` | Catalogue listing + filters |
| `/search` | Search (persisted history) |
| `/product/[id]` | Product detail |
| `/stores` | Store directory |
| `/store/[id]` | Store front |
| `/cart` | Cross-seller cart |
| `/checkout` | 4 steps: Address → Delivery → Payment → Review |
| `/order-confirmation` | Post-checkout |
| `/orders` | Order list |
| `/order/[id]` | Order detail + timeline + returns entry |
| `/return-request` | Raise a return for a line |
| `/wishlist` | Saved products |
| `/vouchers` | Voucher list |
| `/write-review` | Review a purchased line |
| `/my-reviews` | Reviews written |
| `/notifications` | Notifications |
| `/account` | Profile |
| `/addresses` | Address book |
| `/settings` | Settings (dock tab) |

### `(seller)` — 13 screens, Seller Workspace shell

Shell is identical in structure to `(home)` — **same** `CustomerBottomDock`,
unmodified, plus `CustomerDockClearanceProvider`.

| Route | Notes |
| --- | --- |
| `/seller-dashboard` | Metrics, checklist, findings |
| `/seller-apply` | Onboarding (session required, **seller role not required**) |
| `/seller-products` | Product list |
| `/seller-product/new` | Create product |
| `/seller-product/[id]` | Product detail |
| `/seller-product-edit/[id]` | Edit product |
| `/seller-inventory` | Stock + adjustments |
| `/seller-orders` | Fulfilment queue |
| `/seller-order/[id]` | Order detail + advance status |
| `/seller-returns` | Return requests |
| `/seller-reviews` | Reviews of this seller's products |
| `/seller-store-settings` | Store front settings |
| `/seller-vouchers` | Voucher management |

### Dock

`src/components/customer-bottom-dock.tsx` — tabs are fixed:

```ts
type DockHref = '/' | '/cart' | '/wishlist' | '/settings';
// Home / Cart / Save / Settings
```

- Active tab = exact pathname match (`/` special-cased).
- Navigation is `router.navigate(href)` (not push), so the dock does not grow
  unbounded history.
- iOS uses `SF Symbol`s, Android Material weights, web fallbacks; the dock is
  `pointerEvents`-aware and sits above `customer-dock-inset.tsx` clearance.

## A7. Session, guards, authorization

### Session authority

`src/modules/session/session-context.tsx` — `SessionProvider` is the **single**
identity authority, mounted above the router tree.

```ts
type SessionStatus = 'checking' | 'signedIn' | 'signedOut';
interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  isSeller: boolean;                 // user.roles.includes('seller')
  cartOwnerId: string;               // user.id ?? GUEST_OWNER_ID
  /* ... */
}
export const GUEST_OWNER_ID = GUEST_CART_OWNER_ID;
```

### Guards (`src/modules/session/route-guard.tsx`)

Two functional guards — no email-string matching, no button-hiding-only logic:

| Guard | Requirement | Failure behaviour |
| --- | --- | --- |
| `withSession(Component, next?)` | signed in | `checking` → spinner; `signedOut` → **push** `/login?next=…` |
| `withSellerCapability(Component, next?)` | signed in **and** `roles` includes `seller` | signed out → push login; signed in without role → `<Redirect href="/" />` |

`PROTECTED_ROUTES` (allowlist, 21 entries):

```
/account  /addresses  /checkout  /my-reviews  /order-confirmation  /orders
/notifications  /return-request  /wishlist  /write-review
/seller-dashboard
/seller-apply            ← session only, deliberately NOT the seller role
/seller-inventory  /seller-orders  /seller-product/new  /seller-products
/seller-product-edit/[id]  /seller-returns  /seller-reviews
/seller-store-settings  /seller-vouchers
```

Post-auth resume:

- `buildAuthRedirectNext(pathname, params)` carries the guarded screen's own
  search params through login (otherwise `/checkout?voucher=SAVE10` silently
  loses the voucher).
- `authRedirectHref` / `authRedirectTarget` re-validate the `next` pathname
  against `PROTECTED_ROUTES` — anything else collapses to `/(home)`. This is the
  open-redirect defence.
- The guard **pushes** rather than replaces, so the originating shell stays
  mounted; `resumeAfterAuth(router)` then just pops back.
- `SignInGate` renders a sign-in prompt for signed-out visitors on seller
  surfaces, with a `fallback` href for cold deep links.
- `useRequireAuth()` is the imperative form used by buttons (returns `false` and
  routes to login when signed out; no-ops while `checking`).

### Launch routing

`SellerModeStartup` (`src/modules/session/seller-mode-startup.tsx`) — reads
`vanta.prefs.sellerMode` **once per launch**. If the first landing is `/` and the
preference is ON, it `router.replace('/seller-dashboard')`. It never re-asserts
afterwards.

> Known behaviour (documented, not changed): the `decided` ref only trips when
> the launch lands on `/`. A reload or deep link onto a seller route leaves the
> gate armed, so the *first later* `/` visit gets replaced back to
> `/seller-dashboard`. Verified with a probe: normal cold launch at `/` → tap
> Home → stays on `/` with `vanta.prefs.sellerMode` still `1`.

## A8. Data layer

### Storage adapter (`src/storage/`)

```ts
interface StorageAdapter { get(key): Promise<string|null>; set(key,value): Promise<void>; remove(key): Promise<void>; }
```

Implementations:

| Class | Backing | Purpose |
| --- | --- | --- |
| `AsyncStorageAdapter` | `@react-native-async-storage/async-storage` | generic key/value |
| `LocalSessionStorage` | adapter | `vanta.session.token` get/set/clear |
| `LocalResetTokenStorage` | adapter | `vanta.auth.reset-tokens` — persists SHA-256 digests only, single-use, expires. Persisted because a reset link is followed in a *fresh* process. Corrupt state is dropped, never thrown (a bad token must not wedge sign-in). |
| `LocalDeviceImageStorage` | `expo-file-system` | copies picked images into `Documents/vanta-images/<folder>/<uuid>.<ext>`; returns a `p:` marker for already-persisted URIs |

### `LocalDatabase` (`src/database/local-database.ts`)

- 21 collections keyed by `CollectionKey`, each stored under
  `vanta.collection.<key>` as a JSON array.
- Synchronous read API (`getCollection`, `getById`) after `load()`; throws
  `LocalDatabase must be loaded before use.` if used too early.
- Writes mark the collection dirty and schedule a **microtask flush**
  (batched, coalesced), then `notify()` subscribers.
- Corrupt collection JSON is reset to `[]` with a warning; persistence failures
  are logged, not thrown.
- `replaceCollection(key, items)` — used by remote hydration for wholesale
  replacement.

### Repository contracts (`src/repositories/interfaces.ts`)

Synchronous, repository-per-collection, generic `FindOptions<T>` with
`where`/`orderBy`/`limit`/`offset`.

| Repository | Key methods |
| --- | --- |
| `UserRepository` | `getById`, `getByEmail`, `list`, `create`, `update` |
| `SessionRepository` | `getByToken`, `create`, `delete`, `listForUser` |
| `CategoryRepository` | `getById`, `list`, `create` |
| `SellerRepository` | `getById`, `getByUserId`, `list`, `create`, `update` |
| `StoreRepository` | `getById`, `getBySellerId`, `list`, `create`, `update` |
| `ProductRepository` | `getById`, `list({sellerId,statuses})`, `create`, `update` |
| `CartRepository` | `getByUserId`, `create`, `upsert` |
| `WishlistRepository` | `getByUserId`, `create`, `upsert` |
| `AddressRepository` | `listForUser`, `getById`, `create`, `update`, `remove` |
| `VoucherRepository` | `getByCode`, `getById`, `list`, `create`, `update`, `remove` |
| `PromotionRepository` | `getById`, `list`, `create`, `update` |
| `OrderRepository` | `getById`, `listForCustomer`, `create`, `update`, `remove`* |
| `SellerOrderRepository` | `getById`, `listForSeller`, `listForOrder`, `list`, `create`, `update`, `remove`* |
| `PaymentRepository` | `getByOrderId`, `create`, `update`, `remove`* |
| `ReviewRepository` | `getById`, `listForProduct/Seller/User`, `list`, `create`, `update`, `remove`, `getByOrderItem` |
| `ReturnRequestRepository` | `getById`, `listForUser/Seller`, `list`, `create`, `update` |
| `NotificationRepository` | `listForUser`, `create`, `update`, `remove` |
| `SearchHistoryRepository` | `listForUser`, `create`, `remove`, `clearForUser` |
| `RecentlyViewedRepository` | `listForUser`, `create`, `remove` |
| `StoreFollowerRepository` | `listForStore/User`, `get`, `create`, `remove` |
| `InventoryAdjustmentRepository` | `listForProduct/Seller`, `create`, `remove`* |

\* `remove` is documented as "compensation hook, mirroring the backend contract" —
the frontend already anticipates server-side compensation/rollback.

### Container (`src/infrastructure/container.ts`)

`getContainer()` returns a process singleton `Container`:

```
db: LocalDatabase
imageStorage: LocalDeviceImageStorage
sessionStorage: LocalSessionStorage
resetTokenStorage: LocalResetTokenStorage
repositories: RepositoryMap   // the 21 above
mode: 'local' | 'remote'      // resolved once
isRemote: boolean
```

**Screens never branch on mode.** The auth gateway and the service layer do.
In remote mode the repositories remain as a read-through catalogue mirror;
authoritative reads/writes go through the API.

## A9. Domain model

### Base + collections

```ts
interface BaseEntity { id: string; createdAt: string; updatedAt: string; }

type CollectionKey =
  'users' | 'sessions' | 'categories' | 'sellers' | 'stores' | 'products'
  | 'carts' | 'wishlists' | 'addresses' | 'vouchers' | 'promotions' | 'orders'
  | 'sellerOrders' | 'payments' | 'reviews' | 'returnRequests' | 'notifications'
  | 'searchHistory' | 'recentlyViewed' | 'storeFollowers' | 'inventoryAdjustments';
```

### Identity (`user.ts`)

```
Role = 'customer' | 'seller'
User        : name, email, phone, passwordHash, passwordSalt, avatar, roles[]
Session     : userId, token, expiresAt
Address     : userId, label, recipientName, phone, division, district, area,
              addressLine, postalCode, instructions?, isDefault
```

### Catalogue (`catalog.ts`)

```
Category    : name, icon, image, parentId (null = top level), order
ProductStatus = 'draft'|'pending'|'active'|'paused'|'out_of_stock'|'archived'
ProductVariant : productId, sku, attributes{}, price, compareAtPrice?, stock, image?
Product     : sellerId, storeId, name, brand, categoryId, subcategoryId?,
              description, highlights[], images[], video?, regularPrice,
              salePrice?, costPrice?, sku, stock, lowStockThreshold, variants[],
              hasVariants, status, publishedAt?, ratingAvg, ratingCount,
              soldCount, viewCount, isNewArrival?
SellerType  = 'individual' | 'business'
SellerStatus= 'pending' | 'active' | 'rejected' | 'suspended'
SellerProfile : userId, storeId, fullName, phone, email, nationalId, sellerType,
              entityName?, pickup{Division,District,Area,AddressLine},
              return{Division,District,Area,AddressLine},
              bank {bankName, accountName, accountNumber, branch?},
              agreement {marketplaceTerms, sellerPolicies, productAuthenticity,
                         fulfillmentResponsibility}, status
Store       : sellerId, name, description, logo, banner, status ('active'|'paused'),
              ratingAvg, ratingCount, responseRate, responseTimeMinutes,
              productCount, followerCount, shippingFee, freeShippingThreshold,
              deliveryEstimateDays {min,max}, location, verified
```

### Commerce (`commerce.ts`)

```
CartItem    : id, productId, sellerId, variantId?, variantAttributes?, quantity,
              selected, priceSnapshot, addedAt, updatedAt?
Cart        : userId, items[]
Wishlist    : userId, items[{productId, addedAt}]

VoucherType = 'percentage' | 'fixed' | 'free_shipping'
VoucherScope= 'platform' | 'seller'
Voucher     : code, title, type, discountValue, minimumOrder, maximumDiscount?,
              scope, sellerId?, categoryId?, productIds?, startAt, expiry,
              usageLimit?, usageCount, perUserLimit?, perUserUsed{},
              active, description?

PromotionType = 'flash_sale' | 'deal' | 'banner'
Promotion   : title, type, description?, image, productIds[], discountPercent,
              startAt, endAt, active

OrderStatus = placed|new|confirmed|processing|packed|ready_to_ship|shipped
            | out_for_delivery|delivered|cancelled|return_requested
            | return_approved|partially_returned|returned|refunded
PaymentMethod = cod|bkash|nagad|card
PaymentStatus = pending|authorized|paid|failed|refunded
DeliveryMethodId = standard|express

OrderItemSnapshot : id, productId, productName, brand, image, variantId?,
              variantAttributes?, unitPrice, discount, quantity, subtotal,
              status (line-level), reviewId, hasReview, returnRequestId?,
              returnedQuantity?, remainingQuantity?
Order       : customerId, orderCode, status, sellerOrderIds[], subtotal,
              shippingTotal, vouchersDiscount, total, paymentMethod,
              paymentStatus, deliveryMethod, shippingAddress, voucherCodes[],
              placedAt, cancelledAt?, deliveredAt?
SellerOrder : orderId, sellerId, storeId, storeName, storeLogo, status, items[],
              subtotal, shippingFee, vouchersDiscount, total, shippingAddress,
              carrier?, trackingNumber?, timeline[{status,at}], fulfilledAt?
PaymentTransaction : orderId, userId, method, amount, status, reference?, paidAt?,
              refundedAt?, refundedAmount?
ReturnReason= damaged|defective|wrong_item|missing_item
            | does_not_match_description|incorrect_size|other
ReturnRequest : orderId, sellerOrderId, orderItemId, userId, sellerId, productName,
              quantity?, reason, description, images[], preferredResolution
              ('refund'|'replacement'), status (pending|approved|rejected|returned
              |refunded), timeline[]
InventoryAdjustment : productId, variantId|null, quantity,
              reason ('sale'|'restock'|'manual'|'cancellation'|'return'), referenceId?
```

Snapshot fields on `OrderItemSnapshot` are deliberately **optional** so records
written before they existed still parse (`variantId` falls back to attribute
matching; `returnedQuantity` reads as 0; `remainingQuantity` is a denormalised
copy so the customer and seller views can show "2 of 3 returned" without
re-deriving history).

### Social (`social.ts`)

```
Review    : userId, userName, productId, sellerId, orderItemId, orderId, rating,
            title, text, images[], verifiedPurchase, sellerReply?{text,at},
            helpfulCount
NotificationType = order_placed|order_confirmed|order_shipped|order_delivered
                 | order_cancelled|return_update|promotion|voucher|review_reminder
                 | review_reply|seller_new_order|seller_order_cancelled
                 | seller_low_stock|seller_return_request|seller_review_received
                 | seller_account_status|system
AppNotification : userId, type, title, body, read, data?
SearchHistoryEntry : userId, query
RecentlyViewedEntry : userId, productId
StoreFollower      : userId, storeId
```

## A10. Service layer

All services are singletons (`export const xService = new XService()`), resolve
`getContainer()` lazily, and operate on repositories synchronously unless they
are payment/auth flows.

| Service | Lines | Responsibility |
| --- | --- | --- |
| `catalog-service.ts` | 1183 | Product CRUD/validation/publish, category tree, stock, visibility, inventory adjustments, effective price |
| `order-service.ts` | 1253 | Checkout, order lifecycle, status roll-up, cancellation, returns, restock, settlement |
| `cart-service.ts` | 353 | Guest + user carts, add/update/remove/select, availability checks |
| `analytics-service.ts` | 328 | Seller/dashboard metrics over orders + stock (`ANALYTICS_WINDOWS`) |
| `review-service.ts` | 370 | Review creation/validation, per-line uniqueness, seller replies, notifications |
| `voucher-service.ts` | 330 | Voucher CRUD + validation (`VoucherValidationError`), quote evaluation via `@shared/voucher-rules` |
| `seller-service.ts` | 291 | Seller application, store creation, approval status; **branches on `isRemoteMode()`** for register/application |
| `diagnostics-service.ts` | 474 | Read-only self-checks over the local dataset |
| `auth-service.ts` | 237 | Local register/login/session/profile, `hashPassword`/`verifyPassword` (expo-crypto) |
| `search-service.ts` | 148 | Product/store search with `SearchFilters`, history recording |
| `pricing-service.ts` | 128 | Bridges domain types → `@shared/pricing` (`computeTotals`, `buildGroups`, `lineAvailability`) |
| `address-service.ts` | 138 | Address book CRUD + default handling |
| `wishlist-service.ts` | 101 | Wishlist toggle/list, filtered to visible products |
| `payment-service.ts` | 57 | Payment method/delivery options (`DEFAULT_PAYMENT_METHOD`) |
| `bkash-service.ts` | 151 | bKash wallet simulator (`BKASH_DEMO`), OTP/PIN/attempt limits |
| `nagad-service.ts` | 151 | Nagad wallet simulator (`NAGAD_DEMO`) |
| `card-service.ts` | 199 | Card simulator (`CARD_DEMO`), Luhn, expiry, CVV, network detection |
| `delivery-service.ts` | 45 | Thin class over `@shared/delivery` |
| `media-service.ts` | 51 | Image picker wrapper (`MediaPickResult`) |
| `notification-service.ts` | 49 | Create/notify/read |
| `seller-mode-service.ts` | 39 | Persisted `vanta.prefs.sellerMode` view preference |
| `auth-gateway.ts` | 97 | **Mode seam**: local `AuthService` vs `RemoteAuthService` behind one `AuthGateway` interface |
| `auth-error.ts` | 14 | Shared `AuthError` class for local *and* remote so screens can branch on one type |

`auth-gateway` contract (what screens may call):

```
register, login, createSession, getCurrentUser, logout, emailExists,
resetPassword, requestPasswordReset, confirmPasswordReset, updateProfile,
changePassword, addRole, installUnauthorizedHandler?  // optional, remote only
```

`requestPasswordReset` resolves for unknown addresses in remote mode and the
caller renders the same confirmation either way (account-enumeration defence).
`localToken` is returned only by the on-device implementation — a demo
affordance, never a production path.

## A11. Modules & components

| Module | Files | Exports |
| --- | --- | --- |
| `modules/session` | 3 | `SessionProvider`, `useSession`, `SignInGate` + guards, `SellerModeStartup` |
| `modules/checkout` | 6 | `useCheckoutFlow`, `AddressStep`, `DeliveryStep`, `PaymentStep`, `ReviewStep`, `BkashPaymentSheet`, `NagadPaymentSheet`, `CardPaymentSheet`, shared checkout UI |
| `modules/discovery` | 1 | `DiscoveryFilterPanel`, `SortRow`, `ProductRail`, `EMPTY_DISCOVERY_FILTERS`, `toServiceFilters` |
| `modules/navigation` | 2 | `vantaStackScreenOptions`, `vantaAuthStackScreenOptions`, `ROUTE_GROUP_ANCHORS`, `goBackOrReplace`, `hasNavigationHistory` |
| `modules/seller` | 3 | `ProductForm`, `SellerProductRow`, `StockPill`, `ProductStatusPill`, `MetricCard`, `VariantEditor`, `CategoryPicker`, analytics UI |
| `modules/orders` | 2 | order UI primitives (`StatusPill`, `OrderTimeline`, `OrderTotalsCard`, …), `useFocusRefresh` |
| `modules/reviews` | 1 | `ReviewFormFields`, `Stars`, `StarRatingInput`, validation |
| `modules/account` | 1 | `AddressFormFields`, `validateAddressForm` |
| `modules/wishlist` | 1 | `WishlistButton`, `useWishlistToggle` |
| `modules/auth` | 1 | `ResetConfirm` |

Components:

| Component | Role |
| --- | --- |
| `components/ui.tsx` | Design-system primitives (`Screen`, `Card`, `Button`, `Logo`, …). `Logo` renders `assets/logos/vanta-logo.png`. |
| `components/back-button.tsx` | History-aware back with `fallbackHref` |
| `components/customer-bottom-dock.tsx` | The 4-tab Liquid Glass dock |
| `components/customer-dock-inset.tsx` | `CustomerDockClearanceProvider` + `useDockClearance` — screens publish bottom clearance so scrolled content clears the dock |

## A12. Content model & taxonomy

`src/taxonomy/index.ts` — **the only data Vanta ever seeds.**

> Vanta starts as an EMPTY marketplace. No demo products, sellers, stores,
> accounts, orders, reviews, vouchers, promotions, followers, notifications or
> payment history exist anywhere in the runtime. A record only exists once a real
> person created it through the real flow.

What is seeded: `CATEGORY_TAXONOMY` — 20 top-level categories, each with an icon
and 4–6 subcategories (e.g. `Groceries 🛒` → Fresh Produce, Dairy & Eggs,
Beverages, Snacks, Staples, Baking; … `Jewellery & Watches 💍`). Rows are
materialised as `Category` entities with a `parentId` tree and `order`.

Why it cannot be dropped: `catalogService.validateDraft` rejects a product whose
`categoryId` does not resolve, and the product form's `CategoryPicker` reads
`catalogService.getTree()`. Removing taxonomy would make publishing impossible.

Guard rails:

- `installTaxonomy()` is idempotent, once per install, keyed by
  `TAXONOMY_MARKER_KEY = 'vanta.meta.taxonomy'`.
- `LEGACY_SEED_MARKER_KEY = 'vanta.meta.seeded'` marks devices that still hold
  the old demo dataset; `purgeLegacyDemoData()` clears those records once so
  old installs land in the same empty state as new ones.
- Images for categories are generated palette images (`makePaletteImage` from
  `@/utils/image`), not bundled assets.

## A13. Shared commerce core (`shared/`)

`shared/` is imported by **both** the Expo app (`@shared/...`) and the API server
(`../../../shared/...`). It is deliberately data-free: structural types only, no
domain type universe, no data layer.

| File | Lines | Contents |
| --- | --- | --- |
| `money.ts` | 14 | `roundMoney`, `sumMoney`. Every persisted/transported amount is a 2-decimal number; both sides round with the same helper so device and server totals cannot differ by a cent. |
| `types.ts` | 113 | `SharedProduct`, `SharedVariant`, `SharedStore`, `SharedSeller`, `SharedVoucher`, `CatalogLookups`, `ResolvedCartLine`, `SharedSellerGroup`, `SharedCartTotals`, `SharedOrderStatus` |
| `pricing.ts` | 121 | `lineSubtotal`, `shippingFeeForGroup`, `isGroupFreeShipping`, `groupLinesBySeller`, `computeVoucherDiscount`, `computeCartTotals`, `countSelectedItems` |
| `voucher-rules.ts` | 140 | `evaluateVoucherQuotes`, `voucherDisplayValue` — eligibility, caps, windows, per-user/usage limits |
| `catalog-rules.ts` | 101 | `effectivePrice`, `productStock`, `stockLevelOf`, `lineAvailability`, `productIsAvailable`, `customerVisibility`, `productIsVisibleToCustomer` |
| `order-status.ts` | 90 | `SELLER_STATUS_RANK`, `RETURN_OPEN`, `RETURN_CLOSED`, `deriveOrderStatus`, `allPartsDelivered` |
| `delivery.ts` | 108 | `DEFAULT_DELIVERY_METHOD`, `isDeliveryMethod`, `deliveryMethods`, `quoteDeliveryForTotals`, `checkoutTotals` |
| `index.ts` | 7 | Re-exports |

Rules the backend must reproduce exactly:

- **Bottleneck roll-up.** `deriveOrderStatus` reports the least-advanced live
  non-cancelled, non-return part (rank 0–6). If nothing is in flight, it surfaces
  the *highest* return state across parts. All cancelled → `cancelled`. Empty →
  `placed`.
- **Return states only own the roll-up when nothing else is moving.** Eagerly
  returning let one returned line mask a sibling still `shipped`, so the parent
  never reached `delivered` and COD settlement never fired.
- **`allPartsDelivered` is deliberately not `deriveOrderStatus === 'delivered'`.**
  A return does not un-deliver goods; gating settlement on the rolled-up status
  left COD `pending` forever.
- **Free-shipping voucher scope.** A seller-scoped free-shipping voucher waives
  only that seller's delivery fee.
- **Percentage/fixed vouchers** compute against the seller group's subtotal when
  scope is `seller`, otherwise the whole cart; capped by `maximumDiscount`.
- **Free shipping** = `subtotal >= store.freeShippingThreshold` OR
  `store.shippingFee === 0`; groups with no selected lines ship free.
- `cart.service.ts`, `order.service.ts`, `catalog.service.ts`, `pricing-service`,
  `voucher-service`, `delivery-service`, `money.ts` all re-export or delegate to
  `shared/` — there is intentionally only one implementation of the maths.

## A14. Remote client contract

### Transport (`src/api/api-client.ts`)

- Base: `runtimeConfig.apiRoot` (`${apiBaseUrl}/api/v1`); empty root ⇒
  `ApiError('No API is configured. The app is running in local mode.')`.
- Headers: `accept: application/json`, `content-type` only when a body exists,
  `authorization: Bearer <token>` unless `authenticated: false`.
- Envelope: `{ ok: boolean, data?, error?: { code, message, fields? }, meta?: { requestId } }`.
  **Every response is validated against the envelope** — a proxy HTML error page
  becomes a typed `ApiError`, not an undefined access.
- `x-request-id` is captured onto `ApiError.requestId`.
- **No retry on a request that may have been applied, and no fallback to another
  source.** A failure is reported, never hidden.
- 401 on an *authenticated* call triggers `onUnauthorized()` (clears the stored
  token → signed out). Login/register failures are unauthenticated and must not
  tear down the session.
- Timeout via `AbortController` (`requestTimeoutMs`); an abort not requested by
  the caller is reported as `timeout`.

`ApiErrorCode`:

```
validation_failed | unauthorized | forbidden | not_found | conflict
| unprocessable | rate_limited | internal_error | network_error | timeout
| malformed_response
```

`ApiError` exposes `status`, `code`, `field`, `fields[]`, `requestId`,
`isUnauthorized`, `isRetryable` (`network_error` | `timeout` | 503 | 429).

### Endpoint surface the client already knows (`src/api/vanta-api.ts`, 313 lines)

| Area | Calls |
| --- | --- |
| Health/meta | `GET /health`, `GET /health/ready`, `GET /meta/payment-methods`, `GET /meta/delivery-methods`, `GET /meta/media-providers` |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `PATCH /auth/me`, `POST /auth/me/password`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm` |
| Catalog | `GET /catalog/categories`, `GET /catalog/products` (page, pageSize, sellerId, categoryId, search), `GET /catalog/products/:id`, `GET /catalog/stores/:sellerOrStoreId`, `GET /catalog/summary` |
| Cart | `GET /cart?deliveryMethod`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart/items` |
| Orders | `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` |
| Seller | `POST /seller/register`, `GET /seller/profile`, `GET /seller/application`, `GET /seller/dashboard`, `GET /seller/products`, `PATCH /seller/products/:id/status`, `POST /seller/products/:id/stock`, `GET /seller/inventory/summary`, `GET /seller/inventory/adjustments`, `GET /seller/orders`, `GET /seller/orders/:id`, `POST /seller/orders/:id/advance` |

Client-side payload types exported for the server to mirror: `ApiUser`,
`AuthResult`, `ProductPage`, `CatalogSummary`, `StoreSummary`, `PricedCartLine`,
`OrderReceipt`, `CheckoutInput`, `HealthReport`.

> **Important:** having a method here does *not* mean remote mode uses it. See
> C1 for the actual wiring status.

## A15. Theme & assets

`src/theme/tokens.ts` — the single source of truth for palette; nothing else
hard-codes hexes.

```
primary #6C3AB8   primaryDark #4E2A8A   primarySoft #EEE5FB
accent  #F59E0B
surface #FFFFFF   surfaceMuted #F7F5F2  background #FAFAF9
border  #E5E1DC
text    #1C1917   textMuted #78716C     textFaint #A8A29E   textInverse #FFFFFF
danger  #DC2626   dangerSoft #FEE2E2    success #16A34A     successSoft #DCFCE7
overlay rgba(28,25,23,0.45)
bkashBrand { pink #E2136E, pinkDark #A80E54, pinkSoft #FCE4F0 }
nagadBrand { red #EE1C25, redDark #B3131A, redSoft #FCE3E3, orange #F6921E }
```

`src/theme/vanta-theme.ts` composes tokens into the RN theme. Also exported:
spacing, radius, shadow, `type` (text styles). Root layout background is
`#FAFAF9`; status bar is dark.

Branding assets:

| File | Use |
| --- | --- |
| `assets/logos/vanta-logo.png` | In-app `Logo` component (1024², yellow `#F6FC04` mark on transparent) |
| `assets/logos/Frontend.png` | Original source artwork (preserved byte-identical) |
| `assets/images/vanta-android-icon.png` | Android launcher icon (yellow mark on `#6C3AB8`) |
| `assets/images/vanta-android-icon-foreground.png` | Adaptive foreground (corner radius inside the safe circle) |
| `assets/images/vanta-android-icon-monochrome.png` | Themed/monochrome silhouette |

`app.json`: `android.icon` = `vanta-android-icon.png`; `adaptiveIcon` =
`backgroundColor #6C3AB8` + foreground + monochrome. No `backgroundImage` (the
old pale `#E6F4FE` gave ~1.05:1 against yellow).

## A16. Payment simulators

Payment methods: `cod`, `bkash`, `nagad`, `card`.

bKash, Nagad and card are **simulators**, not integrations: no gateway, no SMS,
no merchant account, no network call. They are also the methods *not* settled by
pressing "Place order" — the Review step hands off to the method's sheet, and the
order (with its `PaymentTransaction`) is created only after the sheet reports
success, carrying the sheet's `TRX-VANTA-…` reference. A rejected wallet/card,
wrong OTP/PIN/code, or closing the sheet creates **no order at all**. Each
session is single-use. COD is unchanged and settles on delivery.

| Method | Demo values | Reference |
| --- | --- | --- |
| bKash | wallet `01700000000`, OTP `123456`, PIN `12121` | `BKASH_DEMO`, `modules/checkout/bkash-payment.tsx` |
| Nagad | wallet `01800000000`, OTP `123456`, PIN `12121` | `NAGAD_DEMO`, `modules/checkout/nagad-payment.tsx` |
| Card | `5555 5555 5555 4444`, `12/30`, CVV `123`, code `123456` | `CARD_DEMO`, `modules/checkout/card-payment.tsx` |

Card validation is on-device: Luhn checksum, `MM/YY` not in the past, 3–4 digit
CVV, cardholder name, network derived from leading digits. PAN/CVV are never
persisted.

## A17. Verification surface

| Check | Command | Last known state |
| --- | --- | --- |
| Types | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass |
| Web build | `npm run export:web` | pass |
| Route audit | `npm run audit:routes` | 37/37, 0 unreferenced |
| Security audit | `npm run audit:security` | 0 findings |
| A11y audit | `npm run audit:a11y` | 4 pre-existing `a11y.tiny-text` findings (`(home)/index.tsx:675`, `:830`, `(seller)/seller-dashboard.tsx:601`, `modules/seller/seller-ui.tsx:590`) |
| Empty marketplace | `audit:empty` | 34/34 |
| Payment flows | (E2E) | 30/30 |
| Seller dock | (E2E) | 43/43 |
| Backend | `npm run verify:api` | typecheck + tests |

E2E suites live outside the repo in the session temp directory, using
`puppeteer-core` + local Chrome against a served `dist` (`serve-dist.cjs`,
default `127.0.0.1:8099`).

Known gotchas for E2E:

- `setInput` must target `[aria-label="..."]` and pick the **last** visible match
  (forms render hidden duplicate inputs).
- React Native Web emits multiple `img` nodes per `<Image>`, one at 0×0 — pick
  the largest laid-out one.

---

# PART B — EXISTING BACKEND IMPLEMENTATION (REFERENCE ONLY)

> This part describes what already exists in `backend/`. It is **not** frontend
> architecture and is not a design proposal — it is the current state of the
> server, recorded so the next phase builds on it instead of duplicating it.

## B1. What it is

`backend/` is a standalone Node ≥20 package named `vanta-api`:

| Aspect | Value |
| --- | --- |
| HTTP | Express `5.2.1`, `helmet`, `cors` allow-list, body limit `100kb` |
| Validation | `zod 3.24` |
| Database | MongoDB via `mongoose 8.9`; in-memory fallback (`ALLOW_MEMORY_DB`) for dev/tests |
| Auth | opaque bearer sessions, `bcryptjs` (12 rounds) |
| Mail | pluggable `MailTransport` (`console` \| `http` \| `smtp`) |
| Tests | built with `tsc`, run from `dist`; memory-server for Mongo tests |
| Base path | `/api/v1` |
| Envelope | `{ ok: true, data, meta }` / `{ ok: false, error, meta }` |

Scripts (in `backend/package.json`, also reachable as `npm run api:*` from root):
`build`, `start`, `dev`, `seed`, `typecheck`, `test`, `test:mongo`, `test:all`.

Run: `cd backend && npm install && cp .env.example .env && npm run seed && npm run dev`.

## B2. Configuration (`backend/src/config/env.ts`, 274 lines)

Read once at boot; validated; secrets live here and in `auth.service.ts` only.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `API_BASE_PATH` | `/api/v1` | compiled constant |
| `NODE_ENV` | `development` | `production` tightens everything |
| `MONGO_URI` | — | **required in production** |
| `ALLOW_MEMORY_DB` | `false` | must be explicitly true to boot without Mongo; refused in production |
| `MONGO_TRANSACTIONS` | `true` | multi-document checkout; reports weaker strategy via `/health/ready` |
| `SESSION_SECRET` | random | ≥32 chars in production; rotating invalidates sessions |
| `SESSION_TTL_DAYS` | `30` | |
| `SESSION_MAX_PER_USER` | `10` | `0` = no cap |
| `BCRYPT_ROUNDS` | `12` | |
| `CORS_ORIGINS` | dev: `http://127.0.0.1:8099`, `http://localhost:8081` | `*` rejected |
| `BODY_LIMIT` | `100kb` | |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `60` | per-IP writes |
| `AUTH_RATE_LIMIT_MAX` | `10` | credential routes |
| `PASSWORD_RESET_RATE_LIMIT_MAX` | `5` | |
| `MAIL_PROVIDER` | `console` (dev) | only `http` accepted in production |
| `MAIL_FROM` | `no-reply@vanta.test` | |
| `PUBLIC_APP_URL` | `http://127.0.0.1:8099/reset-password` | the route the mailed link points at |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | single-use, stored hashed |
| `IDEMPOTENCY_TTL_HOURS` | `24` | replay window for a spent checkout key |
| `SEED_ON_START` | `false` | refused in production |

All production refusals are **collected and reported together** so one failed
boot lists every problem, and each is proved by booting with bad config in
`src/tests/config.test.ts`.

## B3. Layering

```
server.ts (validate config → connect DB → optional seed → listen → graceful shutdown)
  └─ createApp(context)                 // helmet, CORS allow-list, requestId, body limit
       └─ app.use('/api/v1', createApiRouter(context))
            ├─ middleware: requestId, validate (zod), authGuard, rate limits
            └─ services (AppContext): auth, catalog, cart, orders, sellers, mail
                 └─ RepositoryBundle (contracts) → memory/ | mongo/
```

`AppContext` = `{ repos, auth, catalog, cart, orders, sellers, driver, mail }`,
built by `createContext(repos, mail?)` — injectable so the test suite boots the
real routes against the in-memory driver.

## B4. Endpoint inventory

Mounted at `/api/v1`.

**Capability**
```
GET  /health                     liveness + dependency report
GET  /health/live                dependency-free liveness
GET  /health/ready               named checks, transactions.strategy
GET  /meta/payment-methods
GET  /meta/delivery-methods
GET  /meta/media-providers
```

**Auth**
```
POST /auth/register                      (rate limited: credentialLimit)
POST /auth/login                         (credentialLimit)
GET  /auth/me                            authGuard
PATCH /auth/me                           authGuard
POST /auth/me/password                   authGuard + credentialLimit
POST /auth/logout                        authGuard
POST /auth/logout-all                    authGuard
POST /auth/password-reset/request        resetLimit, unauthenticated
POST /auth/password-reset/confirm        resetLimit, unauthenticated
```

**Catalog (public)**
```
GET  /catalog/categories
GET  /catalog/products                   paginated, pageSize ≤ 60
GET  /catalog/products/:id
GET  /catalog/stores/:sellerOrStoreId
GET  /catalog/summary
```

**Cart (authGuard)**
```
GET    /cart?deliveryMethod=standard|express
POST   /cart/items                        writeLimit
PATCH  /cart/items/:id                    writeLimit
DELETE /cart/items/:id                    writeLimit
DELETE /cart/items                        writeLimit
```

**Orders (authGuard)**
```
POST /orders                  writeLimit, accepts Idempotency-Key header or body idempotencyKey
GET  /orders
GET  /orders/:id
POST /orders/:id/cancel       writeLimit, body { reason }
```

**Seller** — `POST /seller/register` and `GET /seller/application` need only
auth (an applicant must see their own status before being a seller). Everything
below needs auth + an **active** seller profile (`requireSeller`):
```
POST   /seller/register
GET    /seller/application
GET    /seller/profile
GET    /seller/dashboard
GET    /seller/products
PATCH  /seller/products/:id/status      writeLimit
POST   /seller/products/:id/stock       writeLimit
GET    /seller/inventory/summary
GET    /seller/inventory/adjustments
GET    /seller/orders
GET    /seller/orders/:id
POST   /seller/orders/:id/advance       writeLimit
```

**Admin** (`authGuard` + role `seller_approver`)
```
GET  /admin/sellers?status=pending|active|rejected|suspended
POST /admin/sellers/:id/decision        writeLimit, body { decision, note? }
GET  /admin/sellers/:id/history
```

Zod schemas declared inline in `api-router.ts` (450 lines): `registerSchema`,
`loginSchema`, `profileSchema`, `passwordSchema`, `cartAddSchema`,
`cartPatchSchema`, `addressSchema`, `orderSchema`, `cancelSchema`,
`statusSchema`, `stockSchema`, `cartQuery`, `pageQuery`, `idParam`, `storeParam`,
`passwordResetRequestSchema`, `passwordResetConfirmSchema`,
`applicationStatusQuery`, `applicationDecisionSchema`,
`sellerRegistrationSchema`.

## B5. Repository bundle (`backend/src/repositories/contracts.ts`, 289)

Async contracts, implemented twice: `memory/memory-repositories.ts` (440) and
`mongo/mongo-repositories.ts` (566). `RepositoryBundle` starts with
`ping(): { ok, driver, detail? }`; `SeedBundle extends RepositoryBundle` with
`clear()`.

Repositories: `users`, `sessions`, `categories`, `sellers`, `stores`, `products`,
`carts`, `addresses`, `vouchers`, `promotions`, `orders`, `sellerOrders`,
`payments`, `reviews`, `returnRequests`, `notifications`, `wishlists`,
`inventoryAdjustments` — plus three the frontend does **not** have:

| Extra contract | Methods | Purpose |
| --- | --- | --- |
| `IdempotencyRepository` | `find`, `claim`, `complete`, `release`, `deleteExpired` | unique `(scope, ownerId, key)` claim |
| `PasswordResetRepository` | `findByTokenHash`, `insert`, `markUsed`, `deleteForUser`, `deleteExpired` | hashed single-use tokens |
| `AuditRepository` | `insert`, `listForSubject` | seller approval audit trail |

Notable method-level differences from the frontend contracts: `product.query()`
+ `count()` + `adjustStock()`, `voucher.markUsed()`, `session.deleteExpired()`,
`cart.addItem/patchItem/removeItem/clearSelected`, `inventoryAdjustment
.deleteForReference()`.

Backend entity file `backend/src/domain/entities.ts` (528 lines) mirrors the
frontend types but adds: `Role` includes **`seller_approver`**,
`IdempotencyRecordEntity`, `PasswordResetTokenEntity`, `AuditLogEntity`, and a
`PublicUser` projection (no hash/salt leaves the server).

## B6. Cross-cutting middleware

| Concern | Module | Behaviour |
| --- | --- | --- |
| Request id | `middleware/request-id.ts` | echoes `x-request-id`, exposed in CORS |
| Validation | `middleware/validate.ts` | zod over `body`/`query`/`params`; caps `pageSize` at 60; failures → `validation_failed` with `fields[]` |
| Auth | `middleware/auth.ts` | `requireAuth(auth)`, `requireSeller(sellers)`, `requireRole(...)`, `actorOf(req)`, `bearerToken` |
| Rate limits | `middleware/rate-limit.ts` | keyed by IP + scope (`write`, `credential`, `reset`); sends `retry-after` |
| Errors | `middleware/error-handler.ts` | `notFoundHandler`, `errorHandler` → envelope |
| Response | `response.ts` | `ok(res, data)`, `fail(res, ...)` — the only place the envelope is written |
| CORS | `http/app.ts` | allow-list; native clients send no Origin (allowed), browsers checked; allowed headers include `idempotency-key`; exposes `x-request-id`, `retry-after` |

Error codes live in `errors.ts` and match the client's `ApiErrorCode` set
(`validation_failed`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`unprocessable`, `rate_limited`, `internal_error`, …).

## B7. Checkout atomicity & idempotency

`POST /orders` writes order + seller orders + payment + stock decrements + cart
clear + notifications:

- **Transaction when available**: one `withTransaction`.
- **Compensating writes** when the topology cannot commit — the live strategy is
  reported by `GET /health/ready` as
  `transactions.strategy: "multi-document" | "compensating-writes"`, never left to
  be inferred.
- **Idempotency**: `Idempotency-Key` header or `idempotencyKey` body. Mutual
  exclusion comes from an insert against a unique `(scope, ownerId, key)` index —
  enforced by the database, not read-then-write in app code.
  - same key + same payload → replays the original response
  - same key + different payload → `409 conflict`
  - failed attempt → key released so a corrected retry can succeed
  - the order id is reserved **before** the claim and written into it, so a crash
    between commit and completion is recovered rather than stranded until TTL.
- **Server pricing is authoritative**: client money fields are discarded and
  recomputed (a contract scenario asserts this).

## B8. Password reset & seller approval

**Password reset**
- `request` mails a single-use link, stores only the SHA-256 digest, TTL 30 min.
- Known and unknown addresses get the **identical** response (no enumeration
  oracle).
- `confirm` swaps the password, revokes **every** session, and the token is
  single-use; requesting twice invalidates the first token; garbage/tampered
  tokens are rejected without touching the account; weak passwords are refused by
  validation.
- Both routes unauthenticated and separately rate limited.

**Seller onboarding**
- `POST /seller/register` creates the store + profile as `pending` and grants
  **no** `seller` role — an unreviewed account cannot publish or fulfil, and a
  client cannot grant itself the role.
- An operator with `seller_approver` decides via `POST /admin/sellers/:id/decision`,
  which moves seller status + store visibility + role together and writes an audit
  entry readable at `GET /admin/sellers/:id/history`.
- A decision that changes nothing → `409`, not a silent no-op.

> Frontend contrast: **local mode has no operator surface**, so it opens the store
> on submit rather than stranding applicants as permanently pending.
> `sellerService.approvalIsReviewed` reports which behaviour applies, and the
> onboarding screen describes what will actually happen.

## B9. Tests & contract scenarios

| Suite | Path | Run |
| --- | --- | --- |
| Memory-driver suite | `backend/src/tests/` | `npm run api:test` |
| Mongo suite | `backend/src/tests-mongo/` | (via `test:mongo`) |
| Contract harness | `backend/src/contract/{harness,runner,scenarios}.ts` | `scenarios.ts` = 693 lines |

Scenario coverage (names as written):

- **Checkout idempotency** — identical retry returns the original order; same key
  + different payload → conflict; failed attempt releases the key; keys are
  scoped to their owner (no cross-customer replay); a submission interrupted
  after commit is recovered; a submission that never reached the order is
  released once clearly dead; the `Idempotency-Key` header is honoured; client
  money fields are discarded; a completed key keeps replaying after the cart moves
  on.
- **Expiry** — expiring records come back as real instants, not empty objects.
- **Password reset** — mails a link and stores only a hash; unknown address gets
  the same answer; confirm swaps the password, revokes every session, is
  single-use; tampered token rejected; second request invalidates the first; weak
  password refused by validation.
- **Sessions** — malformed/absent bearer refused; logout-all invalidates only that
  account's sessions.
- **Seller approval** — registration leaves the applicant pending and the seller
  area closed; a customer cannot read the queue or approve anyone (least of all
  themselves); an approver activates + audits + notifies; rejection records the
  reason; suspension closes the area and keeps the audit trail; unknown or
  already-decided application refused; unknown decision field refused instead of
  silently dropped.
- **Health** — liveness is dependency-free; readiness reports named checks; the
  reported transaction strategy matches what the driver can actually do.

## B10. Seed dataset

`backend/src/seed/{dataset,seed,seed-cli}.ts` — `dataset.ts` is 500 lines of
**deterministic dev data** built with the same `shared/` rules
(`effectivePrice`, `roundMoney`). `npm run api:seed` loads it; `--fresh` drops and
re-inserts; it refuses to run when `NODE_ENV=production`. `SEED_ON_START=true`
seeds at boot (refused in production).

> This is **server-side dev seed data**, deliberately separate from the app's
> empty-marketplace guarantee: the Expo app never seeds marketplace content
> itself (A5/A12).

## B11. Production refusals (already enforced)

The process refuses to boot on: wildcard/empty CORS allowlist; `console` or
`smtp` mail transport; default test sender; missing `MONGO_URI`;
`SEED_ON_START=true`; weak `SESSION_SECRET`; negative
`SESSION_MAX_PER_USER`; `MONGO_TRANSACTIONS=true` against a topology that cannot
commit transactions; `ALLOW_MEMORY_DB=true`.

---

# PART C — GAPS, INVARIANTS & PHASE DESIGN NOTES

## C1. Actual remote-mode wiring in the client

> **M18 update.** C1 below is the M7-era reading (three mode branches) and is kept
> for history. Since M14–M17 the client branches on `isRemoteMode()` in
> `auth-gateway`, `bootstrap`, `remote-hydration`, `container`, `checkout-flow`,
> and the `address`, `cart`, `catalog`, `order`, `review`, `seller` and `voucher`
> services — so cart, checkout, orders, returns, reviews, seller workspace,
> addresses and catalogue are server-authoritative. M18 closes the remaining
> read-only gaps (wishlist, store follows, notifications, recently viewed, review
> reads) and adds the public seller stub to the catalogue mirror (see C3 #14). The
> catalogue itself remains a boot-time mirror, not a live per-screen read path.

The client has a complete typed API surface (A14), but **only three seams branch
on mode** (M7 state):

| Seam | Behaviour in remote mode |
| --- | --- |
| `auth-gateway.ts` | `RemoteAuthService` instead of `AuthService` (full auth contract, including password reset) |
| `bootstrap.ts` | health probe + catalogue hydration at boot |
| `seller-service.ts` | `registerSeller` → `POST /seller/register`; `sellerApplication` → `GET /seller/application` |

Everything else — cart, checkout, orders, wishlist, reviews, vouchers,
notifications, addresses, search, returns, inventory, analytics, diagnostics —
**always reads/writes the local repositories**, in both modes.

The catalogue itself is a boot-time mirror (A5), not a live read path.

Consequence: a remote build is an *auth + catalogue + seller application*
integration today, not a fully server-authoritative client. Cart/checkout/orders
would resolve against device data even when a server is configured. This is the
central gap for the backend phase.

## C2. Endpoint parity gaps

### Server has, client does not call (in remote mode)

```
GET  /cart, POST /cart/items, PATCH/DELETE /cart/items/:id, DELETE /cart/items
POST /orders, GET /orders, GET /orders/:id, POST /orders/:id/cancel
GET  /seller/profile, /seller/dashboard, /seller/products
PATCH /seller/products/:id/status, POST /seller/products/:id/stock
GET  /seller/inventory/summary, /seller/inventory/adjustments
GET  /seller/orders, /seller/orders/:id, POST /seller/orders/:id/advance
GET  /admin/sellers, POST /admin/sellers/:id/decision, GET /admin/sellers/:id/history
GET  /meta/* , GET /health/ready
```

(The client already declares all of the non-admin ones in `vanta-api.ts` —
they are one `isRemoteMode()` branch away.)

### Client capabilities with **no** server counterpart

| Capability | Frontend home | Backend status |
| --- | --- | --- |
| Wishlist | `wishlist-service`, `Wishlist` collection | no endpoint, no repository |
| Reviews (create/list/reply) | `review-service` | `ReviewRepository` exists; no endpoints |
| Vouchers (create/manage/validate) | `voucher-service` | `VoucherRepository` exists; no endpoints |
| Promotions | `Promotion` entity | `PromotionRepository` exists; no endpoints |
| Return requests | `order-service` + `/return-request` | `ReturnRequestRepository` exists; no endpoints |
| Notifications | `notification-service` | `NotificationRepository` exists; no endpoints |
| Address book | `address-service` | `AddressRepository` exists; no endpoints (address arrives inside `POST /orders`) |
| Search + search history | `search-service` | no endpoint (client-side filtering only) |
| Recently viewed | `RecentlyViewed` collection | no endpoint |
| Store followers | `StoreFollower` collection | no endpoint |
| Seller store settings (write) | `/seller-store-settings` | `StoreRepository` has `patch`; no endpoint |
| Seller product create/edit (full) | `/seller-product/new`, `/seller-product-edit/[id]` | only status + stock endpoints exist |
| Media upload | `media-service` (`expo-image-picker`, local file URIs) | `GET /meta/media-providers` only; no upload |
| Analytics/diagnostics | `analytics-service`, `diagnostics-service` | dashboard summary only |
| Customer order list beyond `GET /orders` | filters, returns timeline | partial |

### Types with no backend entity

`SearchHistoryEntry`, `RecentlyViewedEntry`, `StoreFollower` exist only on the
device. `IdempotencyRecord`, `PasswordResetToken`, `AuditLog` exist only on the
server (C3).

## C3. Invariants the backend must honour

Derived from Part A; most are already proved by Part B tests.

1. **Envelope** — every response is `{ok,data}` or `{ok:false,error,meta}`; error
   `code` must be one the client knows (A14) so `ApiError` stays typed.
2. **No silent fallback** — the client never falls back to local data in remote
   mode; the server must not return partial success where the client cannot tell.
3. **Server is authoritative** for identity, pricing, stock and order state;
   client money fields are discarded and recomputed from `shared/` rules.
4. **One implementation of the maths** — money rounding, cart grouping, voucher
   evaluation, delivery quoting, order roll-up must keep coming from `shared/`.
   Duplicating them in the server is the failure mode this repo was built to avoid.
5. **Empty marketplace is a product rule** — the app seeds taxonomy only. Server
   seed data must remain opt-in (`SEED_ON_START`, `npm run api:seed`) and never
   production.
6. **Roles cannot be self-granted** — `seller` and `seller_approver` are
   server-side only; `addRole` exists on the gateway because local mode supports
   it, but no client flow escalates.
7. **Seller status, store visibility and role move together**, with an audit
   entry, and a no-op decision is a `409`.
8. **Password reset** is two-step, hashed, single-use, revokes all sessions, and
   answers known/unknown addresses identically.
9. **Checkout is atomic** (transaction or compensating writes, reported by
   `/health/ready`) **and idempotent** (DB-enforced key claim, with
   replay / conflict / release semantics).
10. **Line snapshots stay optional** — `variantId`, `returnedQuantity`,
    `remainingQuantity` must tolerate older records.
11. **Bottleneck roll-up + `allPartsDelivered`** semantics exactly as in A13;
    COD settlement must not depend on the rolled-up status.
12. **Payment simulators keep their fixed values** and their "order created only
    after success" gate; no gateway is contacted.
13. **Catalogue mirror must be replaceable wholesale** — `GET /catalog/*` must be
    able to return the entire catalogue (paged, ≤60/page) so a boot can rebuild
    it, and a withdrawn product must disappear.
14. **Seller display data in remote mode (M18)** — the catalogue mirror now stores
    a *public seller stub* per storefront seller (`id`, `fullName`, `status`,
    `sellerType`), taken from the `seller` pick `GET /catalog/stores/:id` already
    returns. This is required and sufficient for the shared `customerVisibility`
    rule, which resolves the owning seller from the local mirror and hides the
    listing when that seller is missing or suspended; without the stub every
    remote product resolved to `seller_missing` and the storefront rendered empty.
    Private seller fields (national id, bank, pickup address) are never mirrored;
    the owner's full record is still fetched on demand via `/seller/profile` and
    upserted over its stub by `hydrateSellerWorkspace` on session restore. The
    boot-time wholesale catalogue hydration approach is unchanged.

## C4. Candidate phase order (derived from the gaps above)

Not a plan — a reading of where the seams already are, for the design pass:

| Phase | Scope | Existing support to build on |
| --- | --- | --- |
| **1. Client remote wiring** | Branch cart, checkout, orders, seller reads/writes on `isRemoteMode()` (or introduce a gateway like `auth-gateway`) using the already-declared `vantaApi` methods | `auth-gateway.ts` pattern, `vanta-api.ts` surface, `/cart`, `/orders`, `/seller/*` endpoints all implemented |
| **2. Customer writes server-side** | Wishlist, addresses, reviews, returns, notifications, search history | repositories already exist on the server for all except search history/followers |
| **3. Seller authoring** | Product create/edit, store settings, media upload | needs new endpoints; `ProductRepository.patch`/`insert` and `StoreRepository.patch` exist |
| **4. Vouchers & promotions** | seller + platform voucher CRUD and redemption | `VoucherRepository.markUsed` exists; rules already in `shared/voucher-rules` |
| **5. Ops surface** | `seller_approver` admin UI in-app, audit viewing, diagnostics | `GET /admin/*` endpoints already exist; no app screen |
| **6. Hardening** | rate limits, idempotency coverage beyond checkout, pagination for large catalogues, seller public profile endpoint | middleware and harness already in place |

## C5. Open questions for the design pass

1. Should the catalogue mirror be replaced with async reads per screen, or kept
   as the performance/fallback strategy with a refresh path?
2. Where does guest-cart merging live when the server is authoritative (guest
   cart is currently device-only)?
3. Is `seller_approver` an in-app surface or an external/admin tool?
4. What is the media upload path (the app stores local file URIs today)?
5. Do `searchHistory`, `recentlyViewed` and `storeFollowers` move server-side or
   stay device-local by design?
