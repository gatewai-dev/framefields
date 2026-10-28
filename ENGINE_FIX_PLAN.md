# Engine fixes and agent DX implementation plan

Prepared 2026-10-28 from [ENGINE_REVIEW.md](ENGINE_REVIEW.md), against reviewed commit `c6692762`.

## Outcome and delivery order

Fix all five reviewed defects, establish explicit timing contracts, and give agents a reliable path from authoring to validated output. The implementation on `codex/engine-timing-and-agent-checks` follows these stages. The validation record below distinguishes completed checks from remaining platform coverage.

| Stage | Deliverable | Depends on | Completion evidence |
| --- | --- | --- | --- |
| 1 | Bounded, validated grid sampling | None | Invalid and excessive requests fail before allocation |
| 2 | Shared frame selection and valid automatic grid bounds | Stage 1 | Hooks, labels and pixels select the same frame |
| 3 | Correct sequence timeline and scene windows | None; combine with Stage 2 for integration validation | Scene boundaries and reported duration agree |
| 4 | Structured preflight and deterministic smoke verification | Stages 1–3 | Fresh scaffold produces machine-readable checks and inspection artifacts |
| 5 | JSON discovery, generated API guidance and maintained skills | Stage 4 contracts | Discovery and examples remain aligned with the shipped package |

Stages 1–3 are the bug-fix scope. Stages 4–5 are the larger agent-DX improvements proposed in the review and should ship incrementally.

## Timing and compatibility decisions

Establish these contracts before implementation:

- A layer window is `[startFrame, startFrame + durationFrames)`. Keyframes stay relative to the layer's own start.
- Export frame count retains its current rule: `max(1, round(durationMs * fps / 1000))` for a valid positive duration. Automatically generated inspection samples use that same count.
- Frame indices are nonnegative safe integers. Millisecond timestamps may be fractional, but must be finite and nonnegative. FPS must be finite and positive; fractional frame rates remain supported.
- Resolve a request to a frame once. Preserve the headless renderer's existing `atMs` precedence when callers supply both `frame` and `atMs`, and apply the result to composition hooks as well. Document this choice. A future mutually exclusive TypeScript union can be considered separately rather than forcing a source-breaking change into this fix.
- Grid render calls pass the resolved frame only. Display timestamps are derived from that frame, retaining sufficient precision internally. Do not round to whole milliseconds and use that rounded label to select pixels again.
- Explicit frame-grid samples outside the composition duration remain permitted for diagnostics. Automatically derived samples stay inside the export window. A direct `renderFrame` call is not implicitly clamped.
- A `Sequence` scene owns a temporal window. A delayed root layer with no duration defaults to the remaining scene duration. Explicit root durations must fit that scene. Reject invalid windows with scene and layer IDs rather than silently shortening explicit animation or media durations.

Document observable changes: delayed scene layers end earlier; final overlap no longer shortens reported duration; invalid numeric grid inputs fail early; automatic grids no longer include the exclusive end; conflicting dual time requests run hooks at the renderer-selected frame.

## Stage 1 — Bound and validate sample generation

Primary files: `packages/framefields/src/renderer/framegrid.ts`, `packages/framefields/src/framegrid.test.ts`.

Implementation:

1. Normalize and validate `maxFrames` before resolving samples. Require a positive safe integer; preserve the documented hard cap of 120 and default of 64.
2. Validate FPS and all selected sampling inputs before looping. Require frame-range bounds and `stepFrames` to be safe integers, with `stepFrames >= 1`; require finite millisecond bounds and `stepMs > 0`.
3. Preserve the current selection order: nonempty `frames`, nonempty `timesMs`, millisecond range, frame range. Validate the chosen mode and report contradictory modes clearly in documentation; avoid silently changing precedence in this patch.
4. Reject oversized explicit arrays using their length before creating a second array. Do not deduplicate samples in this fix: requested order and repeated inspection points are useful existing behavior.
5. Generate ranges with a bounded counter, calculating each value from `start + index * step`. Before adding the next sample, reject if the cap would be exceeded. Also reject non-finite or non-advancing arithmetic. This bounds work even when count arithmetic overflows or floating-point precision prevents progress.
6. Keep helpers small and named so numeric validation, range generation and sample conversion pass the complexity lint.

Regression cases:

- A billion-frame range fails with the threshold diagnostic without materializing the range.
- `Infinity`, `NaN`, zero/negative steps, unsafe frame indices and fractional frame steps fail predictably.
- Fractional millisecond steps remain valid; arithmetic that cannot advance fails.
- Exactly the requested cap succeeds; cap + 1 fails; a requested cap above 120 still cannot exceed 120.
- Explicit sample order and duplicates are preserved.

Run historically nonterminating cases in a child process with a strict external timeout, so a regression cannot hang the test runner. Keep the ordinary finite cases as pure unit tests.

