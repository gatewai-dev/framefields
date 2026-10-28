# Engine and agent DX review

Reviewed 2026-10-28 at commit `c6692762`. This is a targeted review of sequencing, frame inspection, rendering time selection, and agent-facing workflows; it is not an exhaustive audit of every renderer, shader, node, or platform.

Implementation follow-up: all five findings have fixes and focused regressions on `codex/engine-timing-and-agent-checks`. The agent workflow now includes isolated JSON preflight, optional GPU frame/grid checks, scaffold scripts, JSON component/font discovery and a type-generated API reference. See [the implementation plan](ENGINE_FIX_PLAN.md) for contracts and validation details. The evidence below describes the original review; subsequent GPU and packed-consumer validation is recorded in the plan.

## Findings

### P1 — Frame-grid safety limit is applied after building the entire sample list

`resolveSamplePoints` builds the range in a loop before checking `maxFrames` ([framegrid.ts:183](packages/framefields/src/renderer/framegrid.ts#L183), [framegrid.ts:209](packages/framefields/src/renderer/framegrid.ts#L209), [framegrid.ts:217](packages/framefields/src/renderer/framegrid.ts#L217)). A request such as `endFrame: 1_000_000_000, stepFrames: 1` can exhaust memory before the advertised 120-frame hard limit is reached. `endFrame: Infinity` never terminates, and finite values can also stop advancing due to floating-point precision. This can hang an agent's inspection job instead of giving it the intended actionable error.

Validate finite inputs and positive, advancing steps, calculate or enforce the maximum sample count before appending, and test both excessive and non-finite ranges. Validate `fps` and `maxFrames` as finite positive values too.

### P2 — Frame and timestamp can select different frames and desynchronize hooks

The grid passes both `frame` and `atMs` ([framegrid.ts:353](packages/framefields/src/renderer/framegrid.ts#L353)). `Composition.renderFrame` gives `frame` precedence for hooks ([index.ts:2199](packages/framefields/src/index.ts#L2199)), whereas the headless renderer gives `atMs` precedence ([headless-webgpu-renderer.ts:788](packages/renderer/src/headless-webgpu-renderer.ts#L788)). Timestamp rounding makes disagreement possible: `resolveSamplePoints({ timesMs: [16.6], fps: 30 })` returns `{ frame: 0, timeMs: 17 }`, but 17 ms maps to frame 1. The grid labels and hooks refer to frame 0 while pixels are rendered at frame 1; live signal histories can consequently be inconsistent. Direct `renderFrame` calls supplying both options have the same precedence conflict.

Choose one canonical frame once, pass that to hooks and renderer, and use timestamps only for display or consistently define precedence. Add a regression for fractional timestamps and conflicting simultaneous options, including a frame hook.

### P2 — Default frame grid includes the exclusive end of a composition

For a 1-second composition at 30 fps, `resolveSamplePoints({}, 30, 1000)` returns `0, 5, 10, 15, 20, 25, 30` ([framegrid.ts:190](packages/framefields/src/renderer/framegrid.ts#L190)). Video export uses 30 frames, numbered 0–29 ([headless-webgpu-renderer.ts:1114](packages/renderer/src/headless-webgpu-renderer.ts#L1114)). The last grid cell is therefore outside the exported timeline and can show an empty or misleading frame. The default millisecond-range end also includes `durationMs`.

For automatically derived bounds, use the same rounded frame count as export and clamp to the last valid frame; define whether explicit out-of-range samples are allowed. Cover short and fractional-duration compositions in tests.

### P2 — Sequence reports too short a timeline when the final scene has an outgoing overlap

`calculateSequenceTimeline` subtracts the outgoing overlap for every scene, including the last ([sequence.ts:161](packages/compositions/src/program/sequence.ts#L161)). For one 60-frame scene with `transitionOverlap: 10`, the function returns `totalFrames: 50` even though the scene offset describes frames 0–59. The same applies to a final `transitionOut.durationFrames`. A caller using this public timeline to size an export truncates the last scene. An overlap longer than the following scene can also make an earlier scene end after the reported total.

Calculate total duration as the maximum scene end, and apply outgoing overlap only when determining a following scene's start. Validate overlap against the relevant scenes or explicitly define oversized overlap semantics. Test final-scene and oversized overlaps.

### P2 — Delayed sequence layers extend past their scene by default

`Sequence.toProgram()` adds a layer's local `startFrame` to the scene offset, but assigns the full scene duration when the layer has no explicit duration ([sequence.ts:301](packages/compositions/src/program/sequence.ts#L301)). In a 60-frame scene, a layer starting at local frame 30 gets duration 60 and ends at frame 90, bleeding 30 frames into the next scene. The existing test explicitly expects this behavior for a layer starting at frame 5 ([sequence.test.ts:120](packages/compositions/src/program/sequence.test.ts#L120)).

Define scene window semantics explicitly and constrain default layer duration to the remaining scene window. If scene boundaries are intended as hard bounds, also handle explicitly longer layers and nested contents consistently. Add a two-scene boundary regression rather than asserting only the assigned duration.

## Agent developer experience

1. **Provide a single preflight command with structured output.** The CLI currently exposes `init`, `add`, `list`, and `fonts`, while the render skill requires agents to assemble typechecking, schema parsing, `comp.lint()`, frame inspection, and export checks themselves ([cli.ts](packages/framefields/src/cli.ts), [render skill](plugins/framefields/skills/framefields-render/SKILL.md)). A `framefields check <entry> --json` could report environment/GPU, schema and lint diagnostics, fonts, assets, timeline bounds, and suggested next commands with stable codes and a nonzero exit for errors. Keep this a thin integration over the existing checks, not a second validator.
2. **Make frame selection unambiguous and observable.** Resolve a single frame and expose requested frame, actual frame, fps and source time in diagnostics. This directly addresses the mismatch above and makes agent-generated frame grids trustworthy.
3. **Fail early on invalid authoring inputs.** Enforce finite values, ranges, scene windows and overlap constraints at public boundaries, and include layer IDs, property paths, actual values and corrective actions in errors. The repository's gotchas currently require agents to remember several silent-failure rules; migrate those rules into lint/schema checks where possible.
4. **Offer a machine-readable API and component discovery surface.** Add JSON output for CLI discovery and a versioned API catalog generated from the same source as types and registry metadata. Include parameter units, frame-window conventions, defaults, supported values, and runnable examples. This reduces guesses and documentation drift without forcing agents to read large skills for every lookup.
5. **Add one deterministic, lightweight verification path.** A scaffolded script or CLI mode should run typecheck, schema/lint, one representative frame and a small grid, with clear GPU-unavailable diagnostics and an explicit exit status. Keep full video/audio and pixel assertions available for deeper checks. Test the generated scaffold end to end so documentation, templates and installed package stay aligned.

## Evidence and limits

- Executed direct TypeScript probes for the sequence timeline, delayed layer duration, default grid samples, and fractional timestamp sample using `node --import tsx --conditions=development`.
- Existing `@framefields/compositions` sequence tests passed (4 tests); the selected frame-grid sampling and safety tests passed (4 tests). These tests do not cover the edge cases above.
- No GPU render or video export was performed in this review; rendering consequences follow from the inspected call paths and should be confirmed with focused regression tests. The potentially nonterminating range was identified from the loop and was not executed.
- Runtime used for probes: Node `v26.7.0`. No engine code was modified.
