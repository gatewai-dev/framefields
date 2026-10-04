# Gitframes agent skills

Agent skills for [gitframes](https://github.com/gatewai-dev/gitframes), a code-first video SDK that renders compositions natively on WebGPU in Node.js. The skills teach Claude, Codex, and other coding agents how to write, render, and check gitframes compositions in your own project.

| Skill | Use it for |
| --- | --- |
| `gitframes` | Starting a project: install from npm, scaffold a composition and render script, first verified render |
| `gitframes-compose` | Compositions, layer trees, layout, animation and easing, beat grids, film structure |
| `gitframes-effects` | Post-processing effects, color grading, VFX, and on-device vision (tracking, segmentation, pose) |
| `gitframes-render` | Headless rendering, frame-grid inspection, pixel probes, MP4 delivery checks |

Skills load automatically when a task matches, for example *"add a film-grain pass to this scene"* or *"render a frame grid of intro.ts"*.

## How it works

This plugin contains only skills: Markdown instructions for your agent. It bundles no executables, MCP servers, hooks, or package launchers. The engine itself is the [`gitframes`](https://www.npmjs.com/package/gitframes) npm package, which the skills tell your agent to add to your project (`npm install gitframes`, Node.js 22 or later).

## Data and privacy

The plugin sends no data anywhere. When code that uses gitframes' on-device vision features runs, the SDK downloads pinned, Apache-2.0 model weights from Hugging Face the first time each model is used and verifies them by SHA-256. Nothing else leaves your machine.

## License

Apache-2.0. See [LICENSE](LICENSE).