Acceptance: every request either returns at most the effective cap or fails after bounded work, independent of range magnitude.

## Stage 2 — Canonical frame selection and grid boundaries

Primary files: `packages/core/src/` and its export surface, `packages/renderer/src/headless-webgpu-renderer.ts`, `packages/framefields/src/index.ts`, `packages/framefields/src/renderer/framegrid.ts`; existing frame-grid and media-time tests plus focused new request-resolution tests.

Implementation:

1. Add a small pure frame-request resolver to `@framefields/core`, shared by the public composition and headless paths. Return the resolved frame and exact frame timestamp. Validate inputs consistently and preserve `atMs` precedence.
2. Have `Composition.renderFrame` resolve before hooks, call hooks with that frame, and forward only the canonical frame to the renderer. The direct headless API uses the same resolver for requests that enter there.
3. Apply the composition's FPS consistently. An inspection grid FPS override must not cause hooks to use one clock and pixels another: for composition targets, reject a mismatching override with a clear message; retain explicit FPS selection for media pipelines that do not have an authoritative composition clock. Add an internal capability or adapter rather than guessing target identity from incidental fields.
4. Update grid sample conversion to round to a frame once, derive `timeMs` from the selected frame, and pass only `frame` plus the effective FPS. Whole-millisecond formatting belongs in the label renderer.
5. Reuse a narrow frame-count helper where export and automatic grid bounds need identical duration rounding. Do not broadly refactor all duration calculations in unrelated systems.
6. For default frame ranges, use `lastFrame = frameCount - 1`, then `min(startFrame + 30, lastFrame)`. If an implicit range begins beyond the last frame, return a targeted range error. Preserve explicitly provided endpoints.
7. For default millisecond ends, stop at the last valid frame timestamp. Do not force an extra endpoint sample when the step does not land on it.

Regression cases:

- `timesMs: [16.6]` at 30 fps selects frame 0 throughout; no round-trip through 17 ms changes it to frame 1.
- `{ frame: 0, atMs: 1000 }` at 30 fps runs hooks and pixels at frame 30, matching the retained timestamp precedence.
- Frame-only and timestamp-only requests agree when they identify the same frame.
- Fractional FPS and a composition with live signal remapping use the same frame clock in hooks and pixels.
- A 30-frame composition's automatic grid never requests frame 30; a one-frame composition requests only frame 0.
- Fractional durations use the same frame count as export. Explicit out-of-window samples keep their documented behavior.
- A mismatching grid FPS override fails before hooks or rendering start.

GPU acceptance test: use a tiny font-free composition whose hook changes a visible color or signal on a known frame. Verify both the hook frame and rendered pixel values. Add a short export and compare the relevant decoded frame to the single-frame path, allowing codec tolerance.

## Stage 3 — Sequence duration and scene ownership

Primary files: `packages/compositions/src/program/sequence.ts`, `sequence.test.ts`, and relevant compositor/render tests. The public SDK re-exports these helpers, so update public guidance as well.

### 3A. Timeline calculation

1. Normalize each scene duration to a positive safe integer frame count. Preserve the current 60-frame default. Reject millisecond durations that round to zero instead of emitting zero-length scenes.
2. Validate FPS, outgoing overlap and accumulated offsets. Use the scene schema and shared refinement helpers consistently from constructors and the standalone timeline function; the schema currently exists without constructor enforcement.
3. Track the next scene start separately from `maxSceneEnd`. Subtract overlap only to place an actual next scene. Report total frames as the maximum exclusive end across all scenes.
4. For overlaps between scenes, require a nonnegative integer no longer than either adjacent scene duration. Allow a full-scene overlap if it intentionally aligns starts. Reject larger overlaps instead of hiding them behind `Math.max(1, ...)`.
5. Ignore a final outgoing transition for scheduling because it has no destination; retain it as metadata if callers need it. Empty sequences return zero frames and zero milliseconds.

Tests: empty and single scene; final outgoing overlap; ordinary two- and three-scene overlaps; full overlap; excessive overlap; explicit zero override; fractional FPS; invalid numbers; and the invariant `totalFrames === max(start + duration)` for every nonempty result.

### 3B. Compile layers inside scene windows

1. Resolve each root layer's local start before applying the global scene offset.
2. When duration is omitted, assign `sceneDuration - localStart`. Reject starts at or beyond the scene end with a diagnostic naming the scene and layer.
3. Validate explicit root windows against scene bounds. Explain migration for deliberately spilling content: place it in the owning scene with an appropriate duration or in a separate composition-level layer.
4. Audit existing parent-window behavior before altering nested nodes. Parent clipping should constrain descendants while keeping their starts and animation frames local. If existing temporal containment is insufficient, fix that behavior at its owning evaluator/layout boundary and add its regression there. Avoid adding a visual wrapper that changes layout, lighting or transform semantics merely to enforce time.
5. Preserve source objects: compiling twice must not mutate input layers, descendants, animation tracks or signals.
6. Update the existing test that expects a delayed layer to receive a full scene duration. Verify its end frame, not just the new numeric duration.

