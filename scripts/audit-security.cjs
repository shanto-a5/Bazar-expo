/**
 * Ownership and secret-handling audit (M6-P / M6-Q).
 *
 * The marketplace has no server, so the only place authorisation can happen is
 * inside the services. This script checks the two properties that are easy to
 * lose in a refactor:
 *
 *   1. every seller-facing service method takes the acting seller and verifies
 *      that the target record belongs to them,
 *   2. no screen reaches into a repository or storage directly, and no
 *      credential is stored in plain text.
 *
 *   node scripts/audit-security.cjs
 *
 * Exit code 1 means a rule was violated.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const findings = [];
const add = (rule, where, message) => findings.push({ rule, where, message });

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(file, 'utf8');

const appFiles = files.filter((file) => file.includes(`${path.sep}app${path.sep}`));
const serviceFiles = files.filter((file) => file.includes(`${path.sep}services${path.sep}`));

// 1. Screens must not touch infrastructure directly.
for (const file of appFiles) {
  const source = read(file);
  source.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    if (/getContainer\(/.test(line)) {
      add('layering.screen-uses-container', `${rel(file)}:${index + 1}`, 'A screen calls getContainer() directly.');
    }
    if (/from '@\/repositories/.test(line) || /from '@\/database/.test(line) || /from '@\/storage/.test(line)) {
      add('layering.screen-imports-repository', `${rel(file)}:${index + 1}`, `A screen imports infrastructure: ${line.trim()}`);
    }
    if (/\bAsyncStorage\b/.test(line)) {
      add('layering.screen-uses-storage', `${rel(file)}:${index + 1}`, 'A screen touches AsyncStorage directly.');
    }
  });
}

// 2. Mutating seller-scoped service methods must verify ownership.
// Read-only listings (list*/get*ForSeller) are scoped by a repository filter, so
// the check that matters is on every write path.
const METHOD = /^\s{2}(?:async\s+)?([a-zA-Z][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:\s*[^{]*\{/gm;
const MUTATING = /^(create|update|set|delete|remove|add|save|publish|pause|resume|cancel|advance|decide|approve|reject|refund|confirm|decline|mark|restore|bulk|apply|change|edit|archive|reply|adjust)/i;
const OWNERSHIP_HINT =
  /sellerVoucher|requireOwnership|assertOwnership|requireSeller|resolveSeller|assertSeller|forbidden|does not belong|not found|notFound|sellerId\s*!==|seller\.id\s*!==|ownership/i;

// Documented exemptions: the seller id is a filter on the caller's own record,
// not the target of the write, so there is nothing to take ownership of.
const OWNERSHIP_EXEMPT = new Set([
  'cart-service.ts:setSellerSelected', // filters the caller's own cart lines by sellerId
]);

for (const file of serviceFiles) {
  const source = read(file);
  METHOD.lastIndex = 0;
  let match = METHOD.exec(source);
  while (match) {
    const [, name, args] = match;
    const isSellerScoped = /Seller|ForSeller/.test(name) && args.includes('sellerId');
    if (isSellerScoped && MUTATING.test(name) && !OWNERSHIP_EXEMPT.has(`${path.basename(file)}:${name}`)) {
      const bodyStart = match.index + match[0].length;
      const body = source.slice(bodyStart, bodyStart + 2600);
      if (!OWNERSHIP_HINT.test(body)) {
        add('ownership.missing-check', rel(file), `${name}(…sellerId…) writes without an ownership check.`);
      }
    }
    match = METHOD.exec(source);
  }
}

// 3. No plain-text credentials, tokens or keys in the source tree.
const SECRET_PATTERNS = [
  [/\bapi[_-]?key\b\s*[:=]\s*['"][^'"]{8,}['"]/i, 'hardcoded api key'],
  [/\bsecret\b\s*[:=]\s*['"][^'"]{8,}['"]/i, 'hardcoded secret'],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, 'hardcoded bearer token'],
  [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'stripe-like secret key'],
];
for (const file of files) {
  const source = read(file);
  source.split('\n').forEach((line, index) => {
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(line)) add('secret.hardcoded', `${rel(file)}:${index + 1}`, `Possible ${label}.`);
    }
  });
}

// 4. Passwords must be hashed before they are persisted, never stored raw.
const authService = serviceFiles.find((file) => file.endsWith('auth-service.ts'));
if (authService) {
  const source = read(authService);
  if (!/hashPassword/.test(source)) {
    add('auth.no-hashing', rel(authService), 'auth-service does not hash passwords.');
  }
  if (/password:\s*(?!hash)/.test(source) && /create\(|upsert\(|insert\(/.test(source)) {
    const rawWrite = source.split('\n').findIndex((line) => /password:\s*[^h]/.test(line) && /create|upsert|insert/.test(source));
    if (rawWrite >= 0 && !/passwordHash/.test(source)) {
      add('auth.raw-password', rel(authService), 'A user record appears to be written with a raw password.');
    }
  }
}

// 5. Route guards must protect the seller and account areas.
const guard = files.find((file) => file.endsWith('route-guard.tsx'));
if (guard) {
  const source = read(guard);
  for (const route of ['/orders', '/checkout', '/account', '/seller-dashboard', '/seller-products', '/seller-orders', '/seller-vouchers', '/seller-reviews', '/seller-store-settings', '/seller-returns']) {
    if (!source.includes(`'${route}'`)) {
      add('guard.missing-protected-route', rel(guard), `${route} is not in PROTECTED_ROUTES.`);
    }
  }
} else {
  add('guard.missing', 'src/modules/session/route-guard.tsx', 'No route guard module found.');
}

const byRule = new Map();
for (const finding of findings) byRule.set(finding.rule, [...(byRule.get(finding.rule) || []), finding]);

console.log('Security / ownership audit (M6-P, M6-Q)');
console.log(`  findings: ${findings.length}`);
for (const [rule, list] of [...byRule.entries()].sort()) {
  console.log(`  ${rule}: ${list.length}`);
  for (const finding of list.slice(0, 15)) console.log(`    ${finding.where} | ${finding.message}`);
  if (list.length > 15) console.log(`    …and ${list.length - 15} more`);
}

process.exitCode = findings.length ? 1 : 0;
