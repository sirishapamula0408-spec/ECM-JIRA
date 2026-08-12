import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BoardPage } from '../pages/BoardPage/BoardPage'

/**
 * ── JL-391: board columns SCROLL instead of capping at five cards ──
 *
 * JL-390 capped each column at five rendered cards behind a "Show N more"
 * expander. JL-391 is a deliberate reversal of that design, not a bug fix:
 * scrolling inside the column is Atlassian Jira's own pattern, it reaches every
 * card with no disclosure step, and the board's shape stays stable however
 * lopsided the statuses are. The expander is therefore REMOVED, and its suite
 * (BoardColumnShowMore.JL390.test.jsx) deleted with it.
 *
 * WHAT THESE TESTS PROVE
 *   - every card in a column renders (no truncation) and no expander exists;
 *   - the card list is a separate element with `overflow-y: auto` in the real
 *     cascade (vite injects BoardPage.css into jsdom — `css: true` in
 *     vite.config.js — so `getComputedStyle` here reads the actual stylesheet,
 *     not a guess);
 *   - the column <header> — and with it the issue count and the JL-355 WIP
 *     indicator — is NOT a descendant of that scroll container, asserted via
 *     `contains()` on the live DOM;
 *   - the count and the over-WIP check still read the FULL issue array;
 *   - cards stay draggable, including one only reachable by scrolling;
 *   - the height bound is viewport-relative and the swimlane variant is a
 *     smaller bound — asserted against the stylesheet source for the single-lane
 *     rule (jsdom's CSSOM drops `max-height: max(...)`, so computed style
 *     returns "" for it) and via computed style for the `-laned` rule.
 *
 * WHAT THESE TESTS DO NOT PROVE
 *   jsdom performs no layout: scrollHeight/clientHeight are always 0, `vh` never
 *     resolves to real pixels, and no scrollbar is ever painted. So nothing here
 *     demonstrates that a column ACTUALLY scrolls, that the chosen height fits a
 *     given viewport, or that the scrollbar looks right in either theme. What is
 *     pinned is the contract — the right element exists, carries the right
 *     overflow/class, declares a viewport-relative bound and theme-aware
 *     scrollbar rules, and the header sits outside it.
 *   Those layout facts were measured separately in real Chromium when JL-391
 *     landed (numbers in the PR): the list overflowed and scrolled, the header
 *     and count did not move by a pixel while the cards moved by the full scroll
 *     distance, the bound resolved to 540/340/940px at 800/600/1200px viewport
 *     heights, and tabbing to the 8th card scrolled it into view unaided. Redo
 *     that in a browser, not here, if the geometry is what you are changing.
 */

const mockHandleMove = vi.fn()

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: mockHandleMove }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canManageProjectSettings: true, canEditIssue: true }),
}))

const mockFetchBoardConfig = vi.fn()
const mockSaveBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...args) => mockFetchBoardConfig(...args),
  saveBoardConfig: (...args) => mockSaveBoardConfig(...args),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'time_estimate', label: 'Original Time Estimate' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))

let mockIssues = []

function issue(id, status, assignee = 'Alice') {
  return {
    id,
    key: `JL-${id}`,
    title: `Issue ${id}`,
    issueType: 'Task',
    status,
    priority: 'Medium',
    assignee,
    projectId: 1,
  }
}

// Build `count` issues in `status`, ids offset so keys stay unique across columns.
function issuesIn(status, count, { from = 1, assignee = 'Alice' } = {}) {
  return Array.from({ length: count }, (_, i) => issue(from + i, status, assignee))
}

