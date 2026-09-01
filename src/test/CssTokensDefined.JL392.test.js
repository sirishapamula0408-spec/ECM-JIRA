// @vitest-environment node
/**
 * JL-392 — the 43 undefined CSS custom properties are defined as token aliases.
 *
 * Page CSS under src/pages/ referenced 43 custom properties that were defined
 * nowhere. Each silently fell back to whatever literal the call site happened to
 * write, and the call sites with no fallback at all were
 * invalid-at-computed-value-time (the declaration did nothing). Nothing in the
 * .app-theme-dark block could reach them, so the theme had no control over them.
 *
 * These tests are file-level assertions on the stylesheets — no DOM needed, so
 * this file runs in the node environment (importing the build config under jsdom
 * breaks on esbuild).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const STYLES_DIR = path.join(ROOT, 'src/styles');
const PAGES_DIR = path.join(ROOT, 'src/pages');
const VARIABLES_CSS = path.join(STYLES_DIR, 'variables.css');
const THEME_CSS = path.join(STYLES_DIR, 'theme.css');

/** The 43 names that JL-392 defines. */
const ALIASES = [
  '--border',
  '--border-color',
  '--border-subtle',
  '--code-bg',
  '--color-border',
  '--color-border-subtle',
  '--color-column-bg',
  '--color-danger',
  '--color-hover',
  '--color-primary',
  '--color-primary-subtle',
  '--color-selected',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-text',
  '--color-text-subtle',
  '--font-mono',
  '--hover',
  '--hover-bg',
  '--jira-bg-muted',
  '--jira-hover',
  '--jira-primary',
  '--jira-red',
  '--jira-selected-bg',
  '--jira-text-secondary',
  '--list-border',
  '--list-chip-bg',
  '--list-focus',
  '--list-row-hover',
  '--list-subtle',
  '--list-surface',
  '--list-text',
  '--primary',
  '--primary-color',
  '--surface',
  '--surface-sunken',
  '--text-color',
  '--text-muted',
  '--text-primary',
  '--text-secondary',
  '--text-subtle',
  '--text-tertiary',
];

// ── helpers ────────────────────────────────────────────────────────────────

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const walkCss = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCss(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
};

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/** Custom properties *declared* anywhere in a stylesheet. */
const declaredIn = (css) =>
  new Set([...stripComments(css).matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));

/** Custom properties *referenced* via var() in a stylesheet. */
const referencedIn = (css) =>
  [...stripComments(css).matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]);

/** `--name: value` pairs inside the first rule block for `selector`. */
const declarationsFor = (css, selector) => {
  const clean = stripComments(css);
  const start = clean.indexOf(selector);
  if (start === -1) return {};
  const open = clean.indexOf('{', start);
  const close = clean.indexOf('}', open);
  const body = clean.slice(open + 1, close);
  const decls = {};
  for (const chunk of body.split(';')) {
    const m = chunk.match(/^\s*(--[A-Za-z0-9-]+)\s*:\s*([\s\S]+)$/);
    if (m) decls[m[1]] = m[2].trim();
  }
  return decls;
};

const variablesCss = fs.readFileSync(VARIABLES_CSS, 'utf8');
const themeCss = fs.readFileSync(THEME_CSS, 'utf8');
const rootDecls = declarationsFor(variablesCss, ':root');
const darkDecls = declarationsFor(themeCss, '.app-theme-dark');
const darkScope = { ...rootDecls, ...darkDecls };

const ALIAS_ONLY = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/;

/** Follow a `var(--x)` chain to the literal it lands on, within one scope. */
const resolve = (name, scope, seen = new Set()) => {
  if (seen.has(name)) return { value: null, chain: [...seen], cycle: true };
  seen.add(name);
  const raw = scope[name];
  if (raw === undefined) return { value: null, chain: [...seen], missing: true };
  const m = raw.match(ALIAS_ONLY);
  if (!m) return { value: raw, chain: [...seen] };
  return resolve(m[1], scope, seen);
};

// ── 1. the guard that matters ──────────────────────────────────────────────

