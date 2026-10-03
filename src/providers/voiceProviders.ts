export interface STTProvider {
  start(_input: MediaStream, handlers: {
    onInterim: (text: string) => void
    onFinal: (text: string) => void
    onError: (message: string) => void
  }): { stop: () => void }
}

export interface TTSProvider {
  speak: (text: string, onStart?: () => void, onError?: (error?: unknown) => void, onEnd?: () => void) => void
  cancel: () => void
}

export interface TurnDetectionProvider {
  start: (
    stream: MediaStream,
    onSpeechStart: () => void,
    onSpeechEnd: () => void,
  ) => { stop: () => void }
}

export class BrowserSTTProvider implements STTProvider {
  start(_input: MediaStream, handlers: {
    onInterim: (text: string) => void
    onFinal: (text: string) => void
    onError: (message: string) => void
  }): { stop: () => void } {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      throw new Error('Speech recognition is not supported in this browser.')
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'en-US'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let interimText = ''
      for (let index = 0; index < event.results.length; index += 1) {
        interimText += event.results[index][0].transcript
      }

      if (interimText.trim()) {
        handlers.onInterim(interimText)
      }

      const finalText = Array.from(event.results)
        .filter((entry: any) => entry.isFinal)
        .map((entry: any) => entry[0].transcript)
        .join(' ')

      if (finalText.trim()) {
        handlers.onFinal(finalText)
      }
    }

    recognition.onerror = (event: any) => {
      handlers.onError(event.error ?? 'Speech recognition error.')
    }

    if (typeof performance === 'undefined' || typeof performance.timeOrigin !== 'number') {
      throw new Error('performance.timeOrigin is required for valid browser timestamps.')
    }

    recognition.start()
    return {
      stop: () => recognition.stop(),
    }
  }
}

export class BrowserTTSProvider implements TTSProvider {
  speak(text: string, onStart?: () => void, onError?: (error?: unknown) => void, onEnd?: () => void): void {
    const trimmed = text.trim()
    if (!trimmed) {
      onEnd?.()
      return
    }

    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.rate = 1
    utterance.pitch = 1

    utterance.onstart = () => {
      onStart?.()
    }

    utterance.onerror = (event) => {
      console.error('SpeechSynthesis utterance error', event)
      onError?.(event)
    }

    utterance.onend = () => {
      onEnd?.()
    }

    try {
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      console.error('SpeechSynthesis API unavailable during speak()', error)
      onError?.(error)
    }
  }

  cancel(): void {
    window.speechSynthesis.cancel()
  }
}

export class SilenceTurnDetector implements TurnDetectionProvider {
  private timer: number | undefined

  start(stream: MediaStream, onSpeechStart: () => void, onSpeechEnd: () => void): { stop: () => void } {
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const data = new Uint8Array(analyser.fftSize)
    const silenceThreshold = 0.055
    const silenceMs = 480

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let index = 0; index < data.length; index += 1) {
        const value = (data[index] - 128) / 128
        sum += value * value
      }

      const rms = Math.sqrt(sum / data.length)
      if (rms > silenceThreshold) {
        onSpeechStart()
      } else {
        onSpeechEnd()
      }
    }

    this.timer = window.setInterval(tick, Math.min(120, silenceMs / 4))

    return {
      stop: () => {
        window.clearInterval(this.timer)
        void context.close()
      },
    }
  }
}
