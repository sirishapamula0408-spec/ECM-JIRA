// JL-416 — the durable half of the typography guard.
//
// The vitest guards enumerate the filesystem, but they are still tests: they
// run when someone runs them. This config puts the same rule in the linter, so
// `npm run lint` checks it with a real CSS parser on every run. The rule itself
// lives in src/test/typographyRule.mjs and is imported by both, because a rule
// stated twice is exactly how the original four guards drifted.
//
// WHY THE EXEMPTION LIST IS GENERATED, NOT HANDWRITTEN
// When this landed, 257 literal font declarations existed across 46 files and a
// hard gate over all of them would have made `npm run lint` permanently red, so
// the frozen baseline that scopes the vitest ratchet scoped this too. JL-415
// then cleared them: the baseline is down to ONE file, so effectively every
// stylesheet under src/ is now hard-gated here. The generated list is what made
// that migration cost nothing — each file dropped from the baseline became
// hard-gated automatically, with no config edit. The list can only shrink.
//
// COVERAGE SPLIT — the two gates are complementary, not redundant:
//   * stylelint exempts a baselined file ENTIRELY, so it cannot see a new
//     violation added to a file that still has old ones. That mattered a lot at
//     257 and barely at all at 1, but the asymmetry is structural, not a
//     function of the count.
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
