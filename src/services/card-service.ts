/**
 * Local card payment simulator.
 *
 * This models the shape of a real card checkout (card details -> local
 * validation -> verification OTP -> payment reference) so the customer
 * experience is realistic, but it runs entirely on-device: no payment gateway,
 * no acquirer, no 3-D Secure SDK and no network call of any kind. The card
 * details are validated with the same rules a real form would apply, the
 * verification code is decided locally, and the reference it mints is only ever
 * stored on the VANTA transaction.
 *
 * This is a generic card processor (not any one bank's authentication), and the
 * PAN/CVV are never persisted or transmitted by this simulator.
 *
 * Predictable demo values (documented for development/testing):
 *   number 5555 5555 5555 4444  ·  expiry 12/30  ·  CVV 123  ·  OTP 123456
 *
 * The reference uses the `TRX-VANTA-CARD-XXXXXXXX` shape so it is obviously a
 * local simulation receipt and not a real authorization code.
 */
import { uuid } from '@/utils/id';

export const CARD_DEMO = {
  number: '5555555555554444',
  expiry: '12/30',
  cvv: '123',
  otp: '123456',
  cardholder: 'VANTA TEST',
} as const;

export type CardResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** A generic card network, derived from the number — never a named bank. */
export type CardNetwork = 'Visa' | 'Mastercard' | 'American Express' | 'Discover' | 'UnionPay' | 'Card';

/** Handle the UI holds. The mutable attempt bookkeeping stays inside the service. */
export interface CardSession {
  readonly id: string;
  readonly network: CardNetwork;
  readonly last4: string;
  readonly masked: string;
  readonly expiry: string;
}

export interface CardReceipt {
  readonly reference: string;
  readonly paidAt: string;
}

export interface CardDetails {
  readonly cardholder: string;
  readonly number: string;
  readonly expiry: string;
  readonly cvv: string;
}

interface SessionRecord {
  id: string;
  network: CardNetwork;
  last4: string;
  masked: string;
  expiry: string;
  otp: string;
  issuedAt: number;
  otpVerified: boolean;
  otpAttempts: number;
}

/** How long a generated code stays usable before the customer must start over. */
const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Local OTP for the simulator. A real processor texts/emails a random code; this
 * stays predictable so the demo flow (and the regression harnesses) can drive it
 * without reading the customer's screen.
 */
function generateOtp(): string {
  return CARD_DEMO.otp;
}

function generateReference(): string {
  return `TRX-VANTA-CARD-${uuid().replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;
}

/** Strips spaces and dashes from a typed card number. */
export function normalizeCardNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/** Derives the generic card network from the leading digits. */
export function detectCardNetwork(digits: string): CardNetwork {
  if (/^4/.test(digits)) return 'Visa';
  if (/^5[1-5]/.test(digits)) return 'Mastercard';
  if (/^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  if (/^62/.test(digits)) return 'UnionPay';
  return 'Card';
}

/** Standard Luhn checksum — the same structural check a real form applies. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Validates an MM/YY expiry and rejects anything already in the past. */
export function expiryValid(expiry: string, now: Date = new Date()): boolean {
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return false;
  const year = 2000 + Number(match[2]);
  // Card is valid through the last day of its expiry month.
  const endOfMonth = new Date(year, month, 1).getTime() - 1;
  return endOfMonth >= now.getTime();
}

/** Card processors show a card as •••• 1234 — first network digits hidden. */
export function maskCardNumber(last4: string): string {
  return `•••• ${last4}`;
}

export class CardSimulator {
  private readonly sessions = new Map<string, SessionRecord>();

  /**
   * Validates the card details locally and mints the verification code the
   * customer would receive. No gateway is contacted at any point.
   */
  start(details: CardDetails): CardResult<CardSession> {
    const digits = normalizeCardNumber(details.number);
    if (!luhnValid(digits)) {
      return {
        ok: false,
        message: 'That card number is not valid. For this simulator use 5555 5555 5555 4444.',
      };
    }
    if (!expiryValid(details.expiry)) {
      return { ok: false, message: 'Enter a valid future expiry as MM/YY. For this simulator use 12/30.' };
    }
    const cvv = details.cvv.trim();
    if (!/^\d{3,4}$/.test(cvv)) {
      return { ok: false, message: 'Enter the 3-4 digit security code. For this simulator use 123.' };
    }
    const cardholder = details.cardholder.trim();
    if (cardholder.length < 2) {
      return { ok: false, message: 'Enter the name printed on the card.' };
    }
    const network = detectCardNetwork(digits);
    const last4 = digits.slice(-4);
    const record: SessionRecord = {
      id: `cdx_${uuid().slice(0, 8)}`,
      network,
      last4,
      masked: maskCardNumber(last4),
      expiry: details.expiry.trim(),
      otp: generateOtp(),
      issuedAt: Date.now(),
      otpVerified: false,
      otpAttempts: 0,
    };
    this.sessions.set(record.id, record);
    return {
      ok: true,
      value: { id: record.id, network, last4, masked: record.masked, expiry: record.expiry },
    };
  }

  verifyOtp(session: CardSession, code: string): CardResult<{ network: CardNetwork }> {
    const record = this.sessions.get(session.id);
    if (!record) return { ok: false, message: 'This payment session ended. Start the payment again.' };
    if (Date.now() - record.issuedAt > OTP_TTL_MS) {
      this.sessions.delete(record.id);
      return { ok: false, message: 'That code expired. Start the payment again.' };
    }
    record.otpAttempts += 1;
    if (code.trim() === record.otp) {
      record.otpVerified = true;
      return { ok: true, value: { network: record.network } };
    }
    const left = MAX_OTP_ATTEMPTS - record.otpAttempts;
    if (left <= 0) {
      this.sessions.delete(record.id);
      return { ok: false, message: 'Too many wrong codes. This payment was cancelled — nothing was charged.' };
    }
    return { ok: false, message: `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` };
  }

  /**
   * Final gate. The session is single-use and is dropped the moment it succeeds,
   * so the same card session can never produce a second receipt.
   */
  confirm(session: CardSession): CardResult<CardReceipt> {
    const record = this.sessions.get(session.id);
    if (!record) return { ok: false, message: 'This payment session ended. Start the payment again.' };
    if (!record.otpVerified) return { ok: false, message: 'Verify the code before completing the payment.' };
    this.sessions.delete(record.id);
    return { ok: true, value: { reference: generateReference(), paidAt: new Date().toISOString() } };
  }

  /** Releases a session the customer walked away from. */
  cancel(session: CardSession): void {
    this.sessions.delete(session.id);
  }
}

export const cardService = new CardSimulator();