Tests: a layer starting at 30 in a 60-frame scene lasts 30 frames; at scene boundary it disappears; explicit fitting duration stays intact; overflow fails clearly; nested local animation remains aligned; overlapping scenes retain their intended concurrent windows; repeated compilation is stable.

GPU acceptance: render before and at a two-scene boundary, using distinct colors and a delayed layer. Include a nested animated child and an overlapping-scene case. Export duration should match the timeline's frame count when that count is supplied by the caller.

## Stage 4 — One structured preflight and smoke workflow

Proposed command: `framefields check <entry> --export <name> --json`, with optional `--render` for a small frame/grid smoke check. Integrate existing schema, lint and rendering APIs instead of maintaining parallel validators.

Primary files: `packages/framefields/src/cli.ts`, new focused modules under `src/cli/`, `src/cli/templates.ts`, CLI tests, and existing diagnostic types where reuse is appropriate.

Implement in two increments:

1. **Document preflight:** load the requested builder, build once, validate the spec, collect lint findings and report known font/asset/timeline issues. Use the project's installed TypeScript tooling for source loading; reuse the preview's entry-loading machinery where it is suitable. Check the dependency path before choosing a loader. Importing a builder executes project code, so document the same side-effect-free builder contract already required by the skill.
2. **Render smoke:** probe the backend and render a representative frame and bounded grid to an explicit output directory. Report success, failure or unavailable for each check; never imply that skipped GPU checks passed. Native renderer scripts and worker processes must terminate explicitly and clean up on failure.

JSON contract:

- A versioned envelope with SDK version, entry/export, overall status, check results and artifact paths.
- Diagnostics with stable code, severity, stage, message and optional layer/property path and suggested action.
- `stdout` contains exactly one JSON result in JSON mode; progress and project logging must be routed away from that stream. Prefer an isolated worker with a structured result channel so user `console.log` cannot corrupt output.
- Exit 0 for completed requested checks with no errors; 1 for validation or execution failure; 2 for invalid CLI usage. Warnings remain visible without failing unless `--warnings-as-errors` is selected. A requested unavailable render check is not success.
- Builder/worker exceptions preserve their original causes. Use a configurable timeout and terminate the worker with an actionable diagnostic if a builder or native task hangs.

Scaffold integration: add a documented `check` script combining `tsc --noEmit` with CLI document preflight. Add an explicit `check:render` script for GPU inspection. Derive smoke sample positions from the actual duration rather than hardcoding frames from the original three-second template. Keep generated scripts deterministic and free of asset-generation calls.

Acceptance: a fresh generated project can run unattended; JSON parses despite a noisy builder; missing fonts and invalid specs identify the source layer/property; failed typecheck stops the scripted pipeline; unavailable GPU checks are explicit; successful render checks return usable local artifacts.

## Stage 5 — Discovery and agent guidance

1. Add `--json` to component and font listing commands, reusing registry and font metadata. Include component names, descriptions, props, dependencies, font requirements and SDK/catalog version. Preserve current human output by default.
2. Start API discovery with the affected surfaces: frame/grid options, scene timing, diagnostics and check command. Generate the catalog from TypeScript declarations, schemas and documented metadata. Fail a drift check when committed output disagrees with source; do not create a manually maintained duplicate catalog.
3. Include explicit units, defaults, valid ranges, exclusive end semantics, examples and diagnostic codes. Compile runnable examples against the built package so development-only imports do not hide packaging defects.
4. Update `plugins/framefields/skills/framefields-render/SKILL.md` for canonical time selection, grid boundaries and preflight; update the compose skill for sequence windows and overlap validation; update the base skill for the scaffold workflow. Edit the owning sources and preserve their symlink arrangement.
5. If compositor-node behavior changes, update `nodes/node-compositor/SKILL.md` and its guarded tests. Keep the effects catalog generated; these fixes do not require manually editing it.
6. Add public release notes with concise before/after examples and migration advice. Add changesets for the affected published packages; treat newly rejected scene overflows and fractional frame indices as compatibility-sensitive behavior and apply the repository's release policy.

Acceptance: agents can discover the new contracts and follow one checked example without inferring units or assembling undocumented validation steps.

## Validation and release gates

For each correctness change: reproduce the original failure with a focused regression, implement the owning fix, then run its package tests and lint. Use package scripts and pnpm throughout.

Suggested targeted commands, adjusted for the final test filenames:

