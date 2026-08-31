// JL-416 — the durable half of the typography guard.
//
// The vitest guards enumerate the filesystem, but they are still tests: they
// run when someone runs them. This config puts the same rule in the linter, so
// `npm run lint` checks it with a real CSS parser on every run. The rule itself
// lives in src/test/typographyRule.mjs and is imported by both, because a rule
// stated twice is exactly how the original four guards drifted.
//
// WHY THE EXEMPTION LIST IS GENERATED, NOT HANDWRITTEN
// 257 literal font declarations exist today across 46 files; clearing them is
// JL-415. A hard gate over all of them would make `npm run lint` permanently
// red, so the frozen baseline that scopes the vitest ratchet scopes this too.
// The useful consequence: when JL-415 cleans a file and drops it from the
// baseline, that file becomes hard-gated here automatically, with no config
// edit. The list can only shrink.
//
// COVERAGE SPLIT — the two gates are complementary, not redundant:
//   * stylelint exempts a baselined file ENTIRELY, so it hard-gates only the
//     20 already-clean stylesheets. It cannot see a new violation added to a
//     file that still has old ones.
//   * the vitest ratchet counts per file, so it DOES catch that case, and it
//     also fails when a violation is fixed without the baseline shrinking.
// Verified both ways when this landed: a probe violation in a clean file fails
// stylelint (exit 2); the same probe in an already-baselined file passes
// stylelint and fails the ratchet.
import fs from 'node:fs'
import {
  TOKEN_ONLY,
  DEFINITION_SITES,
  SCOPE,
  RULE_NAME,
  message,
} from './src/test/typographyRule.mjs'

const baseline = JSON.parse(
  fs.readFileSync(new URL('./src/test/typography-baseline.json', import.meta.url), 'utf8'),
)

/** Files with known, baselined violations — exempt until JL-415 clears them. */
const baselinedFiles = Object.keys(baseline.files)

export default {
  ignoreFiles: ['dist/**', 'node_modules/**', 'coverage/**'],
  // stylelint requires a top-level `rules` key even when every rule is applied
  // through `overrides`; without it the run aborts with a ConfigurationError.
  rules: {},
  overrides: [
    {
      files: SCOPE,
      rules: { [RULE_NAME]: [TOKEN_ONLY, { message }] },
    },
    {
      files: [...DEFINITION_SITES, ...baselinedFiles],
      rules: { [RULE_NAME]: null },
    },
  ],
}
