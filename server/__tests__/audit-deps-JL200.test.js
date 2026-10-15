// @vitest-environment node
// JL-200 — the CI dependency gate (scripts/audit-deps.mjs).
//
// It accepts exactly one advisory with no published fix (braces,
// GHSA-vfj7-8cjw-p6xm, dev tooling only). These tests pin that it still FAILS
// for everything else — the point of a gate — and that the exception expires
// on its own once npm can fix it.
import { describe, it, expect } from 'vitest'
import { evaluate, ACCEPTED } from '../../scripts/audit-deps.mjs'

const BRACES = 'GHSA-vfj7-8cjw-p6xm'
const advisory = (id, severity = 'high') => ({ url: `https://github.com/advisories/${id}`, severity })

// The real shape: braces carries the advisory, the rest of the chain points at it.
const bracesChain = (fixAvailable = { name: 'nodemon', version: '1.14.10', isSemVerMajor: true }) => ({
  braces: { severity: 'high', via: [advisory(BRACES)], fixAvailable },
  micromatch: { severity: 'high', via: ['braces'], fixAvailable },
  nodemon: { severity: 'high', via: ['chokidar'], fixAvailable },
  chokidar: { severity: 'high', via: ['braces'], fixAvailable },
})

describe('audit-deps gate (JL-200)', () => {
  it('accepts the braces advisory through its dev-tool chain while no fix exists', () => {
    const { problems, accepted } = evaluate({ vulnerabilities: bracesChain() })
    expect(problems).toEqual([])
    expect(accepted.join(' ')).toMatch(/braces.*micromatch.*nodemon.*chokidar/)
  })

  it('fails on any other high or critical advisory', () => {
    for (const severity of ['high', 'critical']) {
      const { problems } = evaluate({
        vulnerabilities: { ...bracesChain(), nodemailer: { severity, via: [advisory('GHSA-aaaa-bbbb-cccc', severity)], fixAvailable: true } },
      })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(/nodemailer.*GHSA-aaaa-bbbb-cccc/)
    }
  })

  it('ignores moderate and low findings, as npm audit --audit-level=high did', () => {
    const { problems } = evaluate({
      vulnerabilities: { pkg: { severity: 'moderate', via: [advisory('GHSA-mmmm-mmmm-mmmm', 'moderate')], fixAvailable: true } },
    })
    expect(problems).toEqual([])
  })

  it('fails when the accepted advisory reaches a package it was not accepted for', () => {
    const { problems } = evaluate({
      vulnerabilities: { braces: { severity: 'high', via: [advisory(BRACES)], fixAvailable: false }, express: { severity: 'high', via: ['braces'], fixAvailable: false } },
    })
    expect(problems.join()).toMatch(/express/)
  })

  it('expires the exception once npm can fix it', () => {
    const { problems } = evaluate({ vulnerabilities: bracesChain(true) })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toMatch(/fix is now available/)
  })

  it('fails a finding whose advisory cannot be identified', () => {
    const { problems } = evaluate({ vulnerabilities: { mystery: { severity: 'high', via: [], fixAvailable: false } } })
    expect(problems.join()).toMatch(/mystery \(unknown advisory\)/)
  })

  it('accepts only the one documented advisory', () => {
    expect(Object.keys(ACCEPTED)).toEqual([BRACES])
  })
})
