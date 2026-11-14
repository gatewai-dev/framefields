---
"framefields": minor
---

`framefields/datasets`: training data from compositions. An `Env` maps a seed to plain-JSON parameters and the parameters to views; `generateDataset(env, { out, seeds })` renders every frame with its ground truth into WebDataset shards (png, truth.npz, json) and a Hugging Face dataset card, the same bytes on every machine. A seed range splits into parts (`part: { index, count }`, one worker each) that `finishDataset` checks and merges; metrics (`psnr`, `ssim`, `maskAndDepth`, `poseError`) and the npy/npz/tar writers are exported too. `renderCloud({ dataset: { seeds, parts } })` renders a dataset on framefields cloud GPUs and downloads its folder.

`comp.toProgram()` saves a scene as a plain-JSON program document (primitives as their recipe) and `Composition.fromProgram(json)` checks and loads one, rendering the same bytes; `toProgram` refuses values only code can rebuild. Program validation now accepts `model3d`, `camera` and `light` nodes.

MuJoCo models show cube textures (by face) and 2D textures on boxes, spheres, capsules, cylinders and ellipsoids.
