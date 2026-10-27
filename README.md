# Vanta

A multi-seller marketplace: customers browse stores, build a cart across sellers,
check out with per-seller delivery splits, and sellers run their own catalogue,
inventory and fulfilment. Built with Expo Router and backed by an Express/MongoDB
API.

## Remote-only (M19)

The app is server-authoritative. The Vanta API is the datastore for identity,
the cart, checkout, orders, returns, reviews, wishlist, store follows, addresses,
notifications, the catalogue and the seller workspace. The former on-device
"local marketplace" simulator and its `EXPO_PUBLIC_API_MODE` switch were removed
in M19; there is no runtime mode switch and no local fallback.

```bash
$env:EXPO_PUBLIC_API_BASE_URL="http://127.0.0.1:8000"   # required
npm run web
```

Three rules keep the boundary clear:

1. **The server is the source of truth.** The device holds a mirror/cache of the
   catalogue and the signed-in user's server lists purely so the app's synchronous
   read paths keep working. The mirror is replaced wholesale on each boot and is
   never an alternate datastore.
2. **There is no fallback.** If the API is unreachable, the app reports the
   failure. It never quietly serves local data — a marketplace showing a stale
   local catalogue next to a server-backed cart is worse than one showing an error.
3. **Only public config reaches the client.** The client receives a base URL. The
   session secret, database URI and payment configuration stay on the server, and
   the app only ever holds an opaque bearer token.

### What the app gets from the server

- Boots against `/api/v1/health`, which reports the datastore the server actually
  uses, and warns when that is the non-durable in-memory driver.
- Registers a 401 handler so a token the server rejects clears the stored copy and
  returns the UI to signed-out instead of retrying forever.
- Validates the stored token against `/auth/me` on every boot; a token the server
  does not recognise means signed out.
- Mirrors the **catalogue** (categories, products, stores, and the public identity
  of the sellers behind those stores) into the local database so the app's many
  synchronous read paths keep working. Sellers are mirrored as public stubs only
  (`id`, `fullName`, `status`, `sellerType`) because the shared catalog visibility
  rule needs the owning seller's status; private fields (national id, bank, pickup)
   are never mirrored — the owner's full record is fetched on demand. The mirror is a cache,
   replaced wholesale on each boot — never a source of truth.
- Pages the catalogue at the size the API accepts (`pageSize` is capped at 60) and
  stops on a short page, so a large catalogue hydrates instead of failing the boot.
- Mirrors the signed-in customer's **wishlist**, **followed stores**, **addresses**,
  **orders**, **notifications**, **reviews** (own list and per-product lists) and
  **recently viewed** history into the local database on boot and sign-in, and keeps
  each list server-authoritative: mutations call the API and the response replaces the
  mirror. Search history stays on-device.
- Exposes **"Sign out of all devices"** in Settings, which revokes every server
  session for the account (not just the current device).

### What stays on device

The API is authoritative for auth, health, the catalogue mirror, the cart, checkout,
orders, returns, reviews, wishlist, store follows, recently viewed, addresses,
notifications and the seller workspace. The only intentionally local-only state is
**search history** and the **guest cart** (a signed-out basket held on device until
sign-in). The catalogue mirror is a boot-time cache; it is replaced wholesale on
each boot and is never a source of truth.

### Bundle impact (M19)

Removing the simulator and its mode switch shrank the production web entry bundle
from **1,915,695 bytes** to **1,864,219 bytes** — a reduction of **51,476 bytes
(~2.7%)**. The numbers come from two `expo export --platform web` runs (before and
after) with `EXPO_PUBLIC_API_BASE_URL` set and `NODE_ENV=production`; the export
directories themselves are generated artifacts and are not committed.

### Password recovery and seller onboarding (M8)

Both flows are server-backed; the seller application is always reviewed.

**Password recovery** is a two-step request/confirm. The server mails a single-use
link and answers a known and an unknown address identically. The request proves an
address is reachable and the confirm proves possession of the mailed token; a
successful reset revokes every session.

**Seller applications** are reviewed. `POST /seller/register` records the profile
as `pending` and grants nothing, so an unreviewed account cannot list products or
fulfil orders; an operator with `seller_approver` decides through
`POST /admin/sellers/:id/decision`, which moves the seller status, the store
visibility and the role together.

## bKash payment simulator

Choosing **bKash** at checkout opens a dedicated, bKash-styled payment sheet that
recreates the real wallet checkout locally: **wallet number → OTP → PIN → receipt**.
It is a simulator, not an integration — no bKash API, no SMS gateway, no merchant
account, and no network call of any kind. The OTP and PIN are decided on-device and
the receipt mints a local `TRX-VANTA-XXXXXXXX` reference that is stored on Vanta's own
payment transaction.

**Predictable demo values** (shown in the UI, for development and testing):

