export type LatencyMap = Record<string, number>

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))
  return sorted[index]
}

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function calculateMin(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values)
}

export function calculateMax(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values)
}

export function buildLatencySummary(entries: Array<{ latencies: LatencyMap }>) {
  const keys = new Set<string>()

  for (const entry of entries) {
    Object.keys(entry.latencies).forEach((metric) => keys.add(metric))
  }

  const summary = Object.fromEntries(
    [...keys].map((metric) => {
      const values = entries
        .map((entry) => entry.latencies[metric])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      return [
        metric,
        {
          median: calculateMedian(values),
          p95: calculatePercentile(values, 95),
          mean: calculateMean(values),
          min: calculateMin(values),
          max: calculateMax(values),
        },
      ]
    }),
  )

  return summary
}

export function formatMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  return `${Math.max(0, Number(value.toFixed(1)))} ms`
}

export function createInteractionId() {
  return `turn-${Math.random().toString(36).slice(2, 10)}`
}
