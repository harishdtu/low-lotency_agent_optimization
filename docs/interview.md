# Interview Notes

## What was your biggest bottleneck?

The biggest bottleneck was the end-to-end blocking between the final transcript and the first audible audio. Waiting for the full model completion and then generating the full TTS payload created the most visible latency.

## Why did you optimize that component?

Because it is on the user-critical path. Users judge latency from the end of their speech to the first sound from the agent.

## Why not optimize STT instead?

STT latency was already relatively fast in the browser and is only one part of the full path. The bigger win was removing the full-response wait before TTS.

## How much latency did you save?

The repository includes the instrumentation and benchmark scripts, but the actual benchmark must be collected by running the app with a real microphone and provider credentials. This environment did not have those inputs available, so no fabricated claims are made.

## Why does streaming help?

Streaming reduces the time a user spends waiting while the system buffers complete results. Tokens and sentence chunks can be used immediately.

## Why use sentence chunking?

Sentence chunking avoids tiny fragments such as single letters or partial words while still allowing the agent to begin speaking early.

## What happens if the network becomes slow?

The end-to-end latency trends upward with network round-trip time and provider throughput. The app records the network-bound and local-bound stages separately in the latency metadata.

## What happens if TTS is slower than LLM generation?

The pipeline will naturally wait on TTS, which is why chunking matters. The effective first-audio latency is gated by the first completed chunk.

## How would you handle barge-in?

The client can cancel `speechSynthesis` and reset the current interaction while reinitializing the microphone and turn state. Real production systems also cancel upstream generation requests.

## How would you reduce latency further?

Use streaming STT, streaming TTS, faster models, and a low-latency VAD tuned for the target use case.

## How would you reduce cost?

Use smaller models with prompt compression, tiered routing, and more aggressive chunking to reduce output tokens.

## How would you scale this?

Use connection pooling, model routing, autoscaling, and session-based concurrency limits. Place the provider clients behind an internal abstraction for easier swaps.

## What would you change for production?

Use a backend voice gateway, WebRTC, a dedicated VAD service, and a distributed tracing pipeline with per-turn observability.