| Step | Value |
| --- | --- |
| Wallet number | `01700000000` |
| OTP | `123456` |
| bKash PIN | `12121` |

**How it stays wired to the real payment architecture.** bKash, Nagad and card are the
methods that are *not* settled by pressing "Place order". The Review step's final button
hands off to that method's payment sheet, and the order (with its existing
`PaymentTransaction`) is only created after the sheet reports success — carrying the
sheet's `TRX-VANTA-…` reference. A rejected wallet/card, a wrong OTP/PIN/code, or
cancelling/closing the sheet creates no order at all, so a failed or abandoned payment can
never mark an order paid. Each session is single-use, so one payment session can never
produce a second charge; the usual `orderService` double-submit guard still backstops
repeat taps. Cash on delivery is unchanged and still settles on delivery.

> Values live in `src/services/bkash-service.ts` (`BKASH_DEMO`) and the sheet is
> `src/modules/checkout/bkash-payment.tsx`. The bKash brand colours are the only
> non-Vanta palette and live in `src/theme/tokens.ts` (`bkashBrand`).

## Nagad payment simulator

Choosing **Nagad** opens a Nagad-styled sheet with the same wallet flow as bKash:
**wallet number → OTP → PIN → receipt**. Like bKash it is fully on-device — no Nagad API,
no SMS gateway, no merchant account, no network call — and it mints a local
`TRX-VANTA-NAGAD-XXXXXXXX` reference stored on Vanta's own payment transaction.

**Predictable demo values** (shown in the UI):

| Step | Value |
| --- | --- |
| Wallet number | `01800000000` |
| OTP | `123456` |
| Nagad PIN | `12121` |

The sheet uses the same single-use session, OTP expiry, attempt limits and
"create the order only on success" gate as bKash.

> Values live in `src/services/nagad-service.ts` (`NAGAD_DEMO`) and the sheet is
> `src/modules/checkout/nagad-payment.tsx`. The Nagad brand colours live in
> `src/theme/tokens.ts` (`nagadBrand`).

## Card payment simulator

Choosing **Card** opens a generic card sheet: **card details → verification code →
receipt**. This is a **generic processor** — it deliberately does not imitate any one
bank's authentication. The card details are validated on-device with the usual rules
(Luhn checksum, `MM/YY` expiry that must not be in the past, 3–4 digit CVV, cardholder
name, and a card network derived from the leading digits). No gateway, acquirer or 3-D
Secure SDK is contacted, and the PAN/CVV are never persisted. It mints a local
`TRX-VANTA-CARD-XXXXXXXX` reference stored on Vanta's own payment transaction.

**Predictable demo values** (shown in the UI):

| Step | Value |
| --- | --- |
| Card number | `5555 5555 5555 4444` |
| Expiry | `12/30` |
| CVV | `123` |
| Verification code | `123456` |

As with the wallets, the order is only created after the sheet reports success, and the
session is single-use.

> Values live in `src/services/card-service.ts` (`CARD_DEMO`) and the sheet is
> `src/modules/checkout/card-payment.tsx`. The card sheet is intentionally unbranded and
> reads its accent from the VANTA primary (`cardBrand` in `src/theme/tokens.ts`).

## Navigation (M10-N1)

> **Back always means "the immediately previous screen in the navigation
> history."**

This holds on Android system back, the iOS back button, the iOS left-edge
swipe, and Vanta's own back button, because none of them are special-cased.

**How it works.** The root layout is a native `Stack` hosting the three route
groups (`(home)`, `(seller)`, `(auth)`), and each group is a stack in its own
right. Expo Router maps Android hardware back onto the navigator's `goBack()`
and iOS uses the native edge swipe, so Vanta registers no `BackHandler` and no
`onBackPress` — overriding either would break the rule. Stack options live in
one place, `src/modules/navigation/stack-options.ts`.

The root deliberately uses a `Stack` and **not** a `Slot`. A `Slot` renders only
the matched child, so crossing into `(auth)` unmounted `(home)` and threw its
stack state away: signing in rebuilt the customer shell from its anchor, and
Back landed on Home instead of the screen you came from. A `Stack` keeps each
group mounted, so every group keeps its own history.

**Two rules for writing navigation:**

| Intent | Use |
| --- | --- |
| Moving to another screen | `router.push(...)` — grows history |
| Switching primary destination (dock tabs) | `router.navigate(...)` — reuses history |
| Crossing a real state boundary | `router.replace(...)` — justified below |

`replace()` is legitimate for: signing out, abandoning a flow that must not be
re-submitted, dead-end "not available" states, and lateral jumps to a sibling
list that is not the group anchor. It is **not** for ordinary screen-to-screen
movement — using it there is what makes back skip screens.

Reaching a group's own anchor (`/seller-dashboard` from a seller screen) uses
`navigate()`, not `replace()`: that anchor is already in the group's stack, so
`navigate` reuses the existing entry while `replace` would delete the screen
being left.

