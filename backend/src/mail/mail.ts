/**
 * Outbound mail transport (M8-G).
 *
 * M7 could not implement password reset because nothing could carry the token.
 * This module is that "something": a tiny interface with two real
 * implementations, chosen once at boot from `MAIL_PROVIDER`.
 *
 * The point of the abstraction is honesty about capability:
 *   - `console` writes the message to stdout. That is genuinely useful in
 *     development and genuinely unacceptable in production, so the config
 *     validator refuses it there rather than letting a deploy believe it can mail.
 *   - `http` POSTs the message to a configured mail API. It is provider-neutral
 *     on purpose: the repo does not take a dependency on one vendor's SDK, and
 *     the shape is asserted by tests.
 *   - `smtp` is declared so a deployment can select it, and it reports itself as
 *     unconfigured unless an endpoint is set. It is NOT a claim that SMTP works.
 *
 * No service imports a concrete transport: `AuthService` depends on the
 * `MailTransport` interface, so a test can hand it a recorder and assert that a
 * reset mail was produced without a network or a log scrape.
 */
import { config } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  /** Reported by `/health/ready` so a probe can see what is really wired up. */
  readonly name: string;
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

interface RecordedMessage extends MailMessage {
  at: string;
}

/**
 * Bounded ring buffer of what was sent, for tests and for a developer running the
 * server locally. Deliberately disabled in production: a reset link must not sit
 * in process memory beyond the moment it is used.
 */
const recorded: RecordedMessage[] = [];
const RECORD_LIMIT = 20;

function record(message: MailMessage): void {
  if (config.isProduction) return;
  recorded.push({ ...message, at: new Date().toISOString() });
  if (recorded.length > RECORD_LIMIT) recorded.shift();
}

/** Test/dev seam: everything sent so far, oldest first. */
export function recordedMessages(): readonly RecordedMessage[] {
  return recorded;
}

export function clearRecordedMessages(): void {
  recorded.length = 0;
}

export class ConsoleMailTransport implements MailTransport {
  readonly name = 'console';
  readonly configured = true;

  async send(message: MailMessage): Promise<void> {
    record(message);
    console.log(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}

export class HttpMailTransport implements MailTransport {
  readonly name = 'http';
  readonly configured = Boolean(config.mailEndpoint);

  constructor(
    private readonly endpoint: string = config.mailEndpoint,
    private readonly apiKey: string = config.mailApiKey,
    private readonly from: string = config.mailFrom,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (!this.endpoint) {
      throw new Error('MAIL_HTTP_ENDPOINT is not configured; the mail transport cannot deliver.');
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      // The body of a third-party error page is never surfaced to the caller.
      throw new Error(`Mail transport responded ${response.status}.`);
    }
    record(message);
  }
}

/**
 * Selected once per process. An unconfigured transport fails loudly on send
 * rather than silently dropping a password reset.
 */
export function createMailTransport(): MailTransport {
  switch (config.mailProvider) {
    case 'http':
      return new HttpMailTransport();
    case 'smtp':
      // No SMTP client is bundled. Selecting `smtp` without an endpoint is an
      // explicit, visible misconfiguration rather than a pretend integration.
      return {
        name: 'smtp',
        configured: false,
        async send() {
          throw new Error('MAIL_PROVIDER=smtp is declared but no SMTP client is configured in this build.');
        },
      };
    case 'console':
    default:
      return new ConsoleMailTransport();
  }
}
