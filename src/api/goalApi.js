import { api } from './client.js'

// Project-scoped objectives with key results
export const fetchProjectGoals = (projectId) =>
  api(`/api/projects/${projectId}/goals`)

export const fetchGoal = (goalId) =>
  api(`/api/goals/${goalId}`)

export const createGoal = (projectId, { objective, description, owner, status, dueDate }) =>
  api(`/api/projects/${projectId}/goals`, {
    method: 'POST',
    body: JSON.stringify({ objective, description, owner, status, dueDate }),
  })

export const updateGoal = (goalId, patch) =>
  api(`/api/goals/${goalId}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteGoal = (goalId) =>
  api(`/api/goals/${goalId}`, { method: 'DELETE' })

// Key results
export const createKeyResult = (goalId, { title, targetValue, currentValue, unit, issueId }) =>
  api(`/api/goals/${goalId}/key-results`, {
    method: 'POST',
    body: JSON.stringify({ title, targetValue, currentValue, unit, issueId }),
  })

export const updateKeyResult = (keyResultId, patch) =>
  api(`/api/key-results/${keyResultId}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteKeyResult = (keyResultId) =>
  api(`/api/key-results/${keyResultId}`, { method: 'DELETE' })
