import { env } from 'node:process'

export interface LLMResponseChunk {
  type: 'token' | 'done' | 'error'
  content?: string
  error?: string
}

export type LLMMode = 'baseline' | 'optimized'

export interface LLMProvider {
  stream(prompt: string, onChunk: (chunk: LLMResponseChunk) => void, options?: { mode?: LLMMode }): Promise<void>
}

const demoResponses: Record<string, string> = {
  default: 'The shortest path to low latency is to reduce the largest blocking stage and stream work as soon as it is useful. In voice systems, that usually means streaming STT and LLM output while the user is still in the conversation loop, then beginning TTS on complete sentence chunks instead of waiting for the entire response.',
}

function buildDemoText(prompt: string) {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return demoResponses.default
  }

  const topic = trimmed.length > 32 ? trimmed.slice(0, 32) : trimmed
  return `Here is the direct answer for “${topic}”: ${demoResponses.default}`
}

export class MockLLMProvider implements LLMProvider {
  async stream(prompt: string, onChunk: (chunk: LLMResponseChunk) => void, options?: { mode?: LLMMode }): Promise<void> {
    const text = buildDemoText(prompt)
    const mode = options?.mode ?? 'optimized'
    const chunks = text.split(/(\s+)/).filter(Boolean)

    if (mode === 'baseline') {
      const combined = chunks.join('')
      await new Promise((resolve) => setTimeout(resolve, 680))
      onChunk({ type: 'token', content: combined })
      onChunk({ type: 'done' })
      return
    }

    for (const chunk of chunks) {
      onChunk({ type: 'token', content: chunk })
      await new Promise((resolve) => setTimeout(resolve, 18))
    }

    onChunk({ type: 'done' })
  }
}

export class OpenAIChatProvider implements LLMProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor() {
    this.apiKey = env.OPENAI_API_KEY ?? ''
    this.model = env.OPENAI_MODEL ?? 'gpt-4o-mini'
    this.baseUrl = env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  }

  async stream(prompt: string, onChunk: (chunk: LLMResponseChunk) => void, options?: { mode?: LLMMode }): Promise<void> {
    if (!this.apiKey) {
      const fallback = new MockLLMProvider()
      await fallback.stream(prompt, onChunk, options)
      return
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0.2,
      }),
    })

    if (!response.ok || !response.body) {
      throw new Error(`OpenAI request failed with status ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') {
          continue
        }

        if (!trimmed.startsWith('data:')) {
          continue
        }

        const payload = trimmed.slice(5).trim()
        if (!payload) {
          continue
        }

        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }

          const content = json.choices?.[0]?.delta?.content
          if (content) {
            onChunk({ type: 'token', content })
          }
        } catch {
          onChunk({ type: 'error', error: 'Malformed provider response.' })
        }
      }
    }

    onChunk({ type: 'done' })
  }
}

export function getLlmProvider(): LLMProvider {
  if (env.VOICE_PROVIDER_MODE === 'openai') {
    return new OpenAIChatProvider()
  }

  return new MockLLMProvider()
}
