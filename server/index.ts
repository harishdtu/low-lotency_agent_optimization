import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { getLlmProvider } from './providers/llm.js'

const app = express()
const port = Number(process.env.PORT ?? 4101)

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.VOICE_PROVIDER_MODE ?? 'mock',
    provider: process.env.OPENAI_API_KEY ? 'openai' : 'mock',
    timestamp: Date.now(),
  })
})

app.post('/api/voice/chat-stream', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
  const mode = req.body?.mode === 'baseline' ? 'baseline' : 'optimized'

  if (!prompt) {
    res.status(400).json({ error: 'Missing prompt.' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const provider = getLlmProvider()

  try {
    await provider.stream(prompt, (chunk) => {
      if (chunk.type === 'token' && chunk.content) {
        res.write(`event: token\ndata: ${JSON.stringify({ token: chunk.content })}\n\n`)
      }

      if (chunk.type === 'error' && chunk.error) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: chunk.error })}\n\n`)
      }
    }, { mode })

    res.write(`event: complete\ndata: ${JSON.stringify({ ok: true })}\n\n`)
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM provider failure.'
    res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
    res.end()
  }
})

app.post('/api/voice/chat', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
  const mode = req.body?.mode === 'baseline' ? 'baseline' : 'optimized'

  if (!prompt) {
    res.status(400).json({ error: 'Missing prompt.' })
    return
  }

  const provider = getLlmProvider()
  let text = ''

  try {
    await provider.stream(prompt, (chunk) => {
      if (chunk.type === 'token' && chunk.content) {
        text += chunk.content
      }
    }, { mode })

    res.json({ text, mode: process.env.VOICE_PROVIDER_MODE ?? 'mock' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM provider failure.'
    res.status(500).json({ error: message })
  }
})

app.listen(port, () => {
  console.log(`Voice stack server listening on http://localhost:${port}`)
})
