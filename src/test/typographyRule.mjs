// JL-416 — the typography rule, defined once.
//
// Imported by BOTH stylelint.config.mjs (the `npm run lint` gate) and
// typographyScan.mjs (the vitest ratchet). Deliberately free of any stylelint
// import so the config can load it without a cycle.
//
// One definition on purpose: a rule stated in two places is how the four
// original guard tests drifted apart from what the codebase actually did.

/** font-* values must come from a design token. */
export const TOKEN_ONLY = {
  'font-size': [/^var\(--font-size-/],
  'font-weight': [/^var\(--font-weight-/],
  'font-family': [/^var\(--font-family-/],
}

/**
 * Permanently exempt definition sites.
 *   index.css     — the `:root` block the tokens are built on; it cannot
 *                   reference them without a circular definition.
 *   variables.css — declares the tokens. Its `--font-*: 14px` lines are custom
 *                   properties, which this rule does not match anyway; naming
 *                   the file makes that exemption deliberate, not incidental.
 */
export const DEFINITION_SITES = ['src/index.css', 'src/styles/variables.css']

/** Every stylesheet the rule applies to. */
export const SCOPE = ['src/**/*.css']

export const RULE_NAME = 'declaration-property-value-allowed-list'

export const message = (prop, value) =>
  `"${prop}: ${value}" is not a typography token. Use var(--${prop}-*) ` +
  'from src/styles/variables.css (JL-416).'
