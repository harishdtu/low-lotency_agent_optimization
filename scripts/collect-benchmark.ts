import { writeFileSync } from 'node:fs'

const prompts = [
  'What is the capital of France?',
  'Explain APIs in one sentence.',
  'What is TypeScript?',
  'What is the difference between HTTP and WebSockets?',
  'Give me three tips for learning React.',
  'What is a database?',
  'Explain caching simply.',
  'What does latency mean?',
  'What is Docker?',
  'Explain REST APIs.',
  'What is an event loop?',
  'What is a promise in JavaScript?',
  'Explain PostgreSQL.',
  'What is an API gateway?',
  'What is streaming?',
  'Explain load balancing.',
  'What is WebRTC?',
  'Explain authentication.',
  'What is a vector database?',
  'Explain RAG.',
  'What is a microservice?',
  'What is observability?',
  'Explain rate limiting.',
  'What is a reverse proxy?',
  'How would you design a voice agent?',
]

const modes = ['baseline', 'optimized'] as const

async function collectMode(mode: (typeof modes)[number]) {
  const records: Array<Record<string, unknown>> = []

  for (const prompt of prompts) {
    const startedAt = Date.now()
    const response = await fetch('http://localhost:4101/api/voice/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode }),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Request failed for ${mode}: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let firstTokenAt: number | null = null
    let finalAt: number | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop() ?? ''

      for (const message of messages) {
        const lines = message.split('\n')
        const dataLine = lines.find((line) => line.startsWith('data:'))
        if (!dataLine) continue

        const payload = JSON.parse(dataLine.slice(5)) as { token?: string; error?: string; ok?: boolean }
        if (payload.error) {
          throw new Error(payload.error)
        }

        if (payload.token) {
          const now = Date.now()
          firstTokenAt ??= now
          text += payload.token
        }

        if (payload.ok) {
          finalAt = Date.now()
        }
      }
    }

    const totalMs = finalAt ? finalAt - startedAt : 0
    records.push({
      interaction_id: `${mode}-${records.length + 1}`,
      mode,
      prompt,
      response: text.trim(),
      latencies: {
        llm_ttft: firstTokenAt ? firstTokenAt - startedAt : 0,
        llm_total: totalMs,
      },
      success: Boolean(text.trim()),
      started_at: startedAt,
      finished_at: finalAt ?? startedAt,
    })
  }

  return records
}

const [baseline, optimized] = await Promise.all([collectMode('baseline'), collectMode('optimized')])

writeFileSync('data/baseline.json', JSON.stringify(baseline, null, 2))
writeFileSync('data/optimized.json', JSON.stringify(optimized, null, 2))
console.log(`Collected ${baseline.length} baseline interactions and ${optimized.length} optimized interactions.`)
