# 41 · Hawking radiation

Watch: [Fable 5.2 & Framefields - What is Hawking Radiation ?](https://youtu.be/Mi3Ly2t2rSY)

A two-and-a-half-minute narrated explainer: what a black hole is, why empty
space is not empty, how a pair of particles pulled apart at the horizon makes
a black hole glow, lose mass, heat up and finally vanish.

Every picture is a `Layer.shader` layer (WGSL in `src/shaders/`):

- `blackhole.ts` ray traces a Schwarzschild black hole: each pixel's light ray
  is bent by the metric's photon equation, so the shadow, the photon ring, the
  lensed sky and the far side of the disk folded over the top come from the
  geometry. The disk is Doppler-beamed and redshifted.
- `journey.ts` is one continuous zoom from the stars into an atom's electron
  cloud, to its ray-marched nucleus, and on into the vacuum.
- `quantum.ts` draws the vacuum's particle pairs and the horizon that splits
  them.

Type, leaders and meters are ordinary layers. The timeline (`src/timeline.ts`)
places each narration line on its scene, and scenes cue pictures off the words
heard in it.

```
pnpm assets          # fonts
pnpm audio           # narration (ElevenLabs v3 through fal, FAL_API_KEY) and the synthesized bed
pnpm render          # output/hawking-radiation.mp4
pnpm render grid     # output/grid.png
```

The picture can be cut before the voice exists: lines with no take are timed
by estimate and stay silent.

Not to scale, and said so in the script: the pair picture is Hawking's own
heuristic, the nucleus is drawn far larger against its atom than it is, and
the glow of a real black hole is far too faint to see.
