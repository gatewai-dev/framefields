"""Writes a built benchmark as a Hugging Face dataset folder (needs the ``bench`` extra).

    out/
      README.md                                  card: tasks, format, scoring, results
      data/<task>/test-00000-of-00001.parquet    id, seed, prompt, images, inputs, truth
      results/<run>.json                         each scored run's summary

One config per task, so ``load_dataset(repo, "violation", split="test")``
loads one. ``inputs`` and ``truth`` are JSON strings (their shape differs
per task). Upload the folder with ``hf upload <repo> out --repo-type dataset``.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .data import TASKS, load_local

TASK_TEXT = {
    "violation": (
        "Find the violation",
        "16 frames of a 2-second clip of solids falling onto a floor (rigid-body physics). In half the "
        "clips, branched from the real run one frame before, something impossible happens to one object "
        "(it teleports, vanishes, sinks through the floor) or gravity turns upward. Say whether, when "
        "and to which object.",
        '1 for a right "no"; for a right "yes" 0.5, +0.25 within 2 frames, +0.25 for the object.',
    ),
    "predict": (
        "Predict the fall",
        "7 frames of the first second of a fall, with every object's measured center at three of them, "
        "the camera and gravity. Predict every object's center at frames 29, 35, 41 and 47.",
        "Share of (frame, object) predictions within 25 px of the simulation.",
    ),
    "recreate": (
        "Recreate the scene",
        "One frame of a randomized scene (shapes, metal / plastic / glass / matte surfaces, pattern "
        "textures, lighting rigs). Answer the scene as a framefields program (JSON); it is rendered from "
        "the same camera and compared with the frame.",
        "IoU of the objects' masks (floor excluded), from the engine's ground truth.",
    ),
    "spatial": (
        "Spatial questions",
        "One frame of a still scene of 3 to 8 objects of nameable colors: how many objects there are, which "
        "is closest to the camera, which is leftmost, which of two is farther, which is largest in reality "
        "(not as it looks). Questions are asked only where the truth is unambiguous (visible pixels, gaps in "
        "depth, position and volume, every option a distinct name).",
        "Accuracy.",
    ),
}


def _write_task(folder: Path, task: str, out: Path) -> int:
    from datasets import Dataset, Features, Image, Sequence, Value

    items = load_local(folder, [task])
    features = Features(
        {
            "id": Value("string"),
            "seed": Value("int64"),
            "prompt": Value("string"),
            "images": Sequence(Image()),
            "inputs": Value("string"),
            "truth": Value("string"),
        }
    )
    rows: dict[str, list[Any]] = {k: [] for k in features}
    for item in items:
        rows["id"].append(item.id)
        rows["seed"].append(item.seed)
        rows["prompt"].append(item.prompt)
        names = [Path(str(p)).name for p in item.images]
        rows["images"].append([{"bytes": png, "path": n} for n, png in zip(names, item.image_bytes(), strict=True)])
        rows["inputs"].append(json.dumps(item.inputs, separators=(",", ":")))
        rows["truth"].append(json.dumps(item.truth, separators=(",", ":")))
    target = out / "data" / task / "test-00000-of-00001.parquet"
    target.parent.mkdir(parents=True, exist_ok=True)
    Dataset.from_dict(rows, features=features).to_parquet(str(target))
    return len(items)


def _tokens(summary: dict[str, Any]) -> str:
    usage = summary.get("usage") or {}
    if not usage.get("inputTokens"):
        return "-"
    return f"{usage['inputTokens'] / 1e6:.2f}M / {usage['outputTokens'] / 1e6:.2f}M"


def _results_table(runs: Sequence[Path], tasks: Sequence[str]) -> str:
    header = (
        "| Model | Effort | " + " | ".join(tasks) + " | Tokens in / out |\n|---|---|" + "---|" * (len(tasks) + 1) + "\n"
    )
    lines = []
    for run in runs:
        summary = json.loads((run / "summary.json").read_text())
        cells = [f"{summary['tasks'][t]['score']:.3f}" if t in summary.get("tasks", {}) else "-" for t in tasks]
        model = summary.get("model", run.name)
        lines.append(f"| `{model}` | {summary.get('effort', '-')} | " + " | ".join(cells) + f" | {_tokens(summary)} |")
    return header + "\n".join(lines) + "\n"


def _measures_table(runs: Sequence[Path]) -> str:
    lines = ["| Model | Task | Items | Invalid | Measures |", "|---|---|---|---|---|"]
    for run in runs:
        summary = json.loads((run / "summary.json").read_text())
        for task, s in summary.get("tasks", {}).items():
            measures = ", ".join(f"{k} {v:.3f}" for k, v in s.get("measures", {}).items())
            effort = summary.get("effort")
            label = f"`{summary.get('model', run.name)}`" + (f" ({effort})" if effort else "")
            lines.append(f"| {label} | {task} | {s['items']} | {s['invalid']} | {measures} |")
    return "\n".join(lines) + "\n"


def _card(manifest: dict[str, Any], counts: dict[str, int], runs: Sequence[Path]) -> str:
    tasks = list(counts)
    configs = "\n".join(
        f"  - config_name: {t}\n    data_files:\n      - split: test\n        path: data/{t}/test-*.parquet"
        for t in tasks
    )
    task_rows = "\n".join(
        f"| `{t}` | {TASK_TEXT[t][0]} | {counts[t]} | {TASK_TEXT[t][1]} | {TASK_TEXT[t][2]} |" for t in tasks
    )
    results = (
        "Mean item score per task (0-1, higher is better), on the full test split:\n\n"
        + _results_table(runs, tasks)
        + "\n`baseline:static` answers without looking: never a violation, every object stays where "
        "it was last seen, a floor and a light, always 4 objects / option A. Read model scores against it.\n\n"
        "<details><summary>Per-task measures</summary>\n\n" + _measures_table(runs) + "\n</details>\n"
        if runs
        else "No scored runs yet.\n"
    )
    return f"""---
