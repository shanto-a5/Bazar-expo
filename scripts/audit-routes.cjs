/**
 * Route graph audit (M6-Q).
 *
 * Expo Router builds the route table from the file tree, so a typo in a href
 * is invisible until someone taps it. This script rebuilds the real route table
 * from src/app, then checks every navigation literal in src/ against it, so a
 * dead link is a build-time failure instead of a runtime dead end.
 *
 *   node scripts/audit-routes.cjs
 *
 * Exit code 1 means at least one href cannot be resolved.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'src', 'app');
const SRC_DIR = path.join(ROOT, 'src');
const ROUTE_GUARD = path.join(SRC_DIR, 'modules', 'session', 'route-guard.tsx');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
const NON_ROUTE_FILES = new Set(['_layout.tsx', '_sitemap.ts', '+not-found.tsx', '+native-intent.ts']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** Build the route table. Public paths drop `(group)` folders, like URLs do. */
function buildRouteTable() {
  const routes = new Map();
  for (const file of walk(APP_DIR)) {
    const relative = path.relative(APP_DIR, file).split(path.sep).join('/');
    const name = path.basename(relative);
    if (NON_ROUTE_FILES.has(name)) continue;

    const segments = relative
      .replace(/\.(tsx|ts)$/, '')
      .split('/')
      .filter((segment) => segment !== 'index')
      .map((segment) => (segment.startsWith('(') && segment.endsWith(')') ? null : segment))
      .filter(Boolean);

    const publicPath = `/${segments.join('/')}`.replace(/\/$/, '') || '/';
    if (!routes.has(publicPath)) routes.set(publicPath, []);
    routes.get(publicPath).push(relative);
  }
  return routes;
}

function normalizeTarget(target) {
  return target
    .split('#')[0]
    .split('?')[0]
    .split('/')
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .join('/')
    .replace(/\/$/, '') || '/';
}

function hasGroupSegment(target) {
  return target
    .split('/')
    .some((segment) => segment.startsWith('(') && segment.endsWith(')'));
}

/** `/seller-order/[id]` matches `/seller-order/so_1`; `/x` matches only `/x`. */
function matches(pattern, target) {
  if (pattern === target) return true;
  const patternSegments = pattern.split('/').filter(Boolean);
  const targetSegments = target.split('/').filter(Boolean);
  if (patternSegments.length !== targetSegments.length) return false;
  return patternSegments.every((segment, index) => {
    if (segment.startsWith('[...') || segment === '[[...') return true;
    if (segment.startsWith('[')) return targetSegments[index].length > 0;
    return segment === targetSegments[index];
  });
}

function resolve(routes, target) {
  const normalized = normalizeTarget(target);
  for (const pattern of routes.keys()) {
    if (matches(pattern, normalized)) return pattern;
  }
  return null;
}

const HREF_PATTERNS = [
  { name: 'router call', regex: /router\.(?:push|replace|navigate)\(\s*'([^']+)'/g },
  { name: 'pathname object', regex: /pathname:\s*'([^']+)'/g },
  { name: 'Redirect href', regex: /<Redirect\s+href=\{?['"]([^'"]+)['"]\}?/g },
  { name: 'Link href', regex: /<Link\b[^>]*\bhref=['"]([^'"]+)['"]/gs },
  { name: 'next route', regex: /\bnext:\s*'(\/[^']+)'/g },
  { name: 'route field', regex: /\broute:\s*'(\/[^']+)'/g },
  { name: 'ProtectedRoute use', regex: /with(?:Session|SellerCapability)\([^,]+,\s*'(\/[^']+)'/g },
  { name: 'protected literal', regex: /'(\/[a-z0-9\-\[\]/.]+)'/g },
];

/**
 * Directories excluded from the navigation-literal scan (M7).
 *
 * The catch-all "protected literal" pattern above matches any quoted `/path`,
 * which is what catches unguarded navigation. `src/api` holds the typed API
 * client, where a leading slash means an HTTP endpoint (`/cart/items`), not a
 * router href. Those strings are validated against the real server instead — the
 * backend suite exercises the same paths.
 *
 * The exclusion is reported in the output so it cannot quietly hide a mistake.
 */
const NON_NAVIGATION_DIRS = ['src/api'];

/**
 * Routes that are entered from outside the app (M8).
 *
 * `/reset-password` is where the emailed reset link points — `PUBLIC_APP_URL`
 * defaults to `.../reset-password?token=...` — so nothing inside the app
 * navigates to it and it is correct for it to look unreferenced. It is listed
 * here, and reported in the output, so the exemption is visible rather than
 * something the next person to run this has to rediscover.
 */
const EXTERNAL_ENTRY_ROUTES = new Set(['/reset-password']);

function isApiLayer(relative) {
  return NON_NAVIGATION_DIRS.some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}
function main() {
  const routes = buildRouteTable();
  const allFiles = walk(SRC_DIR);
  const files = allFiles.filter((file) => !isApiLayer(path.relative(ROOT, file).split(path.sep).join('/')));
  const skipped = allFiles.length - files.length;
  const unknown = [];
  const groupPrefixed = [];
  const referenced = new Set();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    for (const { name, regex } of HREF_PATTERNS) {
      regex.lastIndex = 0;
      let match = regex.exec(source);
      while (match) {
        const target = match[1];
        if (target.startsWith('/')) {
          if (hasGroupSegment(target)) {
            groupPrefixed.push({ file: relative, target, kind: name });
          }
          const resolved = resolve(routes, target);
          if (resolved) referenced.add(resolved);
          else unknown.push({ file: relative, target, kind: name });
        }
        match = regex.exec(source);
      }
    }
  }

  const line = (text) => console.log(text);
  const external = [...routes.keys()].filter((route) => EXTERNAL_ENTRY_ROUTES.has(route) && !referenced.has(route));
  for (const route of external) referenced.add(route);
  const unreferenced = [...routes.keys()].filter((route) => !referenced.has(route));
  line('Route graph audit (M6-Q)');
  line(`  routes on disk: ${routes.size}`);
  line(`  routes referenced: ${referenced.size}`);
  line(`  unreferenced routes: ${unreferenced.length}`);
  for (const route of unreferenced) line(`    ${route}`);
  if (external.length > 0) {
    line(`  entered from outside the app (e.g. a mailed link): ${external.length} (${[...external].join(', ')})`);
  }
  if (skipped > 0) {
    line(`  API-layer files excluded from the navigation scan: ${skipped} (${NON_NAVIGATION_DIRS.join(', ')})`);
  }
  line('');

  if (groupPrefixed.length) {
    line(`Group-prefixed hrefs (${groupPrefixed.length}) — resolvable, but the public URL drops "(group)":`);
    for (const entry of groupPrefixed) line(`  ${entry.file}  ${entry.target}  [${entry.kind}]`);
    line('');
  }

  if (unknown.length) {
    line(`Unresolved hrefs (${unknown.length}):`);
    for (const entry of unknown) line(`  ${entry.file}  ${entry.target}  [${entry.kind}]`);
    line('');
  } else {
    line('All navigation literals resolve to a real route.');
  }

  process.exitCode = unknown.length ? 1 : 0;
}

main();
