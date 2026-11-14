# framefields-envs (Python)

Step framefields training environments from Python: an agent acts, the
scene's physics steps, and the next rendered frame comes back as a NumPy
array in shared memory. Many environments run in one Node process on one
GPU.

```python
from framefields_envs import EnvServer

with EnvServer() as server:          # runs `pnpm serve` in packages/envs
    envs = server.make("push", count=8, truth=True)
    obs, infos = envs.reset(seeds=range(8))
    obs, rewards, terminated, truncated, infos = envs.step(actions)  # one action per env
    obs["top"]        # (8, H, W, 4) uint8
    obs["top.depth"]  # (8, H, W) float32, with truth=True
    obs["top.object"] # (8, H, W) uint32 object ids
```

With Gymnasium (`pip install gymnasium`):

```python
from framefields_envs.gym import FramefieldsEnv, FramefieldsVectorEnv

env = FramefieldsEnv("push")
vec = FramefieldsVectorEnv("push", num_envs=8)   # next-step autoreset
```

`EnvServer(command=[...], cwd=...)` runs any server: a script that calls
`serveEnvs({ name: env })` from `framefields/datasets` with your own
`InteractiveEnv`s.

The protocol is JSON lines over the server's stdin/stdout (`list`, `make`,
`reset`, `step`, `close`); observations are written into a file both sides
map (`/dev/shm` on Linux). A `None` action leaves that env unstepped.

LeRobot datasets: `pnpm --filter @framefields/envs lerobot --out <dir> --seeds 0-9`
writes reacher episodes (two cameras, joint state, actions, velocities,
sensors) as LeRobot v3.0; `tests/test_lerobot.py` reads one back as
LeRobot does.

Tests (need a GPU, Node and pnpm): `python3 -m unittest discover -s tests`.
