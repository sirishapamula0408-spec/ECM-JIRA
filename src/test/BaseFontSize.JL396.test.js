// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..');

const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

// The scale, smallest to largest. Order matters — the monotonicity check below
// is the thing that would have caught the naive version of this change, where
// base moves to 14px and collides with md, which was already 14px.
// JL-414: xs (11px) retired — Atlassian raised its smallest step to 12px for
// accessibility and dropped 11px, so former xs consumers use sm. xxxl (32px,
// heading.xxlarge) added; it was missing from this scale entirely.
const STEPS = ['xs', 'sm', 'base', 'md', 'lg', 'xl', 'xxl'];

/** Pull a `--name: <n>px;` declaration out of a stylesheet as a number. */
function pxToken(css, name) {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : null;
}

describe('JL-396: the typography scale is Atlassian-sized', () => {
  const variables = read('styles/variables.css');

  it('--font-size-base is 14px, Atlassian font.body', () => {
    // 14 -> 16 in JL-438, back to 14 in JL-443. JL-438 took the brief's more
    // generous 16px body; JL-443 reversed it because 16px is Atlassian's
    // body.LARGE, not body, and on a scaled display a 16px body paints like
    // 24px, which is what "the whole app looks oversized" actually was.
    expect(pxToken(variables, 'font-size-base')).toBe(14);
    expect(pxToken(variables, 'font-size-sm')).toBe(14);
    expect(pxToken(variables, 'font-size-xs')).toBe(12);
  });

  it('every step of the scale is defined', () => {
    for (const step of STEPS) {
      expect(pxToken(variables, `font-size-${step}`), `--font-size-${step}`).not.toBeNull();
    }
  });

  it('never decreases, and only sm/base are allowed to share a value', () => {
    // This was "strictly increases, no two steps collapse". JL-443 makes
    // sm and base BOTH 14px, so a strict check can no longer hold — and the
    // collapse is real, not cosmetic: two ladder names now address one size.
    //
    // It is tolerated rather than fixed here because `sm` has 320 call sites
    // and `base` has 247, and merging them is a mechanical sweep of its own.
    // Both map to Atlassian font.body, so nothing renders wrong in the
    // meantime. The distinction they used to carry — body vs body.large —
    // was the JL-438 decision JL-443 reversed.
    //
    // The assertion is narrowed rather than dropped: the ladder must still
    // never go DOWN, and sm/base is the ONLY pair permitted to tie. A new
    // collision anywhere else still fails here, which is the property that
    // made this test worth having.
    const sizes = STEPS.map((step) => pxToken(variables, `font-size-${step}`));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));

    const ties = [];
    for (let i = 1; i < STEPS.length; i++) {
      if (sizes[i] === sizes[i - 1]) ties.push(`${STEPS[i - 1]}/${STEPS[i]}`);
    }
    expect(ties, 'only sm/base may share a value').toEqual(['sm/base']);
  });

  it('lands on the Atlassian Design System values at every step', () => {
    // xs body.small, sm + base font.body, md heading.small, lg heading.medium,
    // xl heading.large, xxl heading.xlarge.
    //
    // heading.xxlarge (32px) left the ladder in JL-443 and is NOT missing by
    // accident: nothing in this app reaches it, and DesignTokens.JL441 is
    // explicit that inventing a token to satisfy a spec is how token layers
    // become dumping grounds. It goes back when something needs it.
    expect(STEPS.map((step) => pxToken(variables, `font-size-${step}`)))
      .toEqual([12, 14, 14, 16, 20, 24, 28]);
  });

  it('pairs every font size with a line height that can actually contain it', () => {
    for (const step of STEPS) {
      const size = pxToken(variables, `font-size-${step}`);
      const leading = pxToken(variables, `line-height-${step}`);
      expect(leading, `--line-height-${step}`).not.toBeNull();
      expect(leading, `--line-height-${step} must clear --font-size-${step}`)
        .toBeGreaterThanOrEqual(size);
    }
  });

  it('matches the :root font-size again, which is the original JL-396 intent', () => {
    // The history of this one assertion is the whole story of the scale.
    //
    // Originally it required root === base, and it was right: the token had
    // been 12px while :root was 14px, so opting INTO the token shrank text
    // below the page default. That was the bug JL-396 fixed, by making both
    // 14px.
    //
    // JL-438 split them — body to 16px, root left at 14 — and the assertion
    // was inverted to pin the gap. JL-443 puts base back to 14, so the two
    // agree once more and the original invariant holds again.
    //
    // The root stays 14px regardless: changing it re-scales every rem/em in
    // the app, which is the JL-408 drift muiTheme.js documents and the reason
    // JL-414 refused to touch it. Nothing should depend on it — every size in
    // this scale is px — but an element that opts out of the tokens now lands
    // on the same size as one that opts in, which is the point.
    const rootSize = read('index.css').match(/:root\s*\{[^}]*?font-size:\s*(\d+)px/s);
    expect(rootSize, ':root font-size not found in index.css').not.toBeNull();
    expect(Number(rootSize[1]), 'root must stay 14px — see JL-414').toBe(14);
    expect(pxToken(variables, 'font-size-base'), 'body is 14px — see JL-443').toBe(14);
    expect(Number(rootSize[1])).toBe(pxToken(variables, 'font-size-base'));
  });
});

describe('JL-396: taller rows do not get clipped', () => {
  it('an expanded backlog sprint is not capped at a fixed pixel height', () => {
    // Was `max-height: 1200px` with `overflow: hidden` and no transition, so a
    // long sprint was silently truncated — and taller rows lowered the ceiling.
    const css = read('pages/BacklogPage/BacklogPage.css');
    const expanded = css.match(/\.sprint-issues\.expanded\s*\{[^}]*\}/s);
    expect(expanded).not.toBeNull();
    expect(expanded[0]).not.toMatch(/max-height:\s*\d+px/);
  });
});
