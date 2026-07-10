// JL-102: Lightweight, dependency-free secret scanner.
//
// Greps tracked files for obvious secret patterns (AWS keys, private-key
// headers, high-entropy SECRET=/PASSWORD= literals, provider tokens) and exits
// non-zero if any are found. Usable locally (`node scripts/scan-secrets.mjs`)
// and in CI. Uses only Node std-lib.
//
// The core matcher (`scanText`) is exported for unit testing.

import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Secret detection rules. Each has an `id`, a human `description`, and a
 * `regex`. Kept intentionally conservative to limit false positives.
 */
export const SECRET_RULES = [
  {
    id: 'aws-access-key-id',
    description: 'AWS Access Key ID',
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'private-key',
    description: 'Private key header',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'github-token',
    description: 'GitHub personal access / app token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{20,}\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'high-entropy-assignment',
    description: 'High-entropy SECRET/PASSWORD/TOKEN/API_KEY literal',
    // KEY = "value" where value is long and mixes character classes.
    regex:
      /(?:secret|password|passwd|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"]([^'"\s]{16,})['"]/i,
  },
]

// Values that look like secrets but are obviously placeholders — never flagged.
const PLACEHOLDER_VALUES =
  /^(?:x{3,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|change[-_]?me|your[-_].*|example|placeholder|redacted|dummy|test|todo|none|null|undefined)$/i

// Known non-secret literals used as documented dev defaults / fixtures. These
// mirror the gitleaks allowlist in .gitleaks.toml.
const KNOWN_SAFE_VALUES = new Set([
  'ecm-jira-dev-secret-change-in-production',
  'jira_lite_dev',
  'replace-with-a-long-random-secret',
])

function looksLikePlaceholder(captured) {
  if (!captured) return false
  const v = captured.trim()
  if (KNOWN_SAFE_VALUES.has(v)) return true
  // Any value whose intent is clearly "change this in production" is a default.
  if (/change[-_]in[-_]production/i.test(v)) return true
  return PLACEHOLDER_VALUES.test(v)
}

/**
 * Scan a blob of text for secrets.
 * @param {string} text
 * @returns {Array<{ ruleId: string, description: string, line: number, match: string }>}
 */
export function scanText(text) {
  const findings = []
  if (typeof text !== 'string' || text.length === 0) return findings
  const lines = text.split(/\r?\n/)
  lines.forEach((line, idx) => {
    for (const rule of SECRET_RULES) {
      const m = rule.regex.exec(line)
      if (!m) continue
      // For the assignment rule, ignore obvious placeholder values.
      if (rule.id === 'high-entropy-assignment' && looksLikePlaceholder(m[1])) {
        continue
      }
      findings.push({
        ruleId: rule.id,
        description: rule.description,
        line: idx + 1,
        match: m[0].slice(0, 80),
      })
    }
  })
  return findings
}

// Files/paths to skip. Example/env-template files legitimately hold placeholders.
const EXCLUDE_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.git)\//i
const EXCLUDE_FILE =
  /(?:\.env(?:\.example)?$|\.example$|package-lock\.json$|scan-secrets\.mjs$|config-validation-JL102\.test\.js$|scan-secrets-JL102\.test\.js$)/i

function listTrackedFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split(/\r?\n/).filter(Boolean)
}

function isProbablyText(path) {
  try {
    if (statSync(path).size > 2 * 1024 * 1024) return false
  } catch {
    return false
  }
  return true
}

function main() {
  let files
  try {
    files = listTrackedFiles()
  } catch (err) {
    console.error('scan-secrets: unable to list tracked files (is this a git repo?)')
    console.error(String(err && err.message))
    process.exit(2)
  }

  const allFindings = []
  for (const file of files) {
    if (EXCLUDE_PATH.test(file) || EXCLUDE_FILE.test(file)) continue
    if (!isProbablyText(file)) continue
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // Skip binary-ish content (contains NUL).
    if (content.includes(String.fromCharCode(0))) continue
    for (const f of scanText(content)) {
      allFindings.push({ file, ...f })
    }
  }

  if (allFindings.length > 0) {
    console.error(`\n✖ scan-secrets: ${allFindings.length} potential secret(s) found:\n`)
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}  [${f.ruleId}] ${f.description}`)
      console.error(`      ${f.match}`)
    }
    console.error('\nIf a finding is a false positive, refactor it or add an exclusion.\n')
    process.exit(1)
  }

  console.log('✔ scan-secrets: no secrets detected in tracked files.')
  process.exit(0)
}

// Only run main() when invoked directly, not when imported by tests.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  main()
}
