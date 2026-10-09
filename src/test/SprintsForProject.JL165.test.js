// JL-165 (fosasoft) — which sprints a project's screens offer.
import { describe, it, expect } from 'vitest'
import { sprintsForProject } from '../utils/sprints'

const SPRINTS = [
  { id: 1, projectId: 4, name: 'Ours' },
  { id: 2, projectId: 5, name: 'Theirs' },
  { id: 3, projectId: null, name: 'Shared legacy' },
]

describe('sprintsForProject', () => {
  it('keeps the project\'s own sprints and shared ones, drops other projects\'', () => {
    expect(sprintsForProject(SPRINTS, 4).map((s) => s.id)).toEqual([1, 3])
  })

  it('accepts the project id as a string, as useParams gives it', () => {
    expect(sprintsForProject(SPRINTS, '5').map((s) => s.id)).toEqual([2, 3])
  })

  it('returns everything when no project is in view', () => {
    for (const none of [undefined, null, '']) expect(sprintsForProject(SPRINTS, none)).toHaveLength(3)
  })

  it('survives a missing list and malformed rows', () => {
    expect(sprintsForProject(undefined, 4)).toEqual([])
    expect(sprintsForProject([null, {}, { projectId: 4 }], 4)).toEqual([{}, { projectId: 4 }])
  })
})
