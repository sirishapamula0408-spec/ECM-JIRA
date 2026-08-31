// JL-416 — the one typography scanner.
//
// An earlier draft of this ticket had two: a line-anchored regex in the vitest
// guard and the `declaration-property-value-allowed-list` rule in
// stylelint.config.mjs. They disagreed by 17 violations, because the regex only
// matched declarations at the start of a line and several stylesheets put
// several declarations on one line. Two scanners that disagree are worse than
// one that is merely strict, so this module is now the only one: the vitest
// ratchet, the baseline generator and (through the same rule) `npm run lint`
// all resolve to stylelint's CSS parser.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { TOKEN_ONLY, DEFINITION_SITES, SCOPE, RULE_NAME } from './typographyRule.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '..', '..')

export { TOKEN_ONLY, DEFINITION_SITES }

/** Repo-relative, forward-slashed, so the baseline is platform-stable. */
export const keyOf = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/')

/**
 * Scan every stylesheet under src/ with no baseline exemptions applied.
 *
 * @returns {Promise<{counts: Record<string, number>, detail: Record<string, string[]>}>}
 *   counts — violations per repo-relative file, omitting clean files.
 *   detail — human-readable `file:line:col  message` lines, for failure output.
 */
export async function scanTypography() {
  const result = await stylelint.lint({
    cwd: repoRoot,
    files: 'src/**/*.css',
    // Deliberately NO baseline exemptions: this is the unfiltered truth that
    // the ratchet compares the baseline against.
    config: {
      rules: {},
      overrides: [
        { files: SCOPE, rules: { [RULE_NAME]: [TOKEN_ONLY] } },
        { files: DEFINITION_SITES, rules: { [RULE_NAME]: null } },
      ],
    },
  })

  const counts = {}
  const detail = {}
  for (const file of result.results) {
    // `warnings` holds rule violations; parse errors surface separately and
    // would otherwise be silently counted as zero.
    if (file.errored && file.parseErrors?.length) {
      throw new Error(`stylelint could not parse ${keyOf(file.source)}`)
    }
    const hits = file.warnings.filter(
      (w) => w.rule === RULE_NAME,
    )
    if (!hits.length) continue
    const key = keyOf(file.source)
    counts[key] = hits.length
    detail[key] = hits.map((w) => `${key}:${w.line}:${w.column}  ${w.text}`)
  }
  return { counts, detail }
}
