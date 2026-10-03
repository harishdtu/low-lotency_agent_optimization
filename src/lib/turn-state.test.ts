import { describe, expect, it } from 'vitest'
import { getNextPipelineState } from './turn-state'

describe('pipeline state machine', () => {
  it('moves from listening to processing when speech ends', () => {
    expect(getNextPipelineState('listening', 'speech-end')).toBe('processing')
  })

  it('resets to ready when a turn completes', () => {
    expect(getNextPipelineState('speaking', 'complete')).toBe('ready')
  })
})
