// @vitest-environment node
// JL-484: moving an issue to the BACKLOG is a planning action, not a workflow
// step. No seeded workflow has a "-> Backlog" transition, so "Move to backlog",
// dragging onto the Backlog panel and the bulk sprint change were refused in
// every project. Now a move to Backlog skips the transition list, validators
// and approval rules — but a finished issue (workflow terminal state) still
// cannot go back. Every other transition is still governed by the workflow.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())
vi.mock('../services/automation.js', () => ({ runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))
vi.mock('../services/workflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTransitions: vi.fn(),
  loadWorkflowMeta: vi.fn(),
}))
vi.mock('../services/approvals.js', async (importOriginal) => ({
  ...(await importOriginal()),
  evaluateApproval: vi.fn().mockResolvedValue({ required: true, satisfied: false, approverRole: 'Admin', requiredApprovals: 1, approvedCount: 0, remaining: 1 }),
}))

import { loadTransitions, loadWorkflowMeta } from '../services/workflow.js'
import { evaluateApproval } from '../services/approvals.js'
import { checkStatusTransition } from '../routes/issues.js'

// The seeded QA workflow: no "-> Backlog" anywhere; Done is terminal.
const SEEDED = [
  ['Backlog', 'To Do'], ['To Do', 'In Progress'], ['In Progress', 'In Testing'],
  ['In Testing', 'In UAT'], ['In UAT', 'Done'],
].map(([from_status, to_status]) => ({ from_status, to_status }))

beforeEach(() => {
  vi.clearAllMocks()
  loadTransitions.mockResolvedValue(SEEDED)
  loadWorkflowMeta.mockResolvedValue({ cancel_from_any: true, cancel_status: 'Cancelled', terminal_statuses: ['Done', 'Cancelled'] })
})

const issue = (status) => ({ id: 1, project_id: 7, status })

describe('moving to the Backlog is not a workflow transition', () => {
  for (const from of ['To Do', 'In Progress', 'In Testing', 'In UAT']) {
    it(`"${from}" -> Backlog is allowed although the workflow has no such transition`, async () => {
      const result = await checkStatusTransition(issue(from), 'Backlog')
      expect(result.error).toBeUndefined()
      expect(result.workflowTransition).toBeNull() // so no post-functions/validators run
    })
  }

  it('skips approval rules (planning is not a gated transition)', async () => {
    await checkStatusTransition(issue('In Progress'), 'Backlog')
    expect(evaluateApproval).not.toHaveBeenCalled()
  })

  it('a finished issue (terminal state) still cannot go back to the backlog', async () => {
    for (const from of ['Done', 'Cancelled']) {
      const result = await checkStatusTransition(issue(from), 'Backlog')
      expect(result.httpStatus).toBe(409)
      expect(result.error).toBe(`A "${from}" issue is finished and cannot be moved back to the backlog`)
    }
  })

  it('every other move is still governed by the workflow', async () => {
    const skip = await checkStatusTransition(issue('To Do'), 'Done')
    expect(skip.httpStatus).toBe(409)
    expect(skip.error).toBe('Transition from "To Do" to "Done" is not allowed by the workflow')
  })
})