const emptyConfig = {
  projectId: 1,
  swimlaneBy: 'none',
  wipLimits: {},
  quickFilters: [],
  estimationStatistic: 'story_points',
  columns: [],
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function getColumn(name, root = document) {
  return root.querySelector(`.kanban-col[data-column="${name}"]`)
}

function cardsIn(root) {
  return root.querySelectorAll('.card.kanban-card-draggable')
}

function scrollListIn(col) {
  return col.querySelector('.kanban-col-cards')
}

function getLane(key) {
  return document.querySelector(`.board-swimlane[data-swimlane="${key}"]`)
}

// ── Stylesheet source, for the declarations jsdom's CSSOM cannot resolve ──
const cssPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'pages', 'BoardPage', 'BoardPage.css',
)
const boardCss = fs.readFileSync(cssPath, 'utf8')

/** The declaration block for an exact selector, comments stripped. */
function ruleBody(selector) {
  const source = boardCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match ? match[2] : null
}

beforeEach(() => {
  window.localStorage.clear()
  mockIssues = []
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

describe('JL-391 — every card renders and the expander is gone', () => {
  it('renders all eight cards of a busy column, untruncated', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(cardsIn(col)).toHaveLength(8))
    // The 6th-8th were the ones JL-390 withheld; all three are present now.
    expect(within(col).getByText('Issue 6')).toBeInTheDocument()
    expect(within(col).getByText('Issue 7')).toBeInTheDocument()
    expect(within(col).getByText('Issue 8')).toBeInTheDocument()
  })

  it('has no "Show N more" expander anywhere on the board', async () => {
    // Two columns each past the old five-card cap: under JL-390 this page had
    // two expanders. There must now be none, by any route to finding one.
    mockIssues = [
      ...issuesIn('To Do', 7, { from: 1 }),
      ...issuesIn('In Progress', 8, { from: 101 }),
    ]
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('To Do'))).toHaveLength(7))
    expect(cardsIn(getColumn('In Progress'))).toHaveLength(8)

    expect(screen.queryAllByRole('button', { name: /show \d+ more/i })).toHaveLength(0)
    expect(screen.queryByText(/show \d+ more/i)).toBeNull()
    expect(screen.queryByText(/show less/i)).toBeNull()
    expect(document.querySelectorAll('.kanban-col-show-more')).toHaveLength(0)
    // ...and no column-level control reports an expanded/collapsed state, since
    // nothing on the board discloses hidden cards any more. (Scoped to direct
    // children of the column: the per-card status lozenges legitimately carry
    // aria-expanded for their own transition menus.)
    expect(document.querySelectorAll('.kanban-col > [aria-expanded]')).toHaveLength(0)
  })

  it('leaves no .kanban-col-show-more rules behind in the stylesheet', () => {
    expect(boardCss).not.toMatch(/kanban-col-show-more/)
  })
})

