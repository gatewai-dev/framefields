# framefields-envs

Python for [framefields](https://framefields.dev) training environments and
the framefields world bench.

- **Environments**: step rendered 3D and physics scenes from an agent. The
  scene's physics steps on each action and the next frame comes back as a
  NumPy array in shared memory. Many environments run in one Node process on
  one GPU, with Gymnasium wrappers.
- **World bench**: physical and spatial reasoning questions over rendered
  scenes, with exact answers from the engine's own state. Load the items,
  score your model's answers, export the set to the Hugging Face Hub.

```bash
pip install framefields-envs            # client and bench scoring (NumPy only)
pip install "framefields-envs[gym]"     # + Gymnasium wrappers
pip install "framefields-envs[bench]"   # + Hugging Face datasets, Pillow
```

Python 3.10 or newer.

## Environments

The environments run in the framefields engine (Node, WebGPU), so stepping
them needs a checkout of the framefields repository with `pnpm install` done,
and a GPU. `EnvServer()` runs `pnpm serve` in its `packages/envs` folder: from
a source checkout it finds it, otherwise set `FRAMEFIELDS_ENVS_DIR` to it.

```python
from framefields_envs import EnvServer

with EnvServer() as server:
    envs = server.make("push", count=8, truth=True)
    obs, infos = envs.reset(seeds=range(8))
    obs, rewards, terminated, truncated, infos = envs.step(actions)  # one action per env
    obs["top"]        # (8, H, W, 4) uint8
    obs["top.depth"]  # (8, H, W) float32, with truth=True
    obs["top.object"] # (8, H, W) uint32 object ids
```

With Gymnasium:

```python
from framefields_envs.gym import FramefieldsEnv, FramefieldsVectorEnv

env = FramefieldsEnv("push")
vec = FramefieldsVectorEnv("push", num_envs=8)   # next-step autoreset
```

`EnvServer(command=[...], cwd=...)` runs any server: a script that calls
`serveEnvs({ name: env })` from `framefields/datasets` with your own
`InteractiveEnv`s. The protocol is JSON lines over the server's stdin/stdout
(`list`, `make`, `reset`, `step`, `close`); observations are written into a
file both sides map (`/dev/shm` on Linux). A `None` action leaves that env
unstepped.

## World bench

Four tasks, 714 test items: find the physics violation in a clip, predict
where falling objects will be, recreate a scene as a program, answer spatial
questions. The dataset card says what each one asks and how it scores.

```python
from framefields_envs.bench import load_hub, score_item, summarize

scores = []
for item in load_hub("<repo>", tasks=["violation", "predict", "spatial"]):
    answer = my_model(item.prompt, item.pil_images())   # a dict, or None
    scores.append(score_item(item, answer))
print(summarize(scores))
```

Each item has `prompt` (with the answer format), `images` (PNG bytes, in
prompt order), `inputs` (what the prompt says, as data) and `truth`.
`violation`, `predict` and `spatial` are scored in Python, the same way as
the reference scorer (a test checks they agree item by item); `recreate`
answers are rendered, so they are scored by the reference scorer in the
repository.

From the command line, on a folder `pnpm bench build` wrote and a run's
`replies.jsonl` (one `{"id", "answer"}` per line):

```bash
framefields-bench score --data <folder> --run <run>
framefields-bench export --data <folder> --out <hub folder> --run <scored run>
```

In the repository (`packages/envs`):

```bash
pnpm bench build --out <folder>                 # render the test split
pnpm bench run --data <folder> --out <run>      # ask a Claude model (ANTHROPIC_API_KEY)
pnpm bench baseline --data <folder> --out <run> # answers that look at nothing
pnpm bench score --data <folder> --run <run>    # the reference scorer, all four tasks
```

## LeRobot

`pnpm --filter @framefields/envs lerobot --out <dir> --seeds 0-9` writes
reacher episodes (two cameras, joint state, actions, velocities, sensors) as a
LeRobot v3.0 dataset, episodes packed per data and video file as LeRobot's
recorder does. `tests/test_lerobot.py` reads one back with pyarrow, Hugging
Face `datasets` and ffprobe, and with `LeRobotDataset` itself when
`lerobot[dataset]` is installed.

## Development

```bash
cd packages/envs/python
uv venv && uv pip install -e ".[gym,bench]" --group dev
pytest               # tests that need pnpm and a GPU skip without them
ruff check && ruff format --check && mypy
python -m build      # sdist and wheel into dist/
```

Apache-2.0.
