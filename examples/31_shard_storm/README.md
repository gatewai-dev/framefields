# Example 31: Shard Storm

Kinetic 3D simulation of a polyhedral shard vortex colliding with a glossy reflective floor plane, exhibiting dynamic Coulomb sliding friction, kinetic heat buildup, secondary spark emission, HDR bloom, and planar reflections.

Demonstrates:
- `Layer3D.shard`: procedural flat-faceted polyhedral rock/crystal geometry generated via Sutherland-Hodgman Fibonacci lattice clipping.
- `Layer3D.swarm`: GPU compute 3D particle simulation with 3D curl noise, 3D vortex fields (`swirl`, `pull`, `axial`), Coulomb ground sliding friction, and kinetic heat accumulation/cooling.
- `Layer.environment(..., { floor })`: planar glossy floor reflection pass with anisotropic roughness blur, Schlick Fresnel grazing angle boost, and distance fade.
- 3D camera trajectory orbiting the vortex and skimming across the reflective floor.

## Run

```bash
# Render video to output/shard-storm.mp4
pnpm render

# Render contact sheet grid
pnpm render grid

# Render specific frames
pnpm render frames 30 90 150
```
