import { describe, expect, it } from 'vitest'
import { splitIntoSentenceChunks } from './chunker'

describe('sentence chunker', () => {
  it('splits a response into complete sentence chunks', () => {
    const result = splitIntoSentenceChunks('First sentence. Second sentence. Third sentence.', { minChars: 10, maxChars: 28 })
    expect(result).toEqual(['First sentence.', 'Second sentence.', 'Third sentence.'])
  })
})
