import { readFileSync } from 'node:fs'
import { calculateMedian, calculatePercentile, calculateMean, calculateMin, calculateMax } from '../src/lib/latency.ts'

const file = process.argv[2]
if (!file) {
  console.error('Usage: npm run analyze-latency -- data/optimized.json')
  process.exit(1)
}

const payload = JSON.parse(readFileSync(file, 'utf8')) as Array<{ latencies: Record<string, number> }>
if (!payload.length) {
  console.error(`No measurements found in ${file}. Run the benchmark flow first.`)
  process.exit(1)
}

const computeStdDev = (values: number[]) => {
  const mean = calculateMean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

const metrics = Object.keys(payload[0]?.latencies ?? {})

for (const metric of metrics) {
  const values = payload.map((entry) => entry.latencies[metric] ?? 0)
  console.log(`Metric: ${metric}`)
  console.log(`  p50=${calculateMedian(values)}`)
  console.log(`  p75=${calculatePercentile(values, 75)}`)
  console.log(`  p90=${calculatePercentile(values, 90)}`)
  console.log(`  p95=${calculatePercentile(values, 95)}`)
  console.log(`  p99=${calculatePercentile(values, 99)}`)
  console.log(`  mean=${calculateMean(values)}`)
  console.log(`  median=${calculateMedian(values)}`)
  console.log(`  min=${calculateMin(values)}`)
  console.log(`  max=${calculateMax(values)}`)
  console.log(`  stddev=${computeStdDev(values)}`)
}
