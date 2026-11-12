# 43 · Path tracer

Three scenes that test `environment.pathTrace` where a path tracer is weakest:

| Scene | What it tests |
| --- | --- |
| `character` | Cesium Man walking (a skinned mesh whose BVH is refitted every frame) beside water bottles with base color, normal, metallic-roughness, occlusion and emissive maps (the trace atlas, normal mapping). Logs each frame's render time: a refit gone bad shows up as slow frames. |
| `sun` | A sun-sky HDRI where the sun carries most of the light. Renders draft, standard and a 1024-sample reference; prints each one's error against the reference and its count of isolated bright pixels (fireflies). |
| `motion` | Two seconds of moving camera, a walking character, a bouncing chrome ball and a spinning neon ring, with camera motion blur and bloom, as a video. Prints the frame-to-frame flicker of a still sunlit picture at draft and standard. |
| `glass` | A glass still life: an iridescent glass lamp, a glass vase of flowers and a mosquito in amber on a quiet table, lit by a studio's big window, as a seamless two-second loop at 1920×1080 (`output/glass.mp4`). Thick glass needs several passes per object, which `transmissionBounces` budgets apart from other bounces. |

```bash
pnpm assets              # downloads the two models (pinned, SHA-256 checked), generates the sun sky
pnpm render character    # or: sun, motion, glass, all (all = the first three)
```

`pnpm render:src` runs against the workspace sources instead of the built packages. Results go to `output/`. The `character` and `motion` scenes trace with the library's default preset (high, 128 samples); `src/motion-high.ts` renders the motion scene at 1920×1080.

## Assets

Downloaded by `pnpm assets` (the models from Khronos glTF-Sample-Assets at commit `8f492390`), not committed:

- Cesium Man © 2017 Cesium, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) (the Cesium logo on it is a trademark of Cesium).
- Water Bottle, [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
- Glass Vase Flowers: vase by Eric Chadwick, flowers by Rico Cilliers, [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
- Iridescence Lamp © 2022 Wayfair, LLC (Eric Chadwick), [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Mosquito in Amber © 2018 Loïc Norgeot, © 2019 Sketchfab, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Brown Photostudio 02 by Sergej Majboroda, [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (Poly Haven), downloaded from Poly Haven and checked by SHA-256 like the models.

The sun sky (`src/sky.ts`) is generated: a gradient, a hazy horizon and a 1.2°-wide sun.

## Results on an Apple M1 Pro, 960×540 (measured before high became the default)

- character (standard): first frame 3.4 s (loads models, builds trees), then 0.6 s per frame; one frame of 30 at 0.9 s, no trend.
- sun: draft 2.2 s, standard 1.1 s, reference 41 s. Error against the reference (0–255): draft 5.8, standard 4.4. Fireflies: draft 8, standard 2, reference 431. The reference's fireflies are caustics (sunlight reflected by the chrome ball or focused by the glass onto the floor), which a camera-side path tracer finds only by chance; draft and standard clamp and denoise them away.
- motion (draft): 60 frames in 11.6 s. Flicker of a still sunlit picture: 0.88 (draft), 0.45 (standard). Two light paths made the character sparkle at first: the sun reflected off the glossy floor onto his shaded side, and the ring's light. Path regularization (`filterGlossy`, 0.7 at draft) turns the first into a soft fill; front-face emission and resampled emitter picking cut the ring-lit draft error against its reference from 7.8 to 1.7 (0-255). At 4096 samples the ring-lit character converges without grain.
