# @framefields/vision

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

### Patch Changes

- 124f92e: Headless (Node) vision now prefers the GPU: when no provider is passed, runners try onnxruntime-web's WebGPU execution provider on the process's WebGPU device (the Dawn device the renderer already creates) and fall back to the CPU `onnxruntime-node` provider when a WebGPU session can't be created. The new `AutoSessionProvider` makes that choice, and `NodeWebGPUProvider` exposes the WebGPU-only path. On example 19's track scene this lifts the render from 2.37 to 3.49 fps with pixel-identical output (PSNR ≈ 103 dB vs CPU).

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
