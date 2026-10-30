---
name: framefields-vision
description: On-device computer vision in framefields — object detection and tracking, instance segmentation, pose, person mattes and cutouts (RTMDet-Ins, RTMO, Selfie Segmenter), and prompted video tracking of a specific object or several people with SAM 2.1 Tiny (point/box prompts) and SAM 3 (text prompts such as "man in white shirt", multiple objects at once). Covers which API to use (withVision, comp.vision, analyzeVisionSequence), every pinned ONNX model with sizes and licenses, GPU/CUDA/CPU backends, model downloads and caching, performance, and troubleshooting. Use when a framefields composition needs to know where people or objects are, cut a subject out, follow someone through a clip, or select one person in a crowd.
---

# framefields-vision

## Setup
Import from [`framefields`](https://www.npmjs.com/package/framefields). If the project has no framefields setup yet, follow the `framefields` skill first. Prompted tracking (SAM) also needs `@framefields/vision-sam` (see [SAM](#prompted-tracking-with-sam)). Effects that consume vision (blur, grading, outlines) are in `framefields-effects`; rendering and frame checks in `framefields-render`.

Vision runs ONNX models locally. Nothing is sent anywhere. Models download on first use from pinned Hugging Face revisions, are checked against their exact size and SHA-256, and are cached in `$FRAMEFIELDS_MODELS_DIR` (default `~/.cache/framefields/models`).

## Which API

| Need | API | Timing |
| --- | --- | --- |
| Cut out, box, or draw a skeleton on a layer while rendering | `layer.withVision({ mode })` | Reads the layer's **previous** rendered frame: results trail by one frame and exist only while rendering |
| Signals for the whole composition (boxes, masks, pose) | `comp.withVision({ … })` | Same, on the composited frame |
| Know the motion **at** a frame (physics, layout, keyframes), or reuse results across renders | `comp.vision(clipOrLayer, options)` | Analyses the clip's own frames on demand, before they draw; persisted on disk |
| Follow **one specific** object or person, or select by description | `comp.vision(…, { sam2 })` / `{ sam3 }` | As above, with SAM's temporal memory |
| Find out what is in a clip before authoring | `comp.analyzeVisionSequence(path, …)` | One-shot report |

## Models

### Core models (Apache-2.0, bundled with `framefields`)

| Task | Model | `t` | `s` (default) | `m` | Input |
| --- | --- | --- | --- | --- | --- |
| Detect + segment (one shared pass), COCO-80 | RTMDet-Ins | 24 MB | 43 MB | 116 MB | 640² |
| Pose, 17 COCO keypoints | RTMO | 27 MB (416²) | 40 MB | 89 MB | 640² |
| Person matte | MediaPipe Selfie Segmenter | square 0.5 MB (256²), landscape 0.5 MB (256×144) for wide frames | | | |

About 380 MB for all of them. `variant: "t" | "s" | "m"` picks the size.

### SAM 2.1 Tiny (`sam2`, Apache-2.0)
Meta SAM 2.1 Hiera Tiny, Diffusion Studio's 512 px fp16 video export: vision encoder 58 MB, mask decoder 9 MB, memory attention 13 MB, memory encoder 3 MB, pointer encoding and constants (under 0.1 MB). About 83 MB in total. Point and box prompts only.

### SAM 3 (`sam3`, Meta SAM License)
Video tracking at 1008², plus text ("concept") selection. Only the image encoder the backend runs fastest is downloaded:

| Graph | Size | Source |
| --- | --- | --- |
| Image encoder, **fp16** (WebGPU, CUDA) | 935 MB | `onnx-community/sam3-tracker-ONNX` |
| Image encoder, **q4** (CPU) | 369 MB | same |
| Image encoder, q4f16 (opt-in) | 296 MB | same |
| Mask decoder, memory encoder, memory attention | 18 + 6 + 35 MB | `jax-image-tools/sam3-video-onnx` |
| Dense-prompt and pointer heads | 67 MB | `RamRom/sam3-onnx` |
| Text selection: image encoder (int4, fp16 attention), text encoder (int8), decoder (int8), tokenizer | 293 + 357 + 27 + 4 MB | `danilobukvic/sam3-text-onnx` |

That is about 1.75 GB on a GPU and 1.2 GB on the CPU. The text graphs load only for text prompts.

Why fp16 on the GPU, measured for one 1008² frame on an M1 Pro: WebGPU fp16 took 3.65 s, q4f16 4.43 s, q4 6.63 s, and int8 140 s (its ops fall back to the CPU). fp16 is also the closest to full precision. On WebGPU, 4-bit weights are dequantized before every matmul, so they save disk and memory, not time. The backend-to-precision table is `SAM3_ENCODER` in `@framefields/vision-sam`; `sam3.precision: "fp16" | "q4f16" | "q4"` overrides it.

## Backends

Inference picks its backend once per process, before any model downloads:

| Machine | Backend |
| --- | --- |
| Mac (Apple Silicon) | WebGPU through `onnxruntime-web` on the Metal device |
| Linux with an NVIDIA GPU | CUDA through `onnxruntime-node` when the NVIDIA driver is loaded and the CUDA 12 / cuDNN 9 libraries are present, else WebGPU (Vulkan), else CPU |
| No usable GPU (CI, lavapipe, SwiftShader) | CPU through `onnxruntime-node` |
| The preview (`startPreview`) | WebGPU in the browser; models are served from the local cache by the preview server |

| Variable | Effect |
| --- | --- |
| `FRAMEFIELDS_VISION_PROVIDER` | `auto` (default; the order above), `webgpu`, `cuda` or `cpu`. A forced backend that fails throws instead of falling back. |
| `FRAMEFIELDS_VISION_THREADS` | CPU threads per model. Default on Linux: the CPUs the process may use, cgroup quota included; elsewhere ONNX Runtime's default. |
| `FRAMEFIELDS_MODELS_DIR` / `FRAMEFIELDS_MODELS_BASE_URL` | Model cache directory, or a mirror to download from (offline and CI renders) |
| `FRAMEFIELDS_VISION_CACHE_DIR` | Where `comp.vision` persists results (default `~/.cache/framefields/vision`) |

The renderer logs `[vision] Inference on the GPU (WebGPU)`, or the backend it fell back to.

## Detection, segmentation, pose, mattes

| Option | Model | Gives you |
| --- | --- | --- |
| `enableDetection` (default) | RTMDet-Ins | COCO-80 boxes, tracked over time → `vision.objects` |
| `enableSegmentation` | RTMDet-Ins (same pass) | Soft per-instance masks → `vision.masks`, `vision.segmentation` |
| `enablePose` | RTMO | 17 COCO keypoints per person → `vision.poseLandmarks`, `track.pose` |
| `enableMatte` | Selfie Segmenter | Fast person alpha → `vision.segmentation.matte` |

```typescript
// Whole composition: returns the reactive bundle
const vision = comp.withVision({ enableSegmentation: true, enablePose: true });

// One layer: renders through a node mode
Layer.video("assets/dancer.mp4").withVision({ mode: "matte", enableSegmentation: true });
```

Node modes: `passthrough`, `mask`, `matte`, `crop`, `skeleton`, `boxes`, `tracking`. For `mask` / `matte` / `crop`, `matteSource: "instance"` (default; any COCO class, overlapping parts such as a dress merged into the subject) or `"selfie"` (people only, fastest). `confidence` (default 0.3) and `classes: ["person", …]` filter detections.

Measured per 1280–2048 px frame on CPU (`onnxruntime-node`); the GPU is faster:

| Task | `t` | `s` | `m` |
| --- | --- | --- | --- |
| detect / segment (one shared pass) | 150–300 ms | 200–340 ms | 420–700 ms |
| pose | ~50 ms | ~120 ms | ~280 ms |
| matte (Selfie Segmenter) | ~20 ms | ~20 ms | ~20 ms |

- Start with `"s"`. Use `"m"` for hero shots with fast motion blur or busy backgrounds; `"t"` mainly saves time on pose.
- **Use the selfie matte only for close framing.** It misses distant figures and can report a "person" in close-ups with nobody in them.
- Raise `confidence` (e.g. `0.5`) on abstract or stylized footage. At 0.3 the model puts loose labels ("teddy bear", "donut") on smoke, eyes and planets.
- Restrict `classes` when you only care about one thing. It also stops the subject switching to another object when the person leaves frame.

At render time:
- **One-frame delay.** `withVision` reads the previous rendered frame, so the first frame has no results (a cutout renders transparent) and masks trail the plate by a frame. A matte of a clip the composition also reads with `comp.vision` has neither problem.
- **Render vision frames in order.** `renderVideo` does. For stills, render at least two consecutive frames with the same renderer and keep the last; jumping to a later frame shows a ghosted double of the subject.
- **Subject choice** for `mask` / `matte` / `crop`: the largest person, else the most confident instance. Instances overlapping it and no more than twice its size are merged in (a dress, a held instrument); large containers (a tunnel, a window frame) are not. `classes` limits what the subject can be, not what merges into it.
- Each vision layer tracks independently; track IDs from two layers are unrelated. Layers with the same `variant` share models, and layers showing the same pixels share one detect/segment pass.

## Clip vision (`comp.vision`)

Use `comp.vision` when something must know the motion **at** a frame:

```typescript
const dancer = comp.vision("assets/dancer.mp4", { startFrame: 0 });   // pose + silhouette (person)
const person = dancer.person.place({ width: W, height: H, fit: "cover" });
person.point("rightWrist", 48);   // { x, y, visibility } in composition px, smoothed over ±2 frames
person.signals("nose").x;          // a signal for .signal("x", …)
person.sample(48, x, y);           // silhouette alpha + inward gradient
await dancer.ready(0);             // analyse a frame (or ready(0, 120)) to read it at build time
```

- The composition analyses each frame's clips just before drawing it, in every render path and the preview. Nothing runs up front.
- Results persist in Node, keyed by the file and settings (`cacheDir: false` opts out). Later renders and renders after a preview are instant.
- Options: `startFrame` / `trimStartSec` (where the clip plays; pass `trimStartSec` yourself when you give a path instead of the layer), `fps` (analysis rate), `pose`, `mask`, `maskCell` (silhouette grid, default 8 px), `smoothing` (frames, default 2), `variant`. A lost person's last pose is held for up to a second.
- A `withVision({ mode: "matte" })` cutout (or `mask` / `crop`) of the same clip reuses the clip's subject for the frame being drawn: segmented once, aligned with the plate. Layers with `classes`, `keyBackground`, `matteSource: "selfie"` or different model settings keep their own pass. With several `comp.vision` clips of one source, the matte links to the **first one created**.

## Prompted tracking with SAM

Detection picks "the largest person". Use SAM when the subject is **a specific** person or object, especially in a crowd, or when you can only describe it.

| | SAM 2.1 Tiny (`sam2`) | SAM 3 (`sam3`) |
| --- | --- | --- |
| Select by | points and boxes | points, boxes, or **text** |
| Objects per clip | 1 | 1 to `maxObjects` |
| Resolution | 512² | 1008² |
| Cost per frame, M1 Pro | ~0.3 s | ~3.6 s image encoder (shared by every SAM 3 clip of the source) + ~0.7 s per tracked object |
| Download | ~83 MB | ~1.75 GB (GPU) / ~1.2 GB (CPU) |
| License | Apache-2.0 | Meta SAM License |

### Install and license

```bash
pnpm add @framefields/vision-sam
```

`@framefields/vision-sam` is an optional peer of `framefields`. It is loaded only when a clip uses `sam2` or `sam3`; without it, those clips fail with an install message. The package's code is under Meta's SAM License (the SAM 2.1 weights themselves are Apache-2.0), so both `sam2` and `sam3` need explicit acceptance: `acceptSamLicense: true` on the clip (or `acceptLicense: true` inside `sam2` / `sam3`), or `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`. Import `Sam2Tracker` / `Sam3Tracker` from `@framefields/vision-sam` when you drive SAM directly.

### Prompts

```typescript
const plate = Layer.video("assets/source.mp4", { width: 1920, height: 1080, fit: "contain" })
	.withVision({ mode: "matte" });
comp.add(plate);

// SAM 3: one person by description
const hero = comp.vision(plate, {
	acceptSamLicense: true,
	sam3: { category: "person", text: "man in white shirt" },
	pose: true, // optional RTMO pass matched to the selection
});

// SAM 3: everyone else at once, tracks 1…N by score
const crowd = comp.vision("assets/source.mp4", {
	acceptSamLicense: true,
	sam3: { category: "person", text: "student in blazer", maxObjects: 5 },
});

// SAM 2.1: a box plus a point, and a correction later
const ball = comp.vision(plate, {
	acceptSamLicense: true,
	sam2: {
		category: "ball",
		prompts: [
			{ frame: 0, points: [
				{ x: 0.40, y: 0.55, label: 2 }, // box top-left
				{ x: 0.48, y: 0.66, label: 3 }, // box bottom-right
				{ x: 0.44, y: 0.60, label: 1 }, // foreground point
			] },
			{ frame: 120, points: [{ x: 0.61, y: 0.52, label: 1 }] },
		],
	},
});

const target = hero.signals.objects.get(1); // request signals before rendering
Layer.box({
	position: "absolute", x: 0, y: 0, width: 1, height: 1,
	background: "transparent", borderWidth: 6, borderColor: "#00ffc3",
}).animate(
	LayerAnimation.create()
		.signal("x", target.bounds.screenX)
		.signal("y", target.bounds.screenY)
		.signal("width", target.bounds.screenWidth)
		.signal("height", target.bounds.screenHeight)
		.signal("opacity", target.active),
);
```

- **Coordinates** are normalized to the source image, before layout. Labels: `1` foreground, `0` background, `2` / `3` box corners.
- **Prompt frames** are increasing integers on the source analysis clock, before trimming. SAM propagates forward from the first prompt; earlier frames are empty and are not analysed. To track only a stretch of a long clip, trim the layer and prompt on the stretch's first source frame.
- **Text prompts are concepts.** Name what sets the target apart in that shot. In a crowd where everyone shows a white collar, "man in white shirt" picks a student. In the same film's wide shot, where only he has no blazer, it picks him. Check the first frame of every prompt.
- **Several objects** (`maxObjects`): one encoder pass per frame serves every track, and each track keeps its own memory. Where tracks overlap, the more confident one keeps the pixel. `signals.objects.get(k)` and `signals.masks` carry tracks `1…N`; the clip's matte and subject are all tracks merged. A later text prompt re-selects every track (IDs renumber); a points prompt with `object: k` seeds or corrects track `k` only (the next unused ID adds one).
- Two text-prompted clips of one shot can claim the same person (a "student" track on the hero). Prefer prompts that exclude each other.
- **Corrections and cuts.** A prompt on a later frame resets that object's memory. Re-prompt after hard cuts or long occlusions; appearance tracking cannot guarantee re-identification.
- An explicit selection never falls back to another detected person. If its mask cannot align with a matte layer (a different aspect ratio), the render fails. Matte at the source aspect ratio and crop afterwards.
- SAM gives masks, not skeletons: `pose: true` matches an RTMO pose to the selection. Default smoothing is 0, and an absent object stays empty.
- `clip.release()` frees the SAM sessions. Analysed frames stay readable.

### Cost and caching

- Every SAM 3 clip in a process shares one image encoder and reuses its result per frame. Tracking the hero and the crowd of one source costs one encoder pass, not two.
- Setup (loading the models, then text selection on the prompt frame) takes about 2 minutes on an M1 Pro. Measured there: a 20-frame stretch with 6 tracks (hero + 5 others) renders in about 5 minutes; a 15 s clip at 25 fps is estimated at about 55 minutes. A CUDA GPU should be much faster; the CPU image encoder is about 9× slower than WebGPU.
- Results persist like other clip vision, and the cache key includes every prompt, the model revisions and the encoder precision. Re-rendering after changing layout, colours or effects skips SAM entirely, so prototype prompts on a short trimmed stretch first.
- Offline or CI: download the weights on a connected machine once, then copy `~/.cache/framefields/models`, or point `FRAMEFIELDS_MODELS_BASE_URL` at a mirror. `SAM_MODELS` (`@framefields/vision-sam`) lists every file with its URL, size and SHA-256.

## Recipes

### Subject sandwich (text behind the subject)
```typescript
comp.addSubjectSandwich({
	source: "assets/dancer.mp4",
	behind: [Layer.text("HEADLINE BEHIND", { fontSize: 120, fill: "#FF5A1F", fontWeight: 900 })],
	feather: 4,
	fit: "cover",
});
```

### Smart re-framing (16:9 to 9:16)
```typescript
const vision = comp.withVision({ enableDetection: true });
comp.addSmartFraming({
	source: "assets/action.mp4",
	target: vision.objects.primary,
	targetAspect: 9 / 16,
	damping: 0.15,
	leadHeadroom: 0.1,
});
```

### Subject outline glow
```typescript
const vision = comp.withVision({ enableSegmentation: true });
comp.addSubjectOutline(vision.segmentation.subject, {
	source: "assets/character.mp4",
	color: "#FF5A1F",
	width: 6,
	blur: 12,
});
```

### Tracked region blur (faces, plates)
```typescript
const vision = comp.withVision({ classes: ["person"] });
layer.blurRegion(vision.objects.byCategory("person"), { strength: 30 });
```

### Analyse before authoring
```typescript
const report = await comp.analyzeVisionSequence("assets/street.mp4", {
	tasks: ["detect", "pose"],
	categories: ["person"],
});
report.tracks; // [{ trackId, category, frames: [start, end], centerPath, … }]
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Cutout or box is on the wrong person | `classes: ["person"]`; for a specific person use SAM |
| SAM 3 text picks the wrong one | Name what is unique in **that** shot; or use a box prompt (`points` with labels 2/3) |
| Part of a fast-moving garment drops out | `variant: "m"`, or `keyBackground: true` |
| Faint halo on dark backgrounds | Lower `featherRadius`, or raise `maskThreshold` (e.g. `0.6`) |
| "Prompted sam2/sam3 tracking needs the optional @framefields/vision-sam package" | `pnpm add @framefields/vision-sam` |
| "Meta SAM License agreement required" | `acceptSamLicense: true` or `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1` |
| "A prompted clip matte requires the source aspect ratio" | Matte at the source aspect, crop afterwards |
| Log says `Inference on the CPU` on a GPU machine | The log's `reason` says why; on Linux NVIDIA check the CUDA 12 / cuDNN 9 libraries, or force `FRAMEFIELDS_VISION_PROVIDER` to see the error |
| A preview of a clip outside the project shows nothing | Add its folder to `startPreview(…, { root: [process.cwd(), dir] })` |
| Renders offline or in CI | Copy the model cache, or set `FRAMEFIELDS_MODELS_BASE_URL` |
| Check the models themselves | `await runner.preload([...])` on a fresh `FRAMEFIELDS_MODELS_DIR`; SAM: `pnpm --filter @framefields/vision-sam test:sam2` / `test:sam3` on a GPU machine |
