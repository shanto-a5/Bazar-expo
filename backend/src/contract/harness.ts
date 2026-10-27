/**
 * Shared contract harness (M8).
 *
 * The *same* scenario code has to pass against both drivers: the in-memory
 * bundle used for fast runs and the real MongoDB replica set used for parity and
 * transaction proofs. So everything driver-agnostic lives here — the HTTP client,
 * the envelope shape, the seed reference data and the server bootstrap — and each
 * suite supplies only a repository bundle.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../http/app';
import { createContext, type AppContext } from '../app-context';
import type { RepositoryBundle, SeedBundle } from '../repositories/contracts';
import type { MailTransport, MailMessage } from '../mail/mail';

export interface ApiResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: { field: string; message: string }[] };
  meta?: { requestId: string };
}

export interface TestHarness {
  context: AppContext;
  repos: RepositoryBundle;
  baseUrl: string;
  close(): Promise<void>;
  request<T = unknown>(path: string, init?: RequestInit & { token?: string }): Promise<ApiResult<T>>;
}

/**
 * A mail transport that records instead of sending. Contract scenarios assert on
 * `sent`, so password-reset behaviour is verifiable without SMTP, a console log
 * or a network.
 */
export function recordingMail(): MailTransport & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    name: 'recording',
    configured: true,
    async send(message) {
      sent.push({ ...message });
    },
  };
}

export interface ServeOptions {
  repos: RepositoryBundle;
  mail?: MailTransport;
}

/**
 * Boots the real Express app over a real socket on an ephemeral port. Both suites
 * call this, so a route, middleware or envelope change is exercised identically
 * no matter which datastore is underneath.
 */
export async function serveHarness(options: ServeOptions): Promise<TestHarness> {
  const context = createContext(options.repos, options.mail ?? recordingMail());
  const app = createApp(context);

  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    context,
    repos: options.repos,
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    async request<T>(path: string, init: RequestInit & { token?: string } = {}) {
      const { token, ...rest } = init;
      const headers = new Headers(rest.headers);
      headers.set('accept', 'application/json');
      if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      if (token) headers.set('authorization', `Bearer ${token}`);
      const response = await fetch(`${baseUrl}/api/v1${path}`, { ...rest, headers });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as T) : (undefined as T);
      return { status: response.status, body, headers: response.headers };
    },
  };
}

export const SEED = {
  customerEmail: 'ayesha@vanta.test',
  otherCustomerEmail: 'tanvir@vanta.test',
  sellerEmail: 'nadia@brightloop.test',
  otherSellerEmail: 'farhan@urbanfold.test',
  approverEmail: 'operations@vanta.test',
  password: 'VantaPass1!',
  productActive: 'prd_seed_1',
  productCheap: 'prd_seed_4',
  productOtherSeller: 'prd_seed_5',
  productOutOfStock: 'prd_seed_7',
  productPausedStore: 'prd_seed_2',
  voucherPlatform: 'VANTA10',
  voucherSeller: 'BRIGHT150',
  voucherShipping: 'FREESHIP',
  address: {
    label: 'Home',
    recipientName: 'Ayesha Rahman',
    phone: '+8801700000001',
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Banani',
    addressLine: 'House 12, Road 7, Block C',
    postalCode: '1213',
    isDefault: true,
  } as const,
  /**
   * A complete seller registration. A test overrides single fields to assert one
   * rejection at a time rather than asserting a whole invalid payload.
   */
  sellerRegistration: {
    fullName: 'Ayesha Rahman',
    phone: '+8801700000001',
    email: 'ayesha@vanta.test',
    nationalId: '1990123456789',
    sellerType: 'individual',
    storeName: 'Ayesha Studio',
    storeDescription: 'Handmade ceramics and small-batch tableware.',
    storeLogo: '',
    storeBanner: '',
    pickupDivision: 'Dhaka',
    pickupDistrict: 'Dhaka',
    pickupArea: 'Banani',
    pickupAddressLine: 'House 12, Road 7, Block C',
    returnDivision: 'Dhaka',
    returnDistrict: 'Dhaka',
    returnArea: 'Banani',
    returnAddressLine: 'House 12, Road 7, Block C',
    bankName: 'Test Bank',
    accountName: 'Ayesha Rahman',
    accountNumber: '001234567890',
    branch: 'Banani',
    agreement: {
      marketplaceTerms: true,
      sellerPolicies: true,
      productAuthenticity: true,
      fulfillmentResponsibility: true,
    },
  } as const,
};

export async function signIn(harness: TestHarness, email: string, password = SEED.password): Promise<string> {
  const result = await harness.request<Envelope<{ token: string }>>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (result.status !== 200 || !result.body.data) {
    throw new Error(`sign-in failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body.data.token;
}

export type { RepositoryBundle, SeedBundle };
