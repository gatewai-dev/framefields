# Legal Architecture & License Notice: @framefields/vision-sam

This package (`@framefields/vision-sam`) provides Segment Anything Model (SAM 2.1 & SAM 3 / 3.1) video tracking, prompt encoding, and semantic text selection for Framefields.

## License Segregation
1. **Core Decoupling**: The Framefields SDK and core libraries are licensed under the Apache 2.0 license. In accordance with the terms of the Meta SAM License, SAM inference implementations and derivative models are maintained strictly isolated in this standalone package.
2. **Model Weights Decoupling**: No SAM ONNX model binaries or weight derivatives are bundled in the Apache-2.0 core repository or published npm tarball. Model weights are dynamically downloaded on-demand to the user's local cache (`~/.cache/framefields/models`) directly from verified upstream sources upon explicit license acceptance.
3. **Runtime License Acceptance**: Users of this package must accept the Meta SAM License terms directly at runtime, either by passing `acceptLicense: true` in tracking/vision options or by setting the environment variable `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`.

