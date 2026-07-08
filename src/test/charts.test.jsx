import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SvgBarChart } from '../components/charts/SvgBarChart'
import { SvgLineChart } from '../components/charts/SvgLineChart'
import { toCSV, escapeCsvValue } from '../utils/reportExport'

describe('SvgBarChart', () => {
  const data = [
    { label: 'Sprint 1', committed: 20, completed: 15 },
    { label: 'Sprint 2', committed: 30, completed: 28 },
    { label: 'Sprint 3', committed: 25, completed: 25 },
  ]
  const series = [
    { key: 'committed', name: 'Committed', color: '#4c9aff' },
    { key: 'completed', name: 'Completed', color: '#36b37e' },
  ]

  it('renders an <svg> element', () => {
    const { container } = render(<SvgBarChart data={data} series={series} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('emits one <rect> bar per data-point per series', () => {
    const { container } = render(<SvgBarChart data={data} series={series} />)
    const bars = container.querySelectorAll('rect.svg-bar')
    // 3 groups x 2 series = 6 bars
    expect(bars).toHaveLength(data.length * series.length)
  })

  it('renders a single-series chart with one bar per data-point', () => {
    const single = [{ key: 'committed', name: 'Committed' }]
    const { container } = render(<SvgBarChart data={data} series={single} />)
    expect(container.querySelectorAll('rect.svg-bar')).toHaveLength(data.length)
  })

  it('handles empty data without crashing', () => {
    const { container } = render(<SvgBarChart data={[]} series={series} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelectorAll('rect.svg-bar')).toHaveLength(0)
  })
})

describe('SvgLineChart', () => {
  const data = [
    { label: 'Mon', value: 5 },
    { label: 'Tue', value: 8 },
    { label: 'Wed', value: 3 },
  ]

  it('renders an <svg> with a path and one circle per point', () => {
    const { container } = render(<SvgLineChart data={data} series={[{ key: 'value', name: 'Value' }]} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('path.svg-line')).toBeInTheDocument()
    expect(container.querySelectorAll('circle.svg-line-point')).toHaveLength(data.length)
  })
})

describe('toCSV', () => {
  it('produces header + rows from sample data', () => {
    const rows = [
      { metric: 'Total Points', value: 42 },
      { metric: 'Velocity Avg', value: 12.5 },
    ]
    const csv = toCSV(rows)
    expect(csv).toBe('metric,value\r\nTotal Points,42\r\nVelocity Avg,12.5')
  })

  it('respects explicit column order and labels', () => {
    const rows = [{ metric: 'A', value: 1 }]
    const csv = toCSV(rows, [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' },
    ])
    expect(csv).toBe('Metric,Value\r\nA,1')
  })

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    const rows = [{ name: 'Doe, John', note: 'says "hi"', multi: 'a\nb' }]
    const csv = toCSV(rows)
    expect(csv).toBe('name,note,multi\r\n"Doe, John","says ""hi""","a\nb"')
  })

  it('returns empty string for no rows', () => {
    expect(toCSV([])).toBe('')
    expect(toCSV(null)).toBe('')
  })

  it('treats null/undefined cells as empty', () => {
    const rows = [{ a: null, b: undefined, c: 0 }]
    expect(toCSV(rows)).toBe('a,b,c\r\n,,0')
  })
})

describe('escapeCsvValue', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvValue('hello')).toBe('hello')
    expect(escapeCsvValue(7)).toBe('7')
  })

  it('quotes values containing special characters', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"')
    expect(escapeCsvValue('a"b')).toBe('"a""b"')
  })
})
