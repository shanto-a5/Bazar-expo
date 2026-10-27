/**
 * Accessibility and responsive-layout static audit (M6-M / M6-N).
 *
 * This is a heuristic source scan, not a substitute for testing with a screen
 * reader. It catches the regressions that are cheap to introduce and expensive
 * to notice: a tappable row with no role or label, an image nobody can read, a
 * fixed pixel width that overflows a small phone, or a tap target under 44dp.
 *
 *   node scripts/audit-a11y.cjs
 *
 * Exit code 1 means at least one rule was violated.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'src', 'app'), path.join(ROOT, 'src', 'components'), path.join(ROOT, 'src', 'modules')];
const EXTENSIONS = new Set(['.tsx']);

const findings = [];
const add = (rule, file, line, message) => findings.push({ rule, where: `${path.relative(ROOT, file)}:${line}`, message });

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * Opening JSX tags with their attributes.
 *
 * A regex is not enough: handlers contain both "=>" and comparisons like
 * "quantity <= 1", so the end of the tag is found by tracking brace depth and
 * stopping at the first ">" that closes the element (not an arrow).
 */
function jsxTags(source) {
  const tags = [];
  const start = /<([A-Z][A-Za-z0-9_.]*)/g;
  let match = start.exec(source);
  while (match) {
    const name = match[1];
    let index = start.lastIndex;
    let depth = 0;
    let end = -1;
    while (index < source.length) {
      const char = source[index];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0 && source[index - 1] !== '=') {
        end = index;
        break;
      }
      index += 1;
    }
    if (end === -1) break;
    tags.push({
      name,
      attrs: source.slice(start.lastIndex, end),
      selfClosing: source[end - 1] === '/',
      line: source.slice(0, match.index).split('\n').length,
      index: match.index,
    });
    start.lastIndex = end;
    match = start.exec(source);
  }
  return tags;
}

// Only elements that are really interactive or really carry an image. Project
// components such as <Logo> and <Checkbox> own their own accessibility
// contract, so demanding a label at every call site would be noise.
const TAPPABLE = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight']);
const IMAGE_LIKE = new Set(['Image', 'ImageBackground']);

function auditFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  for (const tag of jsxTags(source)) {
    const has = (name) => new RegExp(`\\b${name}\\s*=`).test(tag.attrs);
    // Body of the element: from the opening tag to its own closing tag.
    const closeAt = source.indexOf(`</${tag.name}>`, tag.index);
    const children = source.slice(tag.index, closeAt > tag.index ? Math.min(closeAt, tag.index + 4000) : tag.index + 800);

    if (TAPPABLE.has(tag.name)) {
      const hasVisibleText = /<Text[\s>]/.test(children);
      if (!has('accessibilityRole') && !has('accessibilityLabel') && !has('role') && !hasVisibleText) {
        add('a11y.icon-button-unlabelled', file, tag.line, `<${tag.name}> is an icon-only tap target with no role and no label.`);
      }
      if (has('accessibilityRole') && !has('accessibilityLabel') && !hasVisibleText) {
        add('a11y.role-without-label', file, tag.line, `<${tag.name}> sets a role but has no label and no visible text.`);
      }
      // A pressable that wraps real content is already a large target; only the
      // bare glyph buttons need an explicit size or hit slop.
      const wrapsContent = /<(Card|ProductImage|ProductCard|View)\b/.test(children);
      if (!wrapsContent && !has('hitSlop') && !has('style')) {
        add('a11y.tap-target', file, tag.line, `<${tag.name}> has neither a style nor hitSlop; check the tap target is at least 44dp.`);
      }
    }

    if (IMAGE_LIKE.has(tag.name)) {
      const decorative = has('accessible') && /accessible=\{false\}/.test(tag.attrs);
      if (!decorative && !has('accessibilityLabel') && !has('alt')) {
        add('a11y.image-unlabelled', file, tag.line, `<${tag.name}> is not marked decorative and has no accessibilityLabel.`);
      }
    }
  }

  lines.forEach((line, index) => {
    // Fixed pixel widths that cannot fit the narrowest supported phone (320dp).
    const width = line.match(/(?:^|\s)width:\s*(\d{3,4})\b/);
    if (width && Number(width[1]) > 320) {
      add('responsive.fixed-width', file, index + 1, `Fixed width ${width[1]}dp can overflow a 320dp phone.`);
    }
    const height = line.match(/(?:^|\s)height:\s*(\d{3,4})\b/);
    if (height && Number(height[1]) > 480) {
      add('responsive.fixed-height', file, index + 1, `Fixed height ${height[1]}dp can overflow a short viewport.`);
    }
    const font = line.match(/fontSize:\s*(\d{1,2})\b/);
    if (font && Number(font[1]) > 0 && Number(font[1]) < 11) {
      add('a11y.tiny-text', file, index + 1, `fontSize ${font[1]} is below the 11pt legibility floor.`);
    }
  });
}

function main() {
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) auditFile(file);
  }

  const byRule = new Map();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) || []), finding]);
  }

  console.log('Accessibility / responsive audit (M6-M, M6-N)');
  console.log(`  findings: ${findings.length}`);
  for (const [rule, list] of [...byRule.entries()].sort()) {
    console.log(`  ${rule}: ${list.length}`);
    for (const finding of list.slice(0, 12)) console.log(`    ${finding.where} | ${finding.message}`);
    if (list.length > 12) console.log(`    …and ${list.length - 12} more`);
  }

  process.exitCode = findings.length ? 1 : 0;
}

main();
