---
"gitframes": patch
---

Require `sharp` ^0.35.0, so fresh installs no longer pull the libvips/libheif versions flagged by `npm audit`. Fix the README samples that did not compile against the published types (quickstart animation, 3D camera orbit and carousel, `ColorBalance`). The setup skill's `tsconfig.json` now sets `"types": ["node"]` so `typecheck` passes on TypeScript 6+, and its `package.json` also denies the `esbuild` install script that `tsx` brings in, so installs finish without warnings.
