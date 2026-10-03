import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { splitIntoSentenceChunks } from './lib/chunker'
import { calculateMedian, calculatePercentile, createInteractionId, formatMs } from './lib/latency'
import { type PipelineState } from './lib/turn-state'
import { BrowserSTTProvider, BrowserTTSProvider } from './providers/voiceProviders'

declare global {
  interface Window {
    webkitSpeechRecognition?: any
    SpeechRecognition?: any
  }
}

type LatencyRecord = Partial<Record<string, number>>

type VoiceTelemetry = {
  user_speech_started_at: number
  user_speech_end_reference_at: number
  end_of_turn_detected_at: number
  stt_started_at: number
  stt_first_result_at: number
  stt_final_at: number
  llm_started_at: number
  llm_first_token_at: number
  llm_finished_at: number
  tts_started_at: number
  tts_first_audio_at: number
  tts_finished_at: number
  first_agent_audio_playback_at: number
}

type BenchmarkEntry = {
  interaction_id: string
  mode: 'baseline' | 'optimized'
  prompt: string
  prompt_index: number
  success: boolean
  failure_reason?: string
  latencies: LatencyRecord
  telemetry: Partial<VoiceTelemetry>
  completed_at: number
}

type BenchmarkData = {
  baseline: BenchmarkEntry[]
  optimized: BenchmarkEntry[]
}

type BenchmarkProgress = {
  mode: 'baseline' | 'optimized'
  currentPromptIndex: number
  validCount: number
  failedCount: number
  started: boolean
  completed: boolean
}

type InteractionState = {
  interactionId: string
  user_speech_started_at?: number
  user_speech_end_reference_at?: number
  end_of_turn_detected_at?: number
  stt_started_at?: number
  stt_first_result_at?: number
  stt_final_at?: number
  llm_started_at?: number
  llm_first_token_at?: number
  llm_finished_at?: number
  tts_started_at?: number
  tts_first_audio_at?: number
  tts_finished_at?: number
  first_agent_audio_playback_at?: number
}

const samplePrompts = [
  'What is the capital of France?',
  'Explain what an API is in one sentence.',
  'Give me three quick tips for learning TypeScript.',
  'What is the difference between REST and WebSockets?',
]

const benchmarkPrompts = [
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

const benchmarkStorageKey = 'voice-benchmark-data-v1'
const benchmarkProgressStorageKey = 'voice-benchmark-progress-v1'
const benchmarkMetricKeys = [
  'eou_detection_latency_ms',
  'stt_latency_ms',
  'llm_ttft_ms',
  'llm_total_ms',
  'tts_ttfa_ms',
  'user_to_first_audio_ms',
] as const

const requiredTelemetryKeys: Array<keyof VoiceTelemetry> = [
  'user_speech_started_at',
  'user_speech_end_reference_at',
  'end_of_turn_detected_at',
  'stt_started_at',
  'stt_first_result_at',
  'stt_final_at',
  'llm_started_at',
  'llm_first_token_at',
  'llm_finished_at',
  'tts_started_at',
  'tts_first_audio_at',
  'first_agent_audio_playback_at',
]

const hasRequiredTelemetry = (telemetry: Partial<VoiceTelemetry>): boolean =>
  requiredTelemetryKeys.every((key) => {
    const value = telemetry[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
  })

const safeJsonParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const getClientTimestampMs = (): number => {
  if (typeof performance === 'undefined' || typeof performance.timeOrigin !== 'number') {
    throw new Error('performance.timeOrigin is required for valid browser timestamps.')
  }

  return performance.timeOrigin + performance.now()
}

const buildLatencyRecord = (current: InteractionState | null | undefined): LatencyRecord => {
  if (!current) {
    return {}
  }

  const eouDetectionLatency =
    typeof current.end_of_turn_detected_at === 'number' && typeof current.user_speech_end_reference_at === 'number'
      ? current.end_of_turn_detected_at - current.user_speech_end_reference_at
      : undefined

  const sttLatency =
    typeof current.stt_final_at === 'number' && typeof current.stt_started_at === 'number'
      ? current.stt_final_at - current.stt_started_at
      : undefined

  const llmTTFT =
    typeof current.llm_first_token_at === 'number' && typeof current.llm_started_at === 'number'
      ? current.llm_first_token_at - current.llm_started_at
      : undefined

  const llmTotal =
    typeof current.llm_finished_at === 'number' && typeof current.llm_started_at === 'number'
      ? current.llm_finished_at - current.llm_started_at
      : undefined

  const ttsTTFA =
    typeof current.tts_first_audio_at === 'number' && typeof current.tts_started_at === 'number'
      ? current.tts_first_audio_at - current.tts_started_at
      : undefined

  const userToFirstAudio =
    typeof current.first_agent_audio_playback_at === 'number' && typeof current.user_speech_end_reference_at === 'number'
      ? current.first_agent_audio_playback_at - current.user_speech_end_reference_at
      : undefined

  const latency: LatencyRecord = {}
  if (typeof eouDetectionLatency === 'number' && Number.isFinite(eouDetectionLatency)) {
    latency.eou_detection_latency_ms = eouDetectionLatency
  }
  if (typeof sttLatency === 'number' && Number.isFinite(sttLatency)) {
    latency.stt_latency_ms = sttLatency
  }
  if (typeof llmTTFT === 'number' && Number.isFinite(llmTTFT)) {
    latency.llm_ttft_ms = llmTTFT
  }
  if (typeof llmTotal === 'number' && Number.isFinite(llmTotal)) {
    latency.llm_total_ms = llmTotal
  }
  if (typeof ttsTTFA === 'number' && Number.isFinite(ttsTTFA)) {
    latency.tts_ttfa_ms = ttsTTFA
  }
  if (typeof userToFirstAudio === 'number' && Number.isFinite(userToFirstAudio)) {
    latency.user_to_first_audio_ms = userToFirstAudio
  }

  return latency
}

const buildTelemetryRecord = (current: InteractionState | null | undefined): Partial<VoiceTelemetry> => {
  if (!current) {
    return {}
  }

  return {
    user_speech_started_at: current.user_speech_started_at,
    user_speech_end_reference_at: current.user_speech_end_reference_at,
    end_of_turn_detected_at: current.end_of_turn_detected_at,
    stt_started_at: current.stt_started_at,
    stt_first_result_at: current.stt_first_result_at,
    stt_final_at: current.stt_final_at,
    llm_started_at: current.llm_started_at,
    llm_first_token_at: current.llm_first_token_at,
    llm_finished_at: current.llm_finished_at,
    tts_started_at: current.tts_started_at,
    tts_first_audio_at: current.tts_first_audio_at,
    tts_finished_at: current.tts_finished_at,
    first_agent_audio_playback_at: current.first_agent_audio_playback_at,
  }
}

const validateInteractionOrdering = (current: InteractionState | null | undefined) => {
  if (!current) {
    return { valid: false, reasons: ['missing interaction'], raw: {} }
  }

  const raw = {
    user_speech_end_reference_at: current.user_speech_end_reference_at,
    end_of_turn_detected_at: current.end_of_turn_detected_at,
    stt_started_at: current.stt_started_at,
    stt_first_result_at: current.stt_first_result_at,
    stt_final_at: current.stt_final_at,
    first_agent_audio_playback_at: current.first_agent_audio_playback_at,
  }

  const reasons: string[] = []

  if (
    typeof current.stt_started_at === 'number' &&
    typeof current.stt_first_result_at === 'number' &&
    current.stt_first_result_at < current.stt_started_at
  ) {
    reasons.push('stt_first_result_at < stt_started_at')
  }

  if (
    typeof current.stt_started_at === 'number' &&
    typeof current.stt_final_at === 'number' &&
    current.stt_final_at < current.stt_started_at
  ) {
    reasons.push('stt_final_at < stt_started_at')
  }

  if (
    typeof current.stt_first_result_at === 'number' &&
    typeof current.stt_final_at === 'number' &&
    current.stt_final_at < current.stt_first_result_at
  ) {
    reasons.push('stt_final_at < stt_first_result_at')
  }

  if (
    typeof current.stt_started_at === 'number' &&
    typeof current.end_of_turn_detected_at === 'number' &&
    current.stt_started_at < current.end_of_turn_detected_at
  ) {
    reasons.push('stt_started_at < end_of_turn_detected_at')
  }

  if (
    typeof current.first_agent_audio_playback_at === 'number' &&
    typeof current.user_speech_end_reference_at === 'number' &&
    current.first_agent_audio_playback_at < current.user_speech_end_reference_at
  ) {
    reasons.push('first_agent_audio_playback_at < user_speech_end_reference_at')
  }

  return {
    valid: reasons.length === 0,
    reasons,
    raw,
  }
}

const buildBenchmarkSummary = (entries: BenchmarkEntry[]) => {
  const validEntries = entries.filter((entry) => entry.success && hasRequiredTelemetry(entry.telemetry))
  const summary = {} as Record<(typeof benchmarkMetricKeys)[number], { median: number | undefined; p95: number | undefined }>

  for (const key of benchmarkMetricKeys) {
    const values = validEntries
      .map((entry) => entry.latencies[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    summary[key] = {
      median: values.length ? calculateMedian(values) : undefined,
      p95: values.length ? calculatePercentile(values, 95) : undefined,
    }
  }

  return {
    total: validEntries.length,
    metrics: summary,
  }
}

function App() {
  const [state, setState] = useState<PipelineState>('ready')
  const [transcript, setTranscript] = useState('')
  const [agentResponse, setAgentResponse] = useState('')
  const [statusText, setStatusText] = useState('Ready')
  const [error, setError] = useState('')
  const [metricsOpen, setMetricsOpen] = useState(true)
  const [latency, setLatency] = useState<LatencyRecord>({})
  const [interactionCount, setInteractionCount] = useState(0)
  const [mode, setMode] = useState<'baseline' | 'optimized'>('baseline')
  const [benchmarkPromptIndex, setBenchmarkPromptIndex] = useState(0)
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData>(() =>
    safeJsonParse<BenchmarkData>(localStorage.getItem(benchmarkStorageKey), { baseline: [], optimized: [] }),
  )
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress>(() =>
    safeJsonParse<BenchmarkProgress>(localStorage.getItem(benchmarkProgressStorageKey), {
      mode: 'baseline',
      currentPromptIndex: 0,
      validCount: 0,
      failedCount: 0,
      started: false,
      completed: false,
    }),
  )

  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const vadTimerRef = useRef<number | null>(null)
  const interactionRef = useRef<InteractionState | null>(null)
  const activeInteractionIdRef = useRef<string | null>(null)
  const sttProviderRef = useRef<{ stop: () => void } | null>(null)
  const benchmarkModeRef = useRef<'baseline' | 'optimized'>('baseline')
  const benchmarkPromptRef = useRef<string | null>(null)
  const benchmarkTurnPersistedRef = useRef(false)
  const benchmarkValidationLoggedRef = useRef(false)
  const ttsQueueRef = useRef<string[]>([])
  const ttsPlayingRef = useRef(false)
  const lastVoiceFrameAtRef = useRef<number | null>(null)

  const currentModeEntries = benchmarkData[mode]
  const currentModeValidEntries = currentModeEntries.filter((entry) => entry.success)
  const currentModeFailedEntries = currentModeEntries.filter((entry) => !entry.success)
  const benchmarkSummary = useMemo(() => buildBenchmarkSummary(currentModeEntries), [currentModeEntries])
  const baselineSummary = useMemo(() => buildBenchmarkSummary(benchmarkData.baseline), [benchmarkData.baseline])
  const optimizedSummary = useMemo(() => buildBenchmarkSummary(benchmarkData.optimized), [benchmarkData.optimized])

  const currentBenchmarkPrompt = benchmarkPrompts[benchmarkPromptIndex] ?? benchmarkPrompts[0]

  useEffect(() => {
    benchmarkModeRef.current = mode
  }, [mode])

  useEffect(() => {
    setMode(benchmarkProgress.mode)
    setBenchmarkPromptIndex(Math.min(benchmarkProgress.currentPromptIndex, benchmarkPrompts.length - 1))
  }, [benchmarkProgress])

  const persistBenchmarkProgress = (nextProgress: BenchmarkProgress) => {
    setBenchmarkProgress(nextProgress)
    localStorage.setItem(benchmarkProgressStorageKey, JSON.stringify(nextProgress))
  }

  const updateLatency = (next: Partial<InteractionState>) => {
    const current = interactionRef.current ?? { interactionId: createInteractionId() }
    interactionRef.current = { ...current, ...next }
    setLatency(buildLatencyRecord(interactionRef.current))
  }

  const stopSpeech = () => {
    window.speechSynthesis.cancel()
  }

  const safeSetState = (nextState: PipelineState, message: string) => {
    setState(nextState)
    setStatusText(message)
  }

  const appendBenchmarkEntry = (entry: BenchmarkEntry) => {
    setBenchmarkData((previous) => {
      const modeEntries = previous[entry.mode]
      const existingIndex = modeEntries.findIndex((item) => item.interaction_id === entry.interaction_id)
      const nextEntries = existingIndex >= 0 ? modeEntries.map((item, index) => (index === existingIndex ? entry : item)) : [...modeEntries, entry]
      const nextData = { ...previous, [entry.mode]: nextEntries }
      localStorage.setItem(benchmarkStorageKey, JSON.stringify(nextData))

      const validCount = nextEntries.filter((item) => item.success).length
      const failedCount = nextEntries.filter((item) => !item.success).length
      const nextPromptIndex = entry.success ? Math.min(benchmarkPromptIndex + 1, benchmarkPrompts.length - 1) : benchmarkPromptIndex

      persistBenchmarkProgress({
        mode: entry.mode,
        currentPromptIndex: nextPromptIndex,
        validCount,
        failedCount,
        started: validCount < 25,
        completed: validCount >= 25,
      })

      if (entry.success) {
        setBenchmarkPromptIndex(nextPromptIndex)
      }

      return nextData
    })
  }

  const exportBenchmarkData = (selectedMode: 'baseline' | 'optimized' = mode) => {
    const payload = JSON.stringify(benchmarkData[selectedMode], null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = selectedMode === 'baseline' ? 'voice-baseline.json' : 'voice-optimized.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const beginInteraction = () => {
    const id = createInteractionId()
    activeInteractionIdRef.current = id
    interactionRef.current = {
      interactionId: id,
      user_speech_started_at: getClientTimestampMs(),
    }
    lastVoiceFrameAtRef.current = null
    benchmarkTurnPersistedRef.current = false
    benchmarkValidationLoggedRef.current = false
    setInteractionCount((count) => count + 1)
    setTranscript('')
    setAgentResponse('')
    setError('')
    setLatency({})
  }

  const finalizeBenchmarkTurn = () => {
    const current = interactionRef.current
    if (!current || !benchmarkPromptRef.current || benchmarkTurnPersistedRef.current) {
      return
    }

    const telemetry = buildTelemetryRecord(current)
    const latencies = buildLatencyRecord(current)
    const requiredMissing = requiredTelemetryKeys.filter((key) => {
      const value = telemetry[key]
      return typeof value !== 'number' || !Number.isFinite(value) || value < 0
    })
    const eou = typeof current.end_of_turn_detected_at === 'number' && typeof current.user_speech_end_reference_at === 'number'
      ? current.end_of_turn_detected_at - current.user_speech_end_reference_at
      : undefined
    const stt = typeof current.stt_final_at === 'number' && typeof current.stt_started_at === 'number'
      ? current.stt_final_at - current.stt_started_at
      : undefined
    const llmTtft = typeof current.llm_first_token_at === 'number' && typeof current.llm_started_at === 'number'
      ? current.llm_first_token_at - current.llm_started_at
      : undefined
    const ttsTtfa = typeof current.tts_first_audio_at === 'number' && typeof current.tts_started_at === 'number'
      ? current.tts_first_audio_at - current.tts_started_at
      : undefined
    const userToFirstAudio =
      typeof current.first_agent_audio_playback_at === 'number' && typeof current.user_speech_end_reference_at === 'number'
        ? current.first_agent_audio_playback_at - current.user_speech_end_reference_at
        : undefined

    const ordering = validateInteractionOrdering(current)
    const valid =
      typeof current.first_agent_audio_playback_at === 'number' &&
      Number.isFinite(current.first_agent_audio_playback_at) &&
      requiredMissing.length === 0 &&
      typeof userToFirstAudio === 'number' &&
      Number.isFinite(userToFirstAudio) &&
      typeof latencies.user_to_first_audio_ms === 'number' &&
      Number.isFinite(latencies.user_to_first_audio_ms) &&
      ordering.valid

    if (import.meta.env.DEV) {
      console.log('BENCHMARK FINALIZE', {
        user_speech_end_reference_at: current.user_speech_end_reference_at,
        end_of_turn_detected_at: current.end_of_turn_detected_at,
        stt_started_at: current.stt_started_at,
        stt_first_result_at: current.stt_first_result_at,
        stt_final_at: current.stt_final_at,
        first_agent_audio_playback_at: current.first_agent_audio_playback_at,
        user_to_first_audio_ms: userToFirstAudio,
        EOU: eou,
        STT: stt,
        LLM_TTFT: llmTtft,
        TTS_TTFA: ttsTtfa,
        valid,
        requiredMissing,
        ordering,
      })
    }

    if (!valid) {
      const invalidReason = ordering.reasons.length > 0 ? ordering.reasons.join('; ') : 'missing required telemetry'
      console.warn('INVALID TIMESTAMP ORDERING', { ...ordering.raw, reason: invalidReason })
      benchmarkTurnPersistedRef.current = true
      appendBenchmarkEntry({
        interaction_id: current.interactionId,
        mode: benchmarkModeRef.current,
        prompt: benchmarkPromptRef.current ?? (transcript || 'manual benchmark turn'),
        prompt_index: benchmarkPromptIndex,
        success: false,
        failure_reason: `Invalid timestamp ordering: ${invalidReason}`,
        latencies,
        telemetry,
        completed_at: getClientTimestampMs(),
      })
      return
    }

    const entry: BenchmarkEntry = {
      interaction_id: current.interactionId,
      mode: benchmarkModeRef.current,
      prompt: benchmarkPromptRef.current ?? (transcript || 'manual benchmark turn'),
      prompt_index: benchmarkPromptIndex,
      success: true,
      failure_reason: undefined,
      latencies,
      telemetry,
      completed_at: getClientTimestampMs(),
    }

    benchmarkTurnPersistedRef.current = true
    appendBenchmarkEntry(entry)
  }

  const recordBenchmarkFailure = (reason: string) => {
    const current = interactionRef.current
    if (benchmarkTurnPersistedRef.current || current?.first_agent_audio_playback_at) {
      return
    }

    const prompt = benchmarkPromptRef.current ?? currentBenchmarkPrompt
    const modeForEntry = benchmarkModeRef.current
    const failedEntry: BenchmarkEntry = {
      interaction_id: current?.interactionId ?? `${modeForEntry}-${getClientTimestampMs()}`,
      mode: modeForEntry,
      prompt,
      prompt_index: benchmarkPromptIndex,
      success: false,
      failure_reason: reason,
      latencies: buildLatencyRecord(current),
      telemetry: buildTelemetryRecord(current),
      completed_at: getClientTimestampMs(),
    }

    appendBenchmarkEntry(failedEntry)
  }

  const flushQueuedTts = () => {
    if (ttsPlayingRef.current || ttsQueueRef.current.length === 0) {
      return
    }

    const chunk = ttsQueueRef.current.shift()
    if (!chunk) {
      return
    }

    const currentTurn = interactionRef.current
    if (!currentTurn?.tts_started_at) {
      currentTurn!.tts_started_at = getClientTimestampMs()
      updateLatency({ tts_started_at: currentTurn!.tts_started_at })
    }

    ttsPlayingRef.current = true
    const provider = new BrowserTTSProvider()
    provider.speak(
      chunk,
      () => {
        const turn = interactionRef.current
        if (!turn) {
          return
        }

        turn.tts_first_audio_at ??= getClientTimestampMs()
        turn.first_agent_audio_playback_at ??= turn.tts_first_audio_at
        updateLatency({
          tts_first_audio_at: turn.tts_first_audio_at,
          first_agent_audio_playback_at: turn.first_agent_audio_playback_at,
        })

        if (benchmarkPromptRef.current && turn.llm_finished_at) {
          finalizeBenchmarkTurn()
        }

        safeSetState('speaking', 'Speaking')
      },
      () => {
        const failureMessage = 'TTS failed. Please try again.'
        setError(failureMessage)
        recordBenchmarkFailure(failureMessage)
        safeSetState('error', 'Error')
      },
      () => {
        const turn = interactionRef.current
        if (turn) {
          turn.tts_finished_at = getClientTimestampMs()
          updateLatency({ tts_finished_at: turn.tts_finished_at })
        }

        if (benchmarkPromptRef.current && interactionRef.current?.first_agent_audio_playback_at && interactionRef.current?.llm_finished_at) {
          finalizeBenchmarkTurn()
        }

        ttsPlayingRef.current = false
        if (ttsQueueRef.current.length > 0) {
          setTimeout(() => flushQueuedTts(), 80)
        }
      },
    )
  }

  const enqueueTtsChunk = (chunk: string) => {
    const trimmed = chunk.trim()
    if (!trimmed) {
      return
    }

    ttsQueueRef.current.push(trimmed)
    if (!ttsPlayingRef.current) {
      flushQueuedTts()
    }
  }

  const flushResponse = (text: string) => {
    const chunks = splitIntoSentenceChunks(text, { minChars: 40, maxChars: 180 })
    if (!chunks.length) {
      return
    }

    const current = interactionRef.current
    if (!current?.tts_started_at) {
      const startedAt = getClientTimestampMs()
      current!.tts_started_at = startedAt
      updateLatency({ tts_started_at: startedAt })
    }

    chunks.forEach((chunk, index) => {
      if (index === 0) {
        enqueueTtsChunk(chunk)
        return
      }

      setTimeout(() => enqueueTtsChunk(chunk), index * 220)
    })
  }

  const startBenchmark = (selectedMode: 'baseline' | 'optimized') => {
    sttProviderRef.current?.stop()
    sttProviderRef.current = null
    setMode(selectedMode)
    benchmarkModeRef.current = selectedMode
    setBenchmarkPromptIndex(0)
    benchmarkPromptRef.current = benchmarkPrompts[0]

    const resetData = {
      ...benchmarkData,
      [selectedMode]: [],
    }
    setBenchmarkData(resetData)
    localStorage.setItem(benchmarkStorageKey, JSON.stringify(resetData))

    const resetProgress: BenchmarkProgress = {
      mode: selectedMode,
      currentPromptIndex: 0,
      validCount: 0,
      failedCount: 0,
      started: true,
      completed: false,
    }
    persistBenchmarkProgress(resetProgress)
    startListening()
  }

  useEffect(() => {
    return () => {
      stopSpeech()
      sttProviderRef.current?.stop()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [])

  const streamLLM = async (prompt: string, selectedMode: 'baseline' | 'optimized' = mode) => {
    const startAt = getClientTimestampMs()
    const current = interactionRef.current
    if (current) {
      current.llm_started_at = startAt
    }
    updateLatency({ llm_started_at: startAt })
    safeSetState('thinking', 'Thinking')

    const response = await fetch('/api/voice/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode: selectedMode }),
    })

    if (!response.ok || !response.body) {
      throw new Error('Unable to reach the LLM service.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let partialText = ''
    let firstTokenSeen = false
    let finalText = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop() ?? ''

      for (const message of messages) {
        const lines = message.split('\n')
        const dataLine = lines.find((line) => line.startsWith('data:'))
        if (!dataLine) {
          continue
        }

        const payload = JSON.parse(dataLine.slice(5)) as { token?: string; error?: string; ok?: boolean }

        if (payload.error) {
          throw new Error(payload.error)
        }

        if (payload.token) {
          if (!firstTokenSeen) {
            const firstTokenAt = getClientTimestampMs()
            const currentTurn = interactionRef.current
            if (currentTurn) {
              currentTurn.llm_first_token_at = firstTokenAt
            }
            updateLatency({ llm_first_token_at: firstTokenAt })
            firstTokenSeen = true
          }

          partialText += payload.token
          finalText += payload.token
          setAgentResponse((prev) => `${prev}${payload.token}`)

          if (selectedMode === 'optimized') {
            const chunkReady = splitIntoSentenceChunks(partialText, { minChars: 40, maxChars: 180 })
            if (chunkReady.length > 0) {
              const readyChunk = chunkReady[0]
              if (readyChunk.length >= 40 && partialText.startsWith(readyChunk)) {
                flushResponse(readyChunk)
                partialText = partialText.slice(readyChunk.length)
              }
            }
          }
        }
      }
    }

    const currentTurn = interactionRef.current
    if (currentTurn) {
      currentTurn.llm_finished_at = getClientTimestampMs()
      updateLatency({ llm_finished_at: currentTurn.llm_finished_at })
    }

    if (!finalText.trim()) {
      const failureMessage = 'The model returned an empty response.'
      setError(failureMessage)
      recordBenchmarkFailure(failureMessage)
      safeSetState('error', 'Error')
      return
    }

    const remaining = partialText.trim()
    if (selectedMode === 'baseline') {
      if (remaining) {
        flushResponse(remaining)
      }
    } else if (remaining) {
      flushResponse(remaining)
    }

    if (interactionRef.current?.first_agent_audio_playback_at) {
      finalizeBenchmarkTurn()
    }
  }

  const handleTurnSubmission = async (finalTranscript: string) => {
    const turnText = finalTranscript.trim()
    if (!turnText) {
      return
    }

    const currentTurn = interactionRef.current
    if (currentTurn) {
      currentTurn.stt_final_at = getClientTimestampMs()
      updateLatency({ stt_final_at: currentTurn.stt_final_at })
    }

    setTranscript(turnText)
    safeSetState('processing', 'Processing')

    try {
      await streamLLM(turnText, mode)
      safeSetState('ready', 'Ready')
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : 'An unexpected error occurred.'
      setError(message)
      recordBenchmarkFailure(message)
      safeSetState('error', 'Error')
    }
  }

  const startListening = async () => {
    sttProviderRef.current?.stop()
    sttProviderRef.current = null
    beginInteraction()
    benchmarkPromptRef.current = benchmarkPrompts[benchmarkPromptIndex] ?? benchmarkPrompts[0]
    stopSpeech()
    setError('')
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not available in this browser.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtor) {
        throw new Error('Web Audio is not supported in this browser.')
      }

      const context = new AudioCtor()
      audioContextRef.current = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      const source = context.createMediaStreamSource(stream)
      source.connect(analyser)

      const payload = new Uint8Array(analyser.fftSize)
      const silenceThreshold = 0.055
      const sampleWindowMs = 420

      const silenceCheck = () => {
        analyser.getByteTimeDomainData(payload)
        let sum = 0
        for (let index = 0; index < payload.length; index += 1) {
          const sample = (payload[index] - 128) / 128
          sum += sample * sample
        }

        const rms = Math.sqrt(sum / payload.length)
        const currentTurn = interactionRef.current

        if (rms > silenceThreshold) {
          const now = getClientTimestampMs()
          lastVoiceFrameAtRef.current = now
          currentTurn!.user_speech_started_at ??= now
          updateLatency({ user_speech_started_at: currentTurn!.user_speech_started_at })
          if (silenceTimerRef.current) {
            window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
          return
        }

        if (currentTurn?.user_speech_started_at && !currentTurn.user_speech_end_reference_at && !silenceTimerRef.current) {
          silenceTimerRef.current = window.setTimeout(() => {
            const turn = interactionRef.current
            if (!turn || turn.user_speech_end_reference_at || !lastVoiceFrameAtRef.current) {
              return
            }

            const lastVoiceFrame = lastVoiceFrameAtRef.current
            const detectedAt = getClientTimestampMs()
            turn.user_speech_end_reference_at = lastVoiceFrame
            turn.end_of_turn_detected_at = detectedAt
            updateLatency({
              user_speech_end_reference_at: lastVoiceFrame,
              end_of_turn_detected_at: detectedAt,
            })

            const sttProvider = new BrowserSTTProvider()
            const startedAt = getClientTimestampMs()
            turn.stt_started_at = startedAt
            updateLatency({ stt_started_at: startedAt })

            sttProviderRef.current = sttProvider.start(stream, {
              onInterim: (text) => {
                if (!text.trim()) {
                  return
                }

                setTranscript(text)
                const activeTurn = interactionRef.current
                if (!activeTurn || activeTurn.interactionId !== activeInteractionIdRef.current) {
                  return
                }

                if (typeof activeTurn.stt_started_at === 'number' && typeof activeTurn.stt_first_result_at === 'undefined') {
                  const firstResultAt = getClientTimestampMs()
                  activeTurn.stt_first_result_at = firstResultAt
                  updateLatency({ stt_first_result_at: firstResultAt })
                }
              },
              onFinal: (text) => {
                const finalText = text.trim()
                if (!finalText) {
                  return
                }

                const activeTurn = interactionRef.current
                if (!activeTurn || activeTurn.interactionId !== activeInteractionIdRef.current) {
                  return
                }

                if (typeof activeTurn.stt_final_at === 'number') {
                  return
                }

                activeTurn.stt_final_at = getClientTimestampMs()
                updateLatency({ stt_final_at: activeTurn.stt_final_at })
                void handleTurnSubmission(finalText)
              },
              onError: (message) => {
                const failureMessage = message || 'Speech recognition failed.'
                setError(failureMessage)
                recordBenchmarkFailure(failureMessage)
                safeSetState('error', 'Error')
              },
            })

            safeSetState('processing', 'Processing audio')
          }, sampleWindowMs)
        }
      }

      vadTimerRef.current = window.setInterval(silenceCheck, 120)
      safeSetState('listening', 'Listening')
    } catch (error_) {
      const message = error_ instanceof Error ? error_.message : 'Microphone access is unavailable.'
      setError(message)
      recordBenchmarkFailure(message)
      safeSetState('error', 'Error')
    }
  }

  const stopListening = () => {
    sttProviderRef.current?.stop()
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    if (audioContextRef.current) {
      void audioContextRef.current.close()
    }
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    safeSetState('ready', 'Ready')
  }

  const medianUserFirstAudio = benchmarkSummary.metrics.user_to_first_audio_ms?.median
  const p95UserFirstAudio = benchmarkSummary.metrics.user_to_first_audio_ms?.p95
  const baselineMedian = baselineSummary.metrics.user_to_first_audio_ms?.median
  const baselineP95 = baselineSummary.metrics.user_to_first_audio_ms?.p95
  const optimizedMedian = optimizedSummary.metrics.user_to_first_audio_ms?.median
  const optimizedP95 = optimizedSummary.metrics.user_to_first_audio_ms?.p95
  const improvementDelta = typeof baselineMedian === 'number' && typeof optimizedMedian === 'number' ? baselineMedian - optimizedMedian : undefined
  const improvementPercentage = typeof baselineMedian === 'number' && baselineMedian > 0 && typeof improvementDelta === 'number' ? (improvementDelta / baselineMedian) * 100 : 0

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Voice Agent Stack</p>
          <h1>Low-Latency Voice Agent</h1>
        </div>
        <button type="button" className="primary-button" onClick={state === 'listening' ? stopListening : startListening}>
          {state === 'listening' ? 'Stop' : 'Start'}
        </button>
      </header>

      <div className="status-row">
        <span className={`status-pill status-${state}`}>{statusText}</span>
        <span className="status-meta">Interaction #{interactionCount || 0}</span>
        <label className="mode-switch">
          <span>Mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as 'baseline' | 'optimized')}>
            <option value="baseline">Baseline</option>
            <option value="optimized">Optimized</option>
          </select>
        </label>
      </div>

      <section className="panel-grid">
        <div className="panel panel-large">
          <h2>Transcript</h2>
          <div className="transcript-box">{transcript || 'Waiting for speech input...'}</div>
        </div>

        <div className="panel panel-large">
          <h2>Agent response</h2>
          <div className="response-box">{agentResponse || 'The first audio response will appear here.'}</div>
        </div>
      </section>

      <section className="metrics-panel">
        <div className="metrics-header">
          <h2>Latency dashboard</h2>
          <button type="button" className="ghost-button" onClick={() => setMetricsOpen((value) => !value)}>
            {metricsOpen ? 'Hide' : 'Show'} metrics
          </button>
        </div>

        {metricsOpen && (
          <div className="metrics-grid">
            <div className="metric-card">
              <span>EOU</span>
              <strong>{formatMs(latency.eou_detection_latency_ms)}</strong>
            </div>
            <div className="metric-card">
              <span>STT</span>
              <strong>{formatMs(latency.stt_latency_ms)}</strong>
            </div>
            <div className="metric-card">
              <span>LLM TTFT</span>
              <strong>{formatMs(latency.llm_ttft_ms)}</strong>
            </div>
            <div className="metric-card">
              <span>LLM total</span>
              <strong>{formatMs(latency.llm_total_ms)}</strong>
            </div>
            <div className="metric-card">
              <span>TTS TTFA</span>
              <strong>{formatMs(latency.tts_ttfa_ms)}</strong>
            </div>
            <div className="metric-card">
              <span>User → first audio</span>
              <strong>{formatMs(latency.user_to_first_audio_ms)}</strong>
            </div>
          </div>
        )}
      </section>

      <section className="benchmark panel">
        <div className="benchmark-header">
          <div>
            <h2>Manual benchmark</h2>
            <p>Use the real browser microphone, speak the prompt naturally, and wait for the assistant audio before advancing.</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => exportBenchmarkData(mode)}>
            Export {mode === 'baseline' ? 'Baseline' : 'Optimized'} JSON
          </button>
        </div>

        <div className="benchmark-grid">
          <div className="benchmark-actions-row">
            <button type="button" className="primary-button" onClick={() => startBenchmark('baseline')}>
              Start Baseline Benchmark
            </button>
            <button type="button" className="primary-button secondary" onClick={() => startBenchmark('optimized')}>
              Start Optimized Benchmark
            </button>
          </div>

          <div className="benchmark-meta">
            <label>
              <span>Active mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as 'baseline' | 'optimized')}>
                <option value="baseline">Baseline</option>
                <option value="optimized">Optimized</option>
              </select>
            </label>
            <div className="counter">Current interaction: {Math.min(benchmarkPromptIndex + 1, benchmarkPrompts.length)}/25</div>
            <div className="counter">Valid: {currentModeValidEntries.length}/25</div>
            <div className="counter failed">Failed: {currentModeFailedEntries.length}</div>
          </div>

          <div className="benchmark-prompt">
            <h3>Current prompt</h3>
            <p>{currentBenchmarkPrompt}</p>
          </div>

          <div className="state-grid">
            <div className={`state-card ${state === 'listening' ? 'active' : ''}`}>
              <span>Recording</span>
              <strong>{state === 'listening' ? 'Listening' : 'Idle'}</strong>
            </div>
            <div className={`state-card ${interactionRef.current?.end_of_turn_detected_at ? 'active' : ''}`}>
              <span>EOU</span>
              <strong>{interactionRef.current?.end_of_turn_detected_at ? 'Detected' : 'Waiting'}</strong>
            </div>
            <div className={`state-card ${interactionRef.current?.stt_final_at ? 'active' : ''}`}>
              <span>STT</span>
              <strong>{interactionRef.current?.stt_final_at ? 'Complete' : 'Pending'}</strong>
            </div>
            <div className={`state-card ${interactionRef.current?.llm_started_at ? 'active' : ''}`}>
              <span>LLM</span>
              <strong>{interactionRef.current?.llm_first_token_at ? 'Streaming' : 'Queued'}</strong>
            </div>
            <div className={`state-card ${interactionRef.current?.tts_started_at ? 'active' : ''}`}>
              <span>TTS</span>
              <strong>{interactionRef.current?.tts_first_audio_at ? 'Speaking' : 'Waiting'}</strong>
            </div>
            <div className={`state-card ${interactionRef.current?.first_agent_audio_playback_at ? 'active' : ''}`}>
              <span>Playback</span>
              <strong>{interactionRef.current?.first_agent_audio_playback_at ? 'Playing' : 'Idle'}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="benchmark-summary panel">
        <h2>Benchmark summary</h2>
        <div className="summary-grid">
          <div className="summary-card">
            <span>Median user → first audio</span>
            <strong>{formatMs(medianUserFirstAudio)}</strong>
          </div>
          <div className="summary-card">
            <span>P95 user → first audio</span>
            <strong>{formatMs(p95UserFirstAudio)}</strong>
          </div>
          <div className="summary-card">
            <span>Median EOU</span>
            <strong>{formatMs(benchmarkSummary.metrics.eou_detection_latency_ms?.median)}</strong>
          </div>
          <div className="summary-card">
            <span>Median STT</span>
            <strong>{formatMs(benchmarkSummary.metrics.stt_latency_ms?.median)}</strong>
          </div>
          <div className="summary-card">
            <span>Median LLM TTFT</span>
            <strong>{formatMs(benchmarkSummary.metrics.llm_ttft_ms?.median)}</strong>
          </div>
          <div className="summary-card">
            <span>Median TTS TTFA</span>
            <strong>{formatMs(benchmarkSummary.metrics.tts_ttfa_ms?.median)}</strong>
          </div>
        </div>

        {baselineSummary.total >= 25 && optimizedSummary.total >= 25 && (
          <div className="comparison-box">
            <h3>Optimized improvement</h3>
            <p>
              Absolute improvement: <strong>{formatMs(improvementDelta)}</strong>
            </p>
            <p>
              Percentage improvement: <strong>{improvementPercentage.toFixed(1)}%</strong>
            </p>
            <p>
              Baseline median user → first audio: <strong>{formatMs(baselineMedian)}</strong>
            </p>
            <p>
              Optimized median user → first audio: <strong>{formatMs(optimizedMedian)}</strong>
            </p>
            <p>
              Baseline P95 user → first audio: <strong>{formatMs(baselineP95)}</strong>
            </p>
            <p>
              Optimized P95 user → first audio: <strong>{formatMs(optimizedP95)}</strong>
            </p>
          </div>
        )}
      </section>

      <section className="prompts panel">
        <h2>Demo prompts</h2>
        <div className="prompt-list">
          {samplePrompts.map((prompt) => (
            <button type="button" key={prompt} className="prompt-button" onClick={() => void handleTurnSubmission(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
    </div>
  )
}

export default App