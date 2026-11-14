/** The dataset card (README.md) Hugging Face shows and loads a dataset with. */
import type { Env } from "./env.js";

/** Facts about an environment the card states. */
export type CardEnv = Pick<
	Env<unknown>,
	"name" | "description" | "width" | "height" | "fps" | "frames"
>;

export function datasetCard(
	env: CardEnv,
	seeds: number[],
	samples: number,
): string {
	return `---
license: apache-2.0
task_categories:
  - image-to-3d
  - depth-estimation
  - object-detection
tags:
  - synthetic
  - physics
  - world-models
  - framefields
---

# ${env.name}

${env.description}

Rendered with [framefields](https://framefields.dev): ${samples} samples,
${seeds.length} seeds, ${env.width}×${env.height}, ${env.fps} fps, ${env.frames}
frames per scene. The same seed renders the same bytes.

## Sample files (WebDataset: \`key.ext\`)

| Member | Contents |
|---|---|
| \`png\` | The rendered frame (RGBA). |
| \`truth.npz\` | The frame's ground truth, H×W arrays: \`depth\` (float32, distance along the camera's forward axis, scene px; \`inf\` where empty), \`normal\` (float16 ×3, unit world normal, y down), \`motion\` (float32 ×2, px moved since the previous frame, x right, y down), \`object\` (object id per pixel, 0 none; see \`objects\` in the json) and \`instance\` (instance of an instanced object), ids in the smallest unsigned type that holds them. |
| \`json\` | \`env\`, \`seed\`, \`view\`, \`frame\`, \`params\` (what builds the scene), \`physics\` (simulation state and contacts at the frame), \`camera\` (intrinsics, view and projection matrices), \`objects\` (per object: layer id, \`label\` (what it is), pixels, visible 2D box, oriented 3D box, projected 2D box, and \`visibleFraction\` / \`amodalPixels\` / \`amodalBox2d\`: how much of it shows and its whole extent). |

Keys: \`<env>_s<seed>_<view>_f<frame>\`. Scene px: 100 px is a meter.

\`\`\`python
from datasets import load_dataset
ds = load_dataset("webdataset", data_files={"train": "shard-*.tar"}, split="train")
\`\`\`
`;
}