describe('JL-391 — the card list is the scroll container, the header is outside it', () => {
  it('puts every card inside a distinct .kanban-col-cards element', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    const col = getColumn('In Progress')
    const list = scrollListIn(col)
    expect(list).toBeTruthy()
    expect(list).not.toBe(col)
    // All eight cards live in the list, none loose in the column.
    expect(cardsIn(list)).toHaveLength(8)
    for (const card of cardsIn(col)) expect(list.contains(card)).toBe(true)
  })

  it('gives that element overflow-y: auto in the real cascade', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    const list = scrollListIn(getColumn('In Progress'))
    expect(window.getComputedStyle(list).overflowY).toBe('auto')
    // The COLUMN itself must not be the scroll container.
    expect(window.getComputedStyle(getColumn('In Progress')).overflowY).not.toBe('auto')
  })

  it('bounds the list height relative to the viewport, not in fixed pixels', () => {
    const body = ruleBody('.kanban-col-cards')
    expect(body).toBeTruthy()
    const maxHeight = body.match(/max-height:\s*([^;]+);/)
    expect(maxHeight).toBeTruthy()
    // A `vh` term is the point: a fixed px cap would clip on a short screen and
    // waste space on a tall one.
    expect(maxHeight[1]).toMatch(/\d+(\.\d+)?vh/)
    expect(body).toMatch(/overflow-y:\s*auto/)
    // No fixed `height`/`min-height` that would defeat the bound or inflate a
    // one-card column.
    expect(body).not.toMatch(/(^|[\s;])height:/)
    expect(body).not.toMatch(/min-height:/)
  })

  it('keeps the column header — count and WIP indicator — OUTSIDE the scroll container', async () => {
    mockFetchBoardConfig.mockResolvedValue({ ...emptyConfig, wipLimits: { 'In Progress': 6 } })
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    const col = getColumn('In Progress')
    const list = scrollListIn(col)
    const header = col.querySelector(':scope > header')
    const count = col.querySelector('.kanban-count')
    expect(header).toBeTruthy()
    expect(count).toBeTruthy()

    // The DOM relationship is the whole point: if the count scrolled away with
    // the cards, the column's total and its over-WIP warning would disappear
    // exactly when a busy column needs them most.
    expect(list.contains(header)).toBe(false)
    expect(list.contains(count)).toBe(false)
    expect(count.closest('.kanban-col-cards')).toBeNull()
    expect(header.contains(count)).toBe(true)
    // ...and the header is a sibling that precedes the list.
    expect(list.parentElement).toBe(col)
    expect(header.parentElement).toBe(col)
    expect(header.nextElementSibling).toBe(list)
  })

  it('styles the scrollbar subtly and theme-aware, for both engines', () => {
    const body = ruleBody('.kanban-col-cards')
    // Firefox / standard.
    expect(body).toMatch(/scrollbar-width:\s*thin/)
    expect(body).toMatch(/scrollbar-color:/)
    // Chromium / WebKit.
    expect(boardCss).toMatch(/\.kanban-col-cards::-webkit-scrollbar\s*\{/)
    expect(boardCss).toMatch(/\.kanban-col-cards::-webkit-scrollbar-thumb\s*\{/)
    // Dark theme is handled explicitly — a hardcoded light-grey thumb would
    // read as a bright stripe on the dark canvas.
    expect(ruleBody('.app-theme-dark .kanban-col-cards')).toBeTruthy()
  })
})

describe('JL-391 — the header count and WIP check still read the FULL array', () => {
  it('reports the total for a column of eight', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    expect(getColumn('In Progress').querySelector('.kanban-count').textContent).toBe('8')
  })

  it('still fires the over-WIP indicator for eight issues against a limit of six', async () => {
    mockFetchBoardConfig.mockResolvedValue({ ...emptyConfig, wipLimits: { 'In Progress': 6 } })
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(col.classList.contains('kanban-col-over-wip')).toBe(true))
    const count = col.querySelector('.kanban-count')
    expect(count.textContent).toBe('8 / 6')
    expect(count.classList.contains('kanban-count-over')).toBe(true)
    expect(cardsIn(col)).toHaveLength(8)
  })
})

describe('JL-391 — drag-and-drop survives the scroll container', () => {
  it('keeps every card draggable, including ones only reachable by scrolling', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    for (const card of cardsIn(getColumn('In Progress'))) {
      expect(card.getAttribute('draggable')).toBe('true')
    }
  })

  it('drops the last card of a long column onto another column', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    // The 8th card — the one that needs scrolling to reach in a real browser.
    const cards = cardsIn(getColumn('In Progress'))
    fireEvent.dragStart(cards[7])
    // The drop target is the COLUMN, not a position inside the list, so the
    // scroll offset cannot disturb where a card lands.
    const target = getColumn('Done')
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    await waitFor(() => expect(mockHandleMove).toHaveBeenCalledWith(8, 'Done', null))
  })
})

