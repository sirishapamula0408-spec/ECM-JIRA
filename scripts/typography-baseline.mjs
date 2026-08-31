// JL-416 — regenerate the frozen typography baseline.
//
// Run after migrating a stylesheet onto the tokens (JL-415):
//   node scripts/typography-baseline.mjs
//
// The guard in src/test/TypographyTokens.JL394.test.js fails both when a NEW
// violation appears and when one is removed without the baseline shrinking, so
// this script is the intended way to record progress. The count can only go
// down; the script refuses to raise it.
import fs from 'node:fs'
import path from 'node:path'
import { scanTypography, repoRoot } from '../src/test/typographyScan.mjs'

const baselinePath = path.join(repoRoot, 'src', 'test', 'typography-baseline.json')

const { counts } = await scanTypography()
const sorted = {}
for (const k of Object.keys(counts).sort()) sorted[k] = counts[k]
const total = Object.values(sorted).reduce((a, b) => a + b, 0)

let previous = null
if (fs.existsSync(baselinePath)) {
  previous = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
}

if (previous && total > previous.total) {
  console.error(
    `Refusing to raise the baseline: ${previous.total} -> ${total}.\n` +
      'The typography baseline is a ratchet. Fix the new violations instead of ' +
      'recording them.',
  )
  process.exit(1)
}

fs.writeFileSync(baselinePath, JSON.stringify({ total, files: sorted }, null, 2) + '\n')

const delta = previous ? previous.total - total : 0
console.log(
  `baseline: ${total} violations across ${Object.keys(sorted).length} files` +
    (previous ? ` (was ${previous.total}, -${delta})` : ''),
)
