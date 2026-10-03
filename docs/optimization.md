# Optimization Notes

## Largest bottleneck

The largest practical bottleneck in a browser-driven voice stack is usually the pipeline stage after end-of-speech detection, especially when a system waits for the full LLM response before beginning TTS. In a voice product, that creates a visible pause that the user interprets as a dead system.

## What changed

The optimized path uses:

- silence-aware end-of-turn detection
- partial LLM token streaming
- sentence chunking before TTS
- speech synthesis on each chunk rather than waiting for the entire transcript

## Why it helps

The user perceives the latency as the time between the end of speech and the first audible response. Streaming the model and chunking the output directly reduces the unproductive waiting time by starting TTS as soon as the chunk is semantically complete.

## Measurement methodology

The app records timestamps for speech end, first partial transcript, LLM first token, TTS start, and first audio. The actual metric is computed as `tts_first_audio_at - user_speech_end_timestamp`.

## Trade-offs

- more complex state handling and cancellation
- TTS on chunk boundaries can sound slightly less fluent than waiting for a complete sentence
- streaming providers introduce more network events and error branches
- partial generation requires careful interruption behavior
