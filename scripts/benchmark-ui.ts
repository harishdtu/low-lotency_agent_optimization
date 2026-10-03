import { chromium } from 'playwright'
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

for (const mode of modes) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const records: Array<Record<string, unknown>> = []

  try {
    await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.selectOption('select', mode)

    for (const prompt of prompts) {
      await page.getByRole('button', { name: prompt }).click()
      await page.waitForFunction(() => {
        const cards = Array.from(document.querySelectorAll('.metric-card strong'))
        return cards.some((card) => {
          const text = card.textContent?.trim() ?? ''
          return text !== '0 ms' && text.length > 0
        })
      }, { timeout: 30000 })

      const record = await page.evaluate(() => {
        const getCard = (label: string) => {
          const container = Array.from(document.querySelectorAll('.metric-card')).find((item) => {
            const header = item.querySelector('span')?.textContent?.trim() ?? ''
            return header === label
          })
          return container?.querySelector('strong')?.textContent?.trim() ?? '0 ms'
        }

        const parseNum = (value: string) => Number.parseFloat((value ?? '0').replace(/[^0-9.]/g, '') || '0')

        return {
          utterance: document.querySelector('.transcript-box')?.textContent?.trim() ?? '',
          response: document.querySelector('.response-box')?.textContent?.trim() ?? '',
          mode: (document.querySelector('select') as HTMLSelectElement | null)?.value ?? '',
          latencies: {
            eou: parseNum(getCard('EOU')),
            stt: parseNum(getCard('STT')),
            llm_ttft: parseNum(getCard('LLM TTFT')),
            llm_total: parseNum(getCard('LLM total')),
            tts_ttfa: parseNum(getCard('TTS TTFA')),
            user_to_first_audio: parseNum(getCard('User → first audio')),
          },
          success: Boolean((document.querySelector('.response-box')?.textContent ?? '').trim()),
        }
      })

      records.push({
        interaction_id: `bench-${mode}-${records.length + 1}`,
        mode,
        utterance: record.utterance,
        response: record.response,
        timestamps: {
          captured_at: Date.now(),
        },
        latencies: record.latencies,
        success: record.success,
      })
    }

    writeFileSync(mode === 'baseline' ? 'data/baseline.json' : 'data/optimized.json', JSON.stringify(records, null, 2))
  } finally {
    await browser.close()
  }
}