license: apache-2.0
pretty_name: framefields world bench
size_categories:
  - n<1K
task_categories:
  - visual-question-answering
  - image-text-to-text
tags:
  - physics
  - intuitive-physics
  - world-models
  - spatial-reasoning
  - synthetic
  - 3d
configs:
{configs}
---

# framefields world bench

Physical and spatial reasoning over rendered 3D scenes, with exact answers. Every item is drawn
from a seed by the [framefields](https://framefields.dev) engine (WebGPU rendering, Steel rigid-body
physics) and scored against the engine's own state: the simulation's poses, its interventions, its
per-pixel object masks. Nothing is labeled by hand, and the whole set is rebuilt byte for byte from
the code.

Version {manifest["version"]}. Test split only: the generators make unlimited training data from
other seeds (`packages/envs` in the framefields repository).

## Tasks

| Config | Task | Items | What the model sees and answers | Score |
|---|---|---|---|---|
{task_rows}

Answers are JSON objects; the prompt of each item says the format. An answer that cannot be read,
or does not have the asked-for shape, scores 0 and counts as invalid.

## Results

{results}
## Format

Each config has one `test` split with these columns:

- `id`: the item's id (`<task>-<seed>[-<view or question>]`)
- `seed`: the generator seed
- `prompt`: the question, with the answer format
- `images`: the images, in the order the prompt names them
- `inputs`: JSON, what the prompt says as data (frame numbers, objects, camera, options),
  for models that do not read text
- `truth`: JSON, what the answer is scored against

```python
from datasets import load_dataset

items = load_dataset("<repo>", "violation", split="test")
item = items[0]
item["images"][0]          # PIL image
item["prompt"]
```

## Scoring

```bash
pip install "framefields-envs[bench]"
```

```python
import json
from framefields_envs.bench import load_hub, score_item, summarize

scores = []
for item in load_hub("<repo>", tasks=["violation", "predict", "spatial"]):
    answer = my_model(item.prompt, item.pil_images())   # a dict, or None
    scores.append(score_item(item, answer))
print(summarize(scores))
```

`violation`, `predict` and `spatial` are scored in Python. `recreate` answers are rendered by the
engine, so they are scored with the reference scorer in the framefields repository:
`pnpm --filter @framefields/envs bench score --data <folder> --run <run>` (which also runs Claude
models: `bench run`).

## License

Apache-2.0, like the framefields engine that made it.
"""


def export_hub(
    data: str | Path, out: str | Path, runs: Sequence[str | Path] = (), tasks: Sequence[str] = TASKS
) -> Path:
    """Writes the Hub folder for the built benchmark in ``data``; ``runs`` are scored run folders."""
    data, out = Path(data), Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    manifest = json.loads((data / "manifest.json").read_text())
    counts = {t: _write_task(data, t, out) for t in tasks if (data / t / "items.jsonl").is_file()}
    run_dirs = [Path(r) for r in runs]
    if run_dirs:
        (out / "results").mkdir()
        for run in run_dirs:
            shutil.copy(run / "summary.json", out / "results" / f"{run.name}.json")
    (out / "README.md").write_text(_card(manifest, counts, run_dirs))
    return out
