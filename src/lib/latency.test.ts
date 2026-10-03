import { describe, expect, it } from 'vitest'
import { calculateMedian, calculatePercentile, calculateMean, calculateMin, calculateMax } from './latency'

describe('latency utilities', () => {
  it('computes median and percentile correctly', () => {
    const values = [100, 200, 300, 400, 500]

    expect(calculateMedian(values)).toBe(300)
    expect(calculatePercentile(values, 95)).toBe(500)
    expect(calculateMean(values)).toBe(300)
    expect(calculateMin(values)).toBe(100)
    expect(calculateMax(values)).toBe(500)
  })
})
