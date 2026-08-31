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
const STEPS = ['sm', 'base', 'md', 'lg', 'xl', 'xxl', 'xxxl'];

/** Pull a `--name: <n>px;` declaration out of a stylesheet as a number. */
function pxToken(css, name) {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : null;
}

describe('JL-396: the typography scale is Atlassian-sized', () => {
  const variables = read('styles/variables.css');

  it('--font-size-base is 14px, Atlassian body size', () => {
    expect(pxToken(variables, 'font-size-base')).toBe(14);
  });

  it('every step of the scale is defined', () => {
    for (const step of STEPS) {
      expect(pxToken(variables, `font-size-${step}`), `--font-size-${step}`).not.toBeNull();
    }
  });

  it('the scale strictly increases, so no two steps collapse into one', () => {
    const sizes = STEPS.map((step) => pxToken(variables, `font-size-${step}`));
    const ascending = [...sizes].sort((a, b) => a - b);
    expect(sizes).toEqual(ascending);
    expect(new Set(sizes).size).toBe(STEPS.length);
  });

  it('lands on the Atlassian Design System values at every step', () => {
    // sm is body.small, base is font.body, and md..xxxl are heading.small
    // through heading.xxlarge. JL-414 corrected xxl 29->28 (29 was the legacy
    // ADG3 value) and added the 32px step. The old h600..h900 names are retired.
    expect(STEPS.map((step) => pxToken(variables, `font-size-${step}`)))
      .toEqual([12, 14, 16, 20, 24, 28, 32]);
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

  it('agrees with the :root font-size in index.css', () => {
    // These two drifted apart before this ticket: :root was already 14px while
    // the token said 12px, so opting into the token *shrank* text below the
    // page default. If someone moves one of them, this fails.
    const rootSize = read('index.css').match(/:root\s*\{[^}]*?font-size:\s*(\d+)px/s);
    expect(rootSize).not.toBeNull();
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
