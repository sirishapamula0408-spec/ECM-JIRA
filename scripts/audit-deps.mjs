#!/usr/bin/env node
// JL-200: CI dependency gate — `npm audit` at high severity, minus a short,
// explicit list of advisories that have NO fix yet and do not reach production.
//
// Usage: node scripts/audit-deps.mjs        (exit 1 on any unexcepted finding)
//
// Each exception names one advisory, why it is accepted, and the packages it may
// appear in. The gate FAILS — so the exception cannot be forgotten — when:
//   - any other advisory at high/critical severity is present,
//   - an accepted advisory turns up through a package not listed for it, or
//   - npm reports a fix for an accepted advisory (time to run `npm audit fix`
//     and delete the exception).
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const ACCEPTED = {
  // braces <=3.0.3: stack-exhaustion DoS via deeply nested glob patterns.
  // 3.0.3 is the latest release, so no fixed version exists. braces reaches
  // only dev tooling (nodemon's file watcher, stylelint's file globbing) — it is
  // not in the production dependency tree, and those tools never glob
  // attacker-supplied patterns.
  'GHSA-vfj7-8cjw-p6xm': {
    packages: ['braces', 'micromatch', 'chokidar', 'fast-glob', 'globby', 'nodemon', 'stylelint'],
  },
}

const BLOCKING = new Set(['high', 'critical'])

function runAudit() {
  try {
    // One command string (no argument array), so it runs the same on Windows,
    // where npm is a .cmd shim, without Node's shell-argument deprecation.
    return execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    if (err.stdout) return err.stdout
    throw err
  }
}

// The advisory ids (GHSA-…) a vulnerable package is affected by, following
// `via` through the dependency chain to the source advisories.
function advisoriesOf(name, vulns, seen = new Set()) {
  if (seen.has(name)) return new Set()
  seen.add(name)
  const ids = new Set()
  for (const via of vulns[name]?.via || []) {
    if (typeof via === 'string') {
      for (const id of advisoriesOf(via, vulns, seen)) ids.add(id)
    } else if (via?.url) {
      ids.add(via.url.split('/').pop())
    }
  }
  return ids
}

/**
 * Classify an `npm audit --json` report. Pure, so the gate's rules are testable
 * without npm: returns { problems, accepted } — any problem fails the gate.
 */
export function evaluate(report, acceptedIds = ACCEPTED) {
  const vulns = report.vulnerabilities || {}
  const problems = []
  const accepted = []

  for (const [name, v] of Object.entries(vulns)) {
    if (!BLOCKING.has(v.severity)) continue
    const ids = [...advisoriesOf(name, vulns)]
    const unexcepted = ids.filter((id) => !acceptedIds[id] || !acceptedIds[id].packages.includes(name))
    if (ids.length === 0 || unexcepted.length > 0) {
      problems.push(`${v.severity.padEnd(8)} ${name} (${(unexcepted.length ? unexcepted : ['unknown advisory']).join(', ')})`)
      continue
    }
    // Every advisory here is accepted — but not once npm can fix it.
    if (v.fixAvailable === true || (v.fixAvailable && !v.fixAvailable.isSemVerMajor)) {
      problems.push(`${v.severity.padEnd(8)} ${name}: a fix is now available for accepted ${ids.join(', ')} — run \`npm audit fix\` and remove the exception from scripts/audit-deps.mjs`)
      continue
    }
    accepted.push(`${name} (${ids.join(', ')})`)
  }
  return { problems, accepted }
}

function main() {
  const report = JSON.parse(runAudit())
  const { problems, accepted } = evaluate(report)

  const counts = report.metadata?.vulnerabilities || {}
  console.log(`npm audit: ${counts.critical || 0} critical, ${counts.high || 0} high, ${counts.moderate || 0} moderate, ${counts.low || 0} low`)
  if (accepted.length) console.log(`Accepted (no fix exists, dev-only): ${accepted.join('; ')}`)

  if (problems.length) {
    console.error(`\n✖ audit-deps: ${problems.length} blocking finding(s):`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log('✔ audit-deps: no unaccepted high or critical vulnerabilities.')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