**Adding a screen.** Put it inside an existing group and it inherits native
back, the iOS gesture and the deep-link anchor automatically. Do not add a
`Stack` of your own, and do not hand-roll a back handler. If the screen needs a
visible control, render `<BackButton />` from `@/components/back-button`:

```tsx
// pops real history; falls back only when the stack is empty
<BackButton fallbackHref="/orders" />
```

`fallbackHref` is for root and deep-link states where there genuinely is no
previous screen, and must be a real destination for that screen. With no history
and no fallback, `BackButton` renders nothing rather than showing a dead
control. **There is deliberately no global "back to Home" helper.**

**Deep links.** Each group declares an anchor (`unstable_settings.anchor`), so
opening a product cold mounts the marketplace home beneath it and a seller order mounts
the seller dashboard. Back then lands somewhere real instead of nowhere.

**Auth interrupts a flow without swallowing it.** A guarded route (`withSession`,
`withSellerCapability`) *pushes* `(auth)/login` with a `?next=` and parks itself;
it never redirects, because a redirect is a replace and would unmount the group
the user came from. After a successful sign-in the auth screen *pops* back
instead of navigating to `next`, so the guarded screen re-renders underneath with
its history intact:

```
Cart → Checkout → Login → Checkout → Back → Cart
```

`?next=` is validated against the real route table
(`authRedirectHref`), so it cannot become an open redirect. A **cold** visit to
`/login` (no `next`) still replaces into the customer shell, because there is
nothing underneath to return to.

**Predictive back is off on purpose.** `android.predictiveBackGestureEnabled`
is `false` in `app.json`: the pinned `react-native-screens@4.26.2` implements back
only through the legacy `OnBackPressedCallback`, so opting into
`enableOnBackInvokedCallback` would leave Android system back unhandled rather
than animated. Turn it on with a screens release that supports it.

**`fullScreenGestureEnabled` is off on purpose.** A full-screen swipe would fight
the horizontal product rails in `index`, `browse`, `product/[id]` and the
discovery filters. The standard left-edge `gestureEnabled` swipe is on, which is
the gesture iOS reserves for back.

## The API

See [`backend/README.md`](backend/README.md) for endpoints, configuration,
security properties and known limitations.

```bash
npm run api:dev     # start the API
npm run api:seed    # load the deterministic dev dataset
npm run api:test    # in-memory driver
npm --prefix backend run test:mongo   # real MongoDB replica set
```

## Verifying

```bash
npm run verify        # typecheck, lint, route/a11y/security audits
npm run verify:api    # backend typecheck + in-memory tests
npm run verify:all    # both
```

`audit:a11y` currently reports 4 pre-existing `fontSize: 10` findings in
`src/app/(home)/index.tsx`, `src/app/(seller)/seller-dashboard.tsx` and
`src/modules/seller/seller-ui.tsx`. They are untouched by the empty-marketplace
work and are listed here so the red step is not mistaken for a new failure.

## The empty marketplace

Vanta ships **no demo data**. A first launch writes exactly one thing: the
category taxonomy in `src/taxonomy/index.ts`, because `catalogService.validateDraft`
rejects a product whose `categoryId` does not resolve, so without a taxonomy no
real seller could publish a real product. Everything else — products, sellers,
stores, accounts, orders, payments, reviews, vouchers, promotions, followers,
carts, wishlists, addresses, notifications, inventory — is created only by a real
person going through the real flow.

```bash
npm run export:web     # build the static export
npm run audit:empty    # boot it against empty storage and prove it stays empty
```

`scripts/audit-empty.cjs` replaces the old `audit:seed`, which asserted the
opposite. It now checks that a fresh launch writes no marketplace records, that
the taxonomy *is* installed, that a restart changes nothing, that emptying the
data yourself does not get silently re-seeded, and that Seller Mode defaults to
OFF. It also keeps the referential-integrity and money checks, which is what
catches a future re-seed immediately.

**Seller Mode.** A persisted, device-level view preference (default OFF) in
Settings. Every launch reads it: OFF opens the customer shop, ON opens Seller
Center *if and only if* the restored session is an approved seller. It is not an
access grant — `useSession().isSeller` and `withSellerCapability` remain the only
authority — and turning it on for a non-seller is refused with an explanation
before anything is written. It deliberately does not fire on a deep link, and it
runs once per launch rather than on every navigation, so pressing Back out of
Seller Center is not fought by a redirect.

A device that ran an older build still holds the old demo dataset in
AsyncStorage. `purgeLegacyDemoData` uses the removed `vanta.meta.seeded` marker as
a one-time trigger to clear those collections, so an upgrade lands in the same
empty state a fresh install gets. Sessions and reset digests are left alone:
wiping those would sign a real person out of their own account.

---

# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