describe('JL-392 — no page CSS references an undefined custom property', () => {
  it('every var(--x) in src/pages resolves to a declaration in src/styles or the same file', () => {
    const globallyDefined = new Set();
    for (const file of walkCss(STYLES_DIR)) {
      for (const name of declaredIn(fs.readFileSync(file, 'utf8'))) globallyDefined.add(name);
    }

    const undefinedRefs = [];
    for (const file of walkCss(PAGES_DIR)) {
      const css = fs.readFileSync(file, 'utf8');
      const localDefined = declaredIn(css);
      for (const name of new Set(referencedIn(css))) {
        if (globallyDefined.has(name) || localDefined.has(name)) continue;
        undefinedRefs.push(`${name}  (${relative(file)})`);
      }
    }

    expect(
      undefinedRefs.sort(),
      `Undefined custom properties referenced by page CSS:\n  ${undefinedRefs.sort().join('\n  ')}`,
    ).toEqual([]);
  });

  it('finds a real corpus to scan (guards against the walker silently matching nothing)', () => {
    const pageFiles = walkCss(PAGES_DIR);
    expect(pageFiles.length).toBeGreaterThan(20);
    const refs = pageFiles.flatMap((f) => referencedIn(fs.readFileSync(f, 'utf8')));
    expect(refs.length).toBeGreaterThan(200);
  });
});

// ── 2. all 43 are defined in variables.css ─────────────────────────────────

describe('JL-392 — the 43 names are defined in variables.css', () => {
  it('declares exactly the expected set (none missing)', () => {
    const missing = ALIASES.filter((name) => !(name in rootDecls));
    expect(missing, `Not defined in :root of variables.css: ${missing.join(', ')}`).toEqual([]);
    expect(ALIASES).toHaveLength(43);
  });

  it.each(ALIASES)('%s is declared on :root', (name) => {
    expect(rootDecls[name]).toBeTruthy();
  });
});

// ── 3. each is an alias, not a fresh literal ───────────────────────────────

