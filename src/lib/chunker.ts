export function splitIntoSentenceChunks(text: string, options?: { minChars?: number; maxChars?: number }) {
  const minChars = options?.minChars ?? 40
  const maxChars = options?.maxChars ?? 180
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed]
  const chunks: string[] = []

  for (const sentence of sentences) {
    const cleaned = sentence.trim()
    if (!cleaned) continue

    if (cleaned.length <= maxChars) {
      chunks.push(cleaned)
      continue
    }

    const parts = cleaned.split(/\s+/)
    let current = ''

    for (const part of parts) {
      const candidate = current ? `${current} ${part}` : part
      if (candidate.length > maxChars && current.length >= minChars) {
        chunks.push(current.trim())
        current = part
      } else {
        current = candidate
      }
    }

    if (current.trim()) {
      chunks.push(current.trim())
    }
  }

  return chunks.filter((chunk) => chunk.length >= minChars || chunk.length === trimmed.length)
}

export function createChunkQueue(text: string, options?: { minChars?: number; maxChars?: number }) {
  return splitIntoSentenceChunks(text, options)
}
