/**
 * Server configuration (M7-C / M8-A).
 *
 * Every value is read once at boot and validated. Secrets live here and only
 * here — no module outside `config/` and `services/auth.service.ts` may log or
 * return them. Nothing in this file is ever sent to a client.
 *
 * M8 rule: a production process refuses to boot on a configuration it cannot
 * honour. The specific refusals are collected and reported together, so a
 * misconfigured deploy is fixed in one pass instead of one variable per restart.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as dotenv from 'dotenv';

/**
 * Locate `backend/.env` whether we are running from `src` (ts-node) or from
 * `dist` (compiled). The first existing candidate wins; when none exists we fall
 * back to the real process environment (CI, container secrets, `npm test`).
 */
function resolveEnvFile(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const envFile = resolveEnvFile();
if (envFile) dotenv.config({ path: envFile });

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new ConfigError(`Missing required environment variable: ${name}`);
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ConfigError(`${name} must be a positive integer.`);
  return parsed;
}

/**
 * For settings where `0` is a meaningful value rather than a mistake.
 *
 * `SESSION_MAX_PER_USER=0` is documented as "no cap", so validating it with
 * `int()` made the documented configuration impossible to express: the process
 * refused to start on the one value it documented.
 */
function nonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ConfigError(`${name} must be zero or a positive integer.`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * M8: collect every production refusal before throwing, so one boot reports all
 * of them. Previously each problem threw on its own, which turned a deploy with
 * three missing variables into three failed restarts.
 */
const problems: string[] = [];

const corsOrigins = isProduction
  ? list('CORS_ORIGINS', [])
  : list('CORS_ORIGINS', ['http://127.0.0.1:8099', 'http://localhost:8081']);
if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not be "*".');
if (isProduction && corsOrigins.length === 0) {
  problems.push('CORS_ORIGINS must list the exact web origins allowed to call the API.');
}

const sessionSecret = isTest
  ? randomBytes(32).toString('hex')
  : optional('SESSION_SECRET', randomBytes(32).toString('hex'));
if (isProduction && (sessionSecret === 'dev-only-change-me' || sessionSecret.length < 32)) {
  problems.push('SESSION_SECRET must be a unique value of at least 32 characters in production.');
}

const allowMemoryDb = bool('ALLOW_MEMORY_DB', false);
if (isProduction && allowMemoryDb) {
  problems.push('ALLOW_MEMORY_DB must be false in production: a RAM datastore is not a datastore.');
}

const mongoUri = process.env.MONGO_URI && process.env.MONGO_URI.trim() !== '' ? process.env.MONGO_URI.trim() : null;
if (isProduction && !mongoUri) {
  problems.push('MONGO_URI is required in production. The in-memory driver is development-only.');
}

/**
 * M8: transactions. Checkout prefers a real multi-document transaction and
 * falls back to compensating writes only when the deployment has none. Default
 * stays on, but a production operator may set MONGO_TRANSACTIONS=false, in which
 * case `/health/ready` reports the weaker guarantee instead of hiding it.
 */
const transactionsEnabled = bool('MONGO_TRANSACTIONS', true);

/**
 * M8: mail. A password reset is only real if something can carry the token, so
 * the transport is part of the production contract: `console` is refused there
 * (it would print reset links into a log collector) and the `http` transport
 * needs an endpoint and a sender.
 */
const MAIL_PROVIDERS = ['console', 'http', 'smtp'] as const;
type MailProvider = (typeof MAIL_PROVIDERS)[number];
const rawMailProvider = optional('MAIL_PROVIDER', isProduction ? '' : 'console');
if (!MAIL_PROVIDERS.includes(rawMailProvider as MailProvider)) {
  problems.push(`MAIL_PROVIDER must be one of ${MAIL_PROVIDERS.join(', ')} (got "${rawMailProvider}").`);
}
const mailProvider = (MAIL_PROVIDERS.includes(rawMailProvider as MailProvider) ? rawMailProvider : 'console') as MailProvider;
const mailFrom = optional('MAIL_FROM', 'no-reply@vanta.test');
const mailEndpoint = optional('MAIL_HTTP_ENDPOINT', '');
const mailApiKey = optional('MAIL_HTTP_API_KEY', '');
if (isProduction) {
  if (mailProvider === 'console') {
    problems.push('MAIL_PROVIDER must not be "console" in production: reset links must not be written to a log.');
  }
  if (mailProvider === 'http' && mailEndpoint === '') {
    problems.push('MAIL_HTTP_ENDPOINT is required when MAIL_PROVIDER=http.');
  }
  if (mailProvider === 'smtp') {
    // The `smtp` transport exists in the type union so a deployment can name it,
    // but no SMTP client is bundled. Booting in production and discovering that at
    // the moment a customer asks for a reset link is the worst time to find out.
    problems.push('MAIL_PROVIDER=smtp is not available in this build; use MAIL_PROVIDER=http with a mail API endpoint.');
  }
  if (mailFrom === 'no-reply@vanta.test') {
    problems.push('MAIL_FROM must be a real sender address in production.');
  }
}

const seedOnStart = bool('SEED_ON_START', false);
if (isProduction && seedOnStart) {
  problems.push('SEED_ON_START must be false in production: the dataset is demo data, not content.');
}

if (problems.length > 0) {
  throw new ConfigError(
    `Refusing to start with ${problems.length} configuration problem${problems.length === 1 ? '' : 's'}:\n` +
      problems.map((problem) => `  - ${problem}`).join('\n'),
  );
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  corsOrigins: string[];
  bodyLimit: string;
  apiBasePath: string;
  mongoUri: string | null;
  allowMemoryDb: boolean;
  /** M8: when false, checkout uses compensating writes and readiness says so. */
  transactionsEnabled: boolean;
  sessionSecret: string;
  sessionTtlDays: number;
  /** M8: cap on concurrent live sessions per account; 0 disables the cap. */
  sessionMaxPerUser: number;
  bcryptRounds: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  authRateLimitMax: number;
  /** M8: per-IP limit on the unauthenticated password-reset request endpoint. */
  passwordResetRateLimitMax: number;
  seedOnStart: boolean;
  /** M8: password reset lifetime, in minutes. */
  passwordResetTtlMinutes: number;
  /** M8: how long a checkout idempotency key stays replayable, in hours. */
  idempotencyTtlHours: number;
  mailProvider: MailProvider;
  mailFrom: string;
  mailEndpoint: string;
  mailApiKey: string;
  /** M8: base URL used to build the reset link that is mailed out. */
  publicAppUrl: string;
}

export const config: AppConfig = {
  nodeEnv,
  isProduction,
  isTest,
  port: int('PORT', 4000),
  corsOrigins,
  bodyLimit: optional('BODY_LIMIT', '100kb'),
  apiBasePath: '/api/v1',
  mongoUri,
  allowMemoryDb,
  transactionsEnabled,
  sessionSecret,
  sessionTtlDays: int('SESSION_TTL_DAYS', 30),
  sessionMaxPerUser: nonNegativeInt('SESSION_MAX_PER_USER', 10),
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: int('RATE_LIMIT_MAX', 60),
  authRateLimitMax: int('AUTH_RATE_LIMIT_MAX', 10),
  passwordResetRateLimitMax: int('PASSWORD_RESET_RATE_LIMIT_MAX', 5),
  seedOnStart,
  passwordResetTtlMinutes: int('PASSWORD_RESET_TTL_MINUTES', 30),
  idempotencyTtlHours: int('IDEMPOTENCY_TTL_HOURS', 24),
  mailProvider,
  mailFrom,
  mailEndpoint,
  mailApiKey,
  publicAppUrl: optional('PUBLIC_APP_URL', 'http://127.0.0.1:8099/reset-password'),
};

/** Secrets are described by shape, never by value. */
export function describeConfig(): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    apiBasePath: config.apiBasePath,
    database: config.mongoUri ? 'mongodb' : config.allowMemoryDb ? 'in-memory (development only)' : 'unconfigured',
    transactions: config.mongoUri ? (config.transactionsEnabled ? 'multi-document' : 'compensating-writes') : 'not-applicable',
    corsOrigins: config.corsOrigins,
    sessionTtlDays: config.sessionTtlDays,
    sessionMaxPerUser: config.sessionMaxPerUser,
    bcryptRounds: config.bcryptRounds,
    mail: { provider: config.mailProvider, from: config.mailFrom, endpoint: config.mailProvider === 'http' ? config.mailEndpoint : null },
    passwordResetTtlMinutes: config.passwordResetTtlMinutes,
    idempotencyTtlHours: config.idempotencyTtlHours,
  };
}

/**
 * M8 readiness: the non-secret facts a probe needs to decide whether this process
 * can serve traffic, and what guarantees it is actually offering. `ok` is false
 * whenever a required dependency is not really usable.
 */
export function readinessChecks(database: { ok: boolean; driver: string; detail?: string }): {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
} {
  const checks: { name: string; ok: boolean; detail: string }[] = [
    {
      name: 'database',
      ok: database.ok,
      detail: database.ok ? `driver=${database.driver}` : database.detail ?? 'unreachable',
    },
    {
      name: 'sessions',
      ok: Boolean(config.sessionSecret) || config.isTest,
      detail: config.isTest ? 'ephemeral test secret' : 'secret configured',
    },
    {
      name: 'cors',
      ok: config.corsOrigins.length > 0,
      detail: config.corsOrigins.length > 0 ? `${config.corsOrigins.length} origin(s)` : 'no origins allowed',
    },
    {
      name: 'mail',
      // Readiness does not demand a working mail server, only that a transport is
      // actually selected, so a password reset is never a silent no-op.
      ok: config.mailProvider !== 'console' || !config.isProduction,
      detail: `provider=${config.mailProvider}`,
    },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