describe('JL-391 — swimlanes get a smaller bound, not a copy of the single-lane one', () => {
  /*
   * DECISION: the board renders lanes × columns. Giving every lane the full
   * single-lane bound would stack N tall scrollboxes and push lane 2 onwards off
   * the screen. In lane mode the page's own vertical scroll is the primary
   * motion — you scroll THROUGH lanes — so a lane's list gets a much smaller
   * bound (45vh) that only catches a pathological lane. Because it is a
   * max-height, a lane shorter than the bound never scrolls at all.
   */
  it('marks lane card lists with the -laned modifier and single-lane lists without it', async () => {
    mockIssues = [
      ...issuesIn('In Progress', 8, { from: 1, assignee: 'Alice' }),
      ...issuesIn('In Progress', 8, { from: 101, assignee: 'Bob' }),
    ]
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    // Single lane ("No swimlanes") uses the generous bound: no modifier.
    const single = scrollListIn(getColumn('In Progress'))
    expect(single.classList.contains('kanban-col-cards')).toBe(true)
    expect(single.classList.contains('kanban-col-cards-laned')).toBe(false)

    fireEvent.change(screen.getByLabelText('Swimlanes'), { target: { value: 'assignee' } })
    await waitFor(() => expect(getLane('Alice')).toBeTruthy())
    expect(getLane('Bob')).toBeTruthy()

    for (const laneKey of ['Alice', 'Bob']) {
      const list = scrollListIn(getColumn('In Progress', getLane(laneKey)))
      expect(list.classList.contains('kanban-col-cards-laned')).toBe(true)
      // Still no truncation per lane — all eight of that lane's cards render.
      expect(cardsIn(list)).toHaveLength(8)
    }
  })

  it('resolves the lane bound to a smaller viewport-relative height', async () => {
    mockIssues = issuesIn('In Progress', 8, { assignee: 'Alice' })
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Swimlanes'), { target: { value: 'assignee' } })
    await waitFor(() => expect(getLane('Alice')).toBeTruthy())

    const list = scrollListIn(getColumn('In Progress', getLane('Alice')))
    // This one jsdom's CSSOM does keep, so it comes from the real cascade.
    const laned = window.getComputedStyle(list).maxHeight
    expect(laned).toMatch(/^\d+(\.\d+)?vh$/)
    expect(Number.parseFloat(laned)).toBeLessThan(100)
    // And it is strictly smaller than the single-lane bound's vh term.
    const singleVh = Number.parseFloat(
      ruleBody('.kanban-col-cards').match(/max-height:[^;]*?(\d+(?:\.\d+)?)vh/)[1],
    )
    expect(Number.parseFloat(laned)).toBeLessThan(singleVh)
    // Lane lists still scroll — they are bounded, just less generously.
    expect(window.getComputedStyle(list).overflowY).toBe('auto')
  })
})

describe('JL-391 — keyboard / assistive-tech reachability', () => {
  /*
   * FINDING: the scroll container needs neither `tabindex="0"` nor
   * `role="region"`. Every card carries focusable controls (the issue-key link,
   * the copy button, and the status lozenge when the user can edit), so Tab
   * walks into the list and the browser scrolls each focused control into view —
   * which is also what satisfies axe's `scrollable-region-focusable` rule. A
   * `role="region"` per (lane × column) would add a landmark for every cell of
   * the board and drown the real landmarks; a `tabindex="0"` would add a dead
   * tab stop in front of content that is already reachable.
   */
  it('exposes focusable controls on every card in the scroll container', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    const list = scrollListIn(getColumn('In Progress'))
    for (const card of cardsIn(list)) {
      expect(card.querySelectorAll('button').length).toBeGreaterThan(0)
    }
    // The last card — off-screen in a real browser — is focusable, so Tab
    // reaches it and the browser scrolls it into view.
    const lastLink = within(cardsIn(list)[7]).getByRole('button', { name: 'JL-8' })
    lastLink.focus()
    expect(document.activeElement).toBe(lastLink)
    expect(list.contains(document.activeElement)).toBe(true)
  })

  it('adds no redundant tab stop or landmark of its own', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(8))

    const list = scrollListIn(getColumn('In Progress'))
    expect(list.hasAttribute('tabindex')).toBe(false)
    expect(list.hasAttribute('role')).toBe(false)
  })
})
