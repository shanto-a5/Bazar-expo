/**
 * Local bKash payment simulator.
 *
 * This models the shape of a bKash wallet checkout (wallet number -> OTP ->
 * PIN -> payment reference) so the customer experience is realistic, but it
 * runs entirely on-device: no bKash API, no SMS gateway, no merchant account
 * and no network call of any kind. The OTP and PIN are decided locally, and
 * the reference it mints is only ever stored on the VANTA transaction.
 *
 * Predictable demo values (documented for development/testing):
 *   wallet 01700000000  ·  OTP 123456  ·  PIN 12121
 *
 * The reference uses the `TRX-VANTA-XXXXXXXX` shape so it is obviously a local
 * simulation receipt and not a real bKash TrxID.
 */
import { uuid } from '@/utils/id';

export const BKASH_DEMO = {
  wallet: '01700000000',
  otp: '123456',
  pin: '12121',
} as const;

export type BkashResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Handle the UI holds. The mutable attempt bookkeeping stays inside the service. */
export interface BkashSession {
  readonly id: string;
  readonly wallet: string;
  readonly masked: string;
}

export interface BkashReceipt {
  readonly reference: string;
  readonly paidAt: string;
}

interface SessionRecord {
  id: string;
  wallet: string;
  masked: string;
  otp: string;
  issuedAt: number;
  otpVerified: boolean;
  otpAttempts: number;
  pinAttempts: number;
}

/** How long a generated OTP stays usable before the customer must start over. */
const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_PIN_ATTEMPTS = 3;

/**
 * Local OTP for the simulator. Real bKash texts a random code; this stays
 * predictable so the demo flow (and the regression harnesses) can drive it
 * without reading the customer's screen.
 */
function generateOtp(): string {
  return BKASH_DEMO.otp;
}

function generateReference(): string {
  return `TRX-VANTA-${uuid().replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;
}

/** Strips spaces/dashes and an optional +880 / 880 country prefix. */
export function normalizeWallet(raw: string): string | null {
  const digits = raw.trim().replace(/[\s-]/g, '').replace(/^\+?88/, '');
  return /^\d{11}$/.test(digits) ? digits : null;
}

/** bKash shows wallets as 017******000 — first three, six asterisks, last three. */
export function maskWallet(wallet: string): string {
  return `${wallet.slice(0, 3)}******${wallet.slice(-3)}`;
}

export class BkashSimulator {
  private readonly sessions = new Map<string, SessionRecord>();

  /** Validates the wallet locally and mints the OTP the customer would receive. */
  start(rawWallet: string): BkashResult<BkashSession> {
    const wallet = normalizeWallet(rawWallet);
    if (!wallet) {
      return {
        ok: false,
        message: `Enter an 11-digit wallet number. For this simulator use ${BKASH_DEMO.wallet}.`,
      };
    }
    if (!/^01\d{9}$/.test(wallet)) {
      return { ok: false, message: 'That is not a valid bKash wallet. Bangladeshi numbers start with 01.' };
    }
    const record: SessionRecord = {
      id: `bkx_${uuid().slice(0, 8)}`,
      wallet,
      masked: maskWallet(wallet),
      otp: generateOtp(),
      issuedAt: Date.now(),
      otpVerified: false,
      otpAttempts: 0,
      pinAttempts: 0,
    };
    this.sessions.set(record.id, record);
    return { ok: true, value: { id: record.id, wallet: record.wallet, masked: record.masked } };
  }

  /** Re-issues the OTP, which is what "resend" does in the real app. */
  resendOtp(session: BkashSession): BkashSession {
    const record = this.sessions.get(session.id);
    if (!record) return session;
    record.otp = generateOtp();
    record.issuedAt = Date.now();
    record.otpAttempts = 0;
    record.otpVerified = false;
    return { id: record.id, wallet: record.wallet, masked: record.masked };
  }

  verifyOtp(session: BkashSession, code: string): BkashResult<{ wallet: string }> {
    const record = this.sessions.get(session.id);
    if (!record) return { ok: false, message: 'This payment session ended. Start the payment again.' };
    if (Date.now() - record.issuedAt > OTP_TTL_MS) {
      this.sessions.delete(record.id);
      return { ok: false, message: 'That code expired. Send a new OTP to continue.' };
    }
    record.otpAttempts += 1;
    if (code.trim() === record.otp) {
      record.otpVerified = true;
      return { ok: true, value: { wallet: record.wallet } };
    }
    const left = MAX_OTP_ATTEMPTS - record.otpAttempts;
    if (left <= 0) {
      this.sessions.delete(record.id);
      return { ok: false, message: 'Too many wrong codes. This payment was cancelled — nothing was charged.' };
    }
    return {
      ok: false,
      message: `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`,
    };
  }

  /**
   * Final gate. The session is single-use and is dropped the moment it succeeds,
   * so the same wallet session can never produce a second receipt.
   */
  verifyPin(session: BkashSession, pin: string): BkashResult<BkashReceipt> {
    const record = this.sessions.get(session.id);
    if (!record) return { ok: false, message: 'This payment session ended. Start the payment again.' };
    if (!record.otpVerified) return { ok: false, message: 'Verify the OTP before entering your PIN.' };
    record.pinAttempts += 1;
    if (pin.trim() === BKASH_DEMO.pin) {
      this.sessions.delete(record.id);
      return { ok: true, value: { reference: generateReference(), paidAt: new Date().toISOString() } };
    }
    const left = MAX_PIN_ATTEMPTS - record.pinAttempts;
    if (left <= 0) {
      this.sessions.delete(record.id);
      return { ok: false, message: 'Incorrect PIN too many times. Payment cancelled — nothing was charged.' };
    }
    return { ok: false, message: `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.` };
  }

  /** Releases a session the customer walked away from. */
  cancel(session: BkashSession): void {
    this.sessions.delete(session.id);
  }
}

export const bkashService = new BkashSimulator();