export type PipelineState = 'ready' | 'listening' | 'processing' | 'thinking' | 'speaking' | 'interrupted' | 'error'

export function getNextPipelineState(current: PipelineState, event: 'start' | 'speech-end' | 'llm-stream' | 'tts-start' | 'error' | 'interrupt' | 'complete'): PipelineState {
  const transitions: Record<PipelineState, Partial<Record<typeof event, PipelineState>>> = {
    ready: { start: 'listening', error: 'error' },
    listening: { 'speech-end': 'processing', interrupt: 'interrupted', error: 'error' },
    processing: { 'llm-stream': 'thinking', interrupt: 'interrupted', error: 'error' },
    thinking: { 'tts-start': 'speaking', interrupt: 'interrupted', error: 'error', complete: 'ready' },
    speaking: { interrupt: 'interrupted', complete: 'ready', error: 'error' },
    interrupted: { start: 'listening', complete: 'ready' },
    error: { start: 'listening', complete: 'ready' },
  }

  return transitions[current]?.[event] ?? current
}
