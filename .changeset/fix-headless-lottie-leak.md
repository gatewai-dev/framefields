---
"framefields": patch
---

Fix native C++ memory leaks in headless video and still renders:
- Decouple headless Lottie rendering from `skia-canvas`, reading straight-alpha pixels directly from the underlying ThorVG WASM linear buffer (`_dotLottieCore.get_pixel_buffer()`) into an instance-reused upload buffer before writing to the WebGPU texture, eliminating megabytes of native heap leakage per frame.
- Add frame-based eviction (`mediaDecoderCache.tick()`) for video and audio decoders of clips that ended over 120 frames ago, and pool still render IDs to prevent decoder re-instantiation across consecutive stills.