```sh
pnpm --filter @framefields/core test
pnpm --filter @framefields/compositions exec vitest run src/program/sequence.test.ts
pnpm --filter framefields exec vitest run src/framegrid.test.ts
pnpm --filter framefields exec vitest run src/cli/init.test.ts src/cli/add.test.ts src/cli/fonts.test.ts
pnpm exec biome check --write <changed-source-files>
pnpm build
pnpm run check:plugins
```

Run the new hook/pixel and sequence-boundary tests on a real supported GPU backend, then render one short MP4 and inspect frame count/duration with `ffprobe`. Inspect a grid from the same composition and compare boundary pixels. Use a signal-remapped media case to check for missing recorded history. Run a Node 22 compatibility check as well as the current development runtime; the review probes used Node 26.

Build affected dependencies before consumer checks when tests resolve `dist` rather than the `development` condition. Use `tsc --noEmit -p .` only where no suitable package script exists; never run an emitting bare `tsc`. Keep temporary media and probes in ignored scratch/output locations.

The final integration gate is a clean temporary consumer using the packed SDK: initialize, typecheck, run preflight, render frame/grid/video, inspect output, and verify process exit. This catches bundle, declaration, template and lifecycle failures that source-level tests miss.

## Suggested reviewable changes

1. Grid numeric validation and bounded sampling, with pure regressions.
2. Canonical frame resolution, hook alignment and automatic sample bounds, with GPU regression.
3. Sequence timeline/window contracts and compatibility documentation, with boundary regression.
4. Structured document preflight and JSON contract.
5. Render smoke mode and scaffold integration.
6. JSON discovery, generated guidance, skills and release notes.

Ship the correctness fixes without waiting for the full discovery catalog. For every change, record what was tested, actual GPU/backend coverage, and any remaining platform gap. Do not replace unavailable verification with mocked success or silent fallback.

## Implementation validation record

- The full monorepo build passed, including bundled declaration checks, component tree-shaking budgets and installed-component typechecks. All 19 plugin validation checks passed.
- Core suite: 66 tests passed. Sequence suite: 10 tests passed. CLI init/add/fonts/check suites: 33 tests passed. Registry/metadata suites: 6 tests passed.
- GPU grid/timing/signal-track suites passed on an Apple M1 Pro Metal adapter. The media-time rendering suite passed all 18 tests, including live histories and audio/video export. The formerly unbounded sampling regression now runs in a child process with an external timeout.
- Packed the built SDK and installed it in a fresh scaffold with its own dependency install and lockfile. Consumer typechecking, JSON document preflight, GPU smoke rendering, and generated video export scripts passed. The consumer used a font-free 64×64 composition to isolate engine and packaging behavior.
- `ffprobe` confirmed 12 frames at 30 fps over 0.4 seconds. Decoding the export confirmed red pixels on frames 0 and 5 and green pixels on frames 6 and 11, within codec tolerance. Inspected the generated frame grid visually.
- Packed preflight also passed under Node v22.23.4, the minimum supported major; native GPU validation used Node v26.7.0 on macOS arm64. Linux, Windows and Node 22 GPU rendering remain unverified here.
- Standalone repository typechecking still reports errors in unchanged files: core media type resolution/virtual-media typing, framefields font-source test `BodyInit` typing, and preview tests importing component sources outside the SDK's `rootDir`. No changed implementation file retains a reported type error after dependency builds. Packed-consumer and build-time declaration checks pass.
- The API catalog is generated directly into `dist/api.json` on every SDK build rather than maintaining a committed duplicate. It currently covers 11 timing, grid, sequence and preflight declarations; expanding it to the entire SDK is future work. Local asset checks run in document preflight; remote availability and decoding are exercised by the optional render step for sampled content.

### Launch example integration follow-up

Rendered `examples/22_framefields_launch` with cached assets on the Apple M1 Pro. Initial strict preflight exposed two additional authoring issues: camera animation-builder instances carried enumerable builder defaults into the program spec, and the example's ambient-light options objects were interpreted as positional colors. Layer builders now normalize animation instances with `toSpec()`, and ambient-light helpers accept options objects while preserving positional calls. Builder conformance tests cover both forms; all 33 conformance tests and 10 camera/light rendering tests passed.

The example's typecheck, four timing/alignment tests, strict preflight, single frame, and 14-shot grid passed. Its full H.264 export completed in 139.13 seconds at 1920×1080, 60 fps. QA reported all 3,600 frames encoded, no black or frozen segments, no clipped audio samples or silent segments, and stereo 48 kHz audio with -14.1 dBFS RMS and -2.8 dBFS peak. `ffprobe` independently confirmed 3,600 video frames over 60 seconds; AAC padding extends container duration to 60.032 seconds. Remaining lint findings are five informational static-track notices. Rendered artifacts and JSON verification are local ignored files under `examples/22_framefields_launch/output/engine-review-40b7d883/`.
