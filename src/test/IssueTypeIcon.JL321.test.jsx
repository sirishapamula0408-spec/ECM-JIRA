import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { IssueTypeIcon } from '../pages/IssueDetailPage/IssueDetailPage'

/* JL-321: the issue-type symbol must show a tooltip (title = type name) and use
   Atlassian colour coding (Story green, Task blue, Bug red, Epic purple,
   Sub-task blue). */
describe('JL-321 — IssueTypeIcon', () => {
  const cases = [
    ['Story', '#63BA3C'],
    ['Task', '#4BADE8'],
    ['Bug', '#E5493A'],
    ['Epic', '#904EE2'],
    ['Sub-task', '#4BADE8'],
  ]

  it.each(cases)('%s renders an Atlassian-coloured icon (%s) with a tooltip', (type, color) => {
    const { container } = render(<IssueTypeIcon type={type} />)
    const icon = container.querySelector('.id-type-icon')
    expect(icon).toBeTruthy()
    expect(icon.getAttribute('title')).toBe(type)       // hover tooltip
    expect(icon.getAttribute('aria-label')).toBe(type)  // a11y
    expect(icon.querySelector('rect').getAttribute('fill')).toBe(color)
  })

  it('falls back to the Task icon for an unknown type', () => {
    const { container } = render(<IssueTypeIcon type={'Mystery'} />)
    const icon = container.querySelector('.id-type-icon')
    expect(icon.querySelector('rect').getAttribute('fill')).toBe('#4BADE8')
  })
})
