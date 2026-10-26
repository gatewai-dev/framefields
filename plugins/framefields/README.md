# Framefields agent skills

Agent skills for [framefields](https://github.com/gatewai-dev/framefields), a code-first video SDK that renders compositions natively on WebGPU in Node.js. The skills teach Claude, Codex, and other coding agents how to write, render, and check framefields compositions in your own project.

| Skill | Use it for |
| --- | --- |
| `framefields` | Starting a project: install from npm, scaffold a composition and render script, first verified render; generating images, video and audio with AI models (`ai`) |
| `framefields-compose` | Compositions, layer trees, layout, animation and easing, beat grids, film structure |
| `framefields-effects` | Post-processing effects, color grading, VFX, and on-device vision (tracking, segmentation, pose) |
| `framefields-render` | Headless rendering, frame-grid inspection, pixel probes, MP4 delivery checks |

Skills load automatically when a task matches, for example *"add a film-grain pass to this scene"* or *"render a frame grid of intro.ts"*.

## How it works

This plugin contains skills and a connection to the hosted Framefields MCP server. It bundles no executables, hooks, or package launchers. The engine itself is the [`framefields`](https://www.npmjs.com/package/framefields) npm package, which the skills tell your agent to add to your project (`npm install framefields`, Node.js 22 or later).

## Data and privacy

When you connect the MCP server and request generation, prompts and other inputs are sent to the Framefields gateway and the provider running the selected model. The gateway stores generated outputs and usage records. Standalone code using `ai` sends generation requests and uploaded files through the gateway as well. On-device vision downloads model weights on first use and verifies them by SHA-256. See the [privacy policy](https://framefields.dev/privacy/) for details.

## License

Apache-2.0. See [LICENSE](LICENSE).