describe('JL-392 — each of the 43 is an alias onto a canonical token', () => {
  it.each(ALIASES)('%s is declared as var(--canonical), not a bare literal', (name) => {
    expect(
      rootDecls[name],
      `${name} must alias a canonical token so the theme keeps one source of truth, ` +
        `but it is declared as "${rootDecls[name]}"`,
    ).toMatch(ALIAS_ONLY);
  });

  it('every alias chain terminates on a concrete value (no dangling var, no cycle)', () => {
    const broken = [];
    for (const name of ALIASES) {
      const { value, missing, cycle } = resolve(name, rootDecls);
      if (missing || cycle || !value) broken.push(`${name} -> ${rootDecls[name]}`);
    }
    expect(broken, `Aliases that do not resolve:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('collapses the three naming families onto a small canonical set', () => {
    const canonical = new Set(ALIASES.map((name) => rootDecls[name].match(ALIAS_ONLY)[1]));
    // 43 names, far fewer underlying tokens — that is the point of the change.
    expect(canonical.size).toBeLessThan(15);
    for (const token of canonical) {
      expect(rootDecls[token], `canonical ${token} must itself be defined`).toBeTruthy();
    }
  });
});

// ── 4. dark mode ───────────────────────────────────────────────────────────

describe('JL-392 — dark mode reaches the aliases', () => {
  it('theme.css is imported after variables.css so .app-theme-dark wins the specificity tie', () => {
    // `.app-theme-dark` is toggled on document.documentElement, the same element
    // `:root` matches, and both selectors have specificity (0,1,0). Source order
    // is therefore what makes the dark block win.
    const appJsx = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
    const varsAt = appJsx.indexOf("styles/variables.css");
    const themeAt = appJsx.indexOf("styles/theme.css");
    expect(varsAt).toBeGreaterThan(-1);
    expect(themeAt).toBeGreaterThan(varsAt);

    // JL-407: the class toggle lives in ThemeProvider.jsx now — ThemeContext.jsx
    // holds only the context object and the useTheme hook.
    const themeContext = fs.readFileSync(path.join(ROOT, 'src/context/ThemeProvider.jsx'), 'utf8');
    expect(themeContext).toMatch(/documentElement\.classList\.toggle\('app-theme-dark'/);
  });

  it('the dark block re-points aliases with var(), never a raw literal', () => {
    const overridden = ALIASES.filter((name) => name in darkDecls);
    expect(overridden.length).toBeGreaterThan(0);
    for (const name of overridden) {
      expect(
        darkDecls[name],
        `${name} must stay an alias in the dark block too, got "${darkDecls[name]}"`,
      ).toMatch(ALIAS_ONLY);
    }
  });

  it('every alias re-pointed in the dark block resolves to a different value than in light', () => {
    const overridden = ALIASES.filter((name) => name in darkDecls);
    for (const name of overridden) {
      const light = resolve(name, rootDecls);
      const dark = resolve(name, darkScope);
      expect(dark.value, `${name} does not resolve in the dark scope`).toBeTruthy();
      expect(
        dark.value,
        `${name} resolves to the same value in both themes (${light.value})`,
      ).not.toBe(light.value);
    }
  });

  it('an alias transitively picks up a dark override of its canonical token', () => {
    // Not hypothetical: --jira-menu-bg / --jira-menu-hover are overridden in the
    // dark block (JL-298) and are reached through var() chains, which is the
    // mechanism every alias relies on.
    const canonicalWithDarkOverride = Object.keys(darkDecls).filter(
      (name) => name in rootDecls && !ALIASES.includes(name),
    );
    expect(canonicalWithDarkOverride).toContain('--jira-menu-bg');

    for (const canonical of canonicalWithDarkOverride) {
      const light = resolve(canonical, rootDecls);
      const dark = resolve(canonical, darkScope);
      expect(dark.value, `${canonical} must resolve in the dark scope`).toBeTruthy();
      // Aliases pointing at it must not shadow the override with their own literal.
      for (const alias of ALIASES) {
        const chain = resolve(alias, darkScope).chain;
        if (!chain.includes(canonical)) continue;
        expect(
          resolve(alias, darkScope).value,
          `${alias} reaches ${canonical} but does not pick up its dark value`,
        ).toBe(dark.value);
        expect(light.value).not.toBe(dark.value);
      }
    }
  });

  it('every alias still resolves in the dark scope (no name is left dangling by theme.css)', () => {
    const broken = [];
    for (const name of ALIASES) {
      const { value, missing, cycle } = resolve(name, darkScope);
      if (missing || cycle || !value) broken.push(name);
    }
    expect(broken, `Aliases that do not resolve under .app-theme-dark: ${broken.join(', ')}`).toEqual([]);
  });

  it('translucent hover wash needs no per-theme override', () => {
    // rgba() over whatever sits beneath adapts to both themes by construction.
    expect(rootDecls['--jira-hover-overlay']).toMatch(/^rgba\(/);
    for (const name of ['--hover', '--color-hover', '--jira-hover']) {
      expect(resolve(name, rootDecls).chain).toContain('--jira-hover-overlay');
    }
  });
});

// ── behaviour preservation ─────────────────────────────────────────────────

describe('JL-392 — light-theme values match the fallback literals they replace', () => {
  const EXPECTED_LIGHT = {
    '--border': '#dfe1e6',
    '--border-color': '#dfe1e6',
    '--border-subtle': '#ebecf0',
    '--code-bg': '#f4f5f7',
    '--color-border': '#dfe1e6',
    '--color-border-subtle': '#ebecf0',
    '--color-column-bg': '#f4f5f7',
    '--color-danger': '#de350b',
    '--color-primary': '#0c66e4',
    '--color-primary-subtle': '#e9f2ff',
    '--color-surface': '#ffffff',
    '--color-surface-raised': '#ffffff',
    '--color-surface-sunken': '#f4f5f7',
    '--color-text': '#172b4d',
    '--hover-bg': '#f4f5f7',
    '--jira-bg-muted': '#f4f5f7',
    '--jira-primary': '#0c66e4',
    '--jira-red': '#de350b',
    '--list-border': '#dfe1e6',
    '--list-chip-bg': '#dfe1e6',
    '--list-row-hover': '#fafbfc',
    '--list-surface': '#ffffff',
    '--list-text': '#172b4d',
    '--primary': '#0c66e4',
    '--primary-color': '#0c66e4',
    '--surface': '#ffffff',
    '--surface-sunken': '#f4f5f7',
    '--text-color': '#172b4d',
    '--text-primary': '#172b4d',
  };

  it.each(Object.entries(EXPECTED_LIGHT))('%s resolves to %s', (name, expected) => {
    expect(resolve(name, rootDecls).value.toLowerCase()).toBe(expected);
  });

  it('--font-mono resolves to the canonical mono stack', () => {
    expect(resolve('--font-mono', rootDecls).value).toContain('monospace');
  });
});
