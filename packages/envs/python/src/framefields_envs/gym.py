"""Gymnasium wrappers (``pip install gymnasium``): one env, or a vector of them.

    env = FramefieldsEnv("push")              # starts its own server
    obs, info = env.reset(seed=0)
    obs, reward, terminated, truncated, info = env.step(env.action_space.sample())

Observations are the first view's RGB frame (H, W, 3) uint8, or with
``truth=True`` a dict of ``rgb``, ``depth`` and ``object``. A scene seed
is drawn from the env's random generator unless ``options={"scene": n}``
names one.
"""

from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .client import EnvBatch, EnvServer


def _action_space(spec: dict[str, Any]) -> spaces.Space:
    if spec["type"] == "discrete":
        return spaces.Discrete(spec["n"])
    return spaces.Box(low=spec["low"], high=spec["high"], shape=tuple(spec["shape"]), dtype=np.float32)


def _observation_space(width: int, height: int, truth: bool) -> spaces.Space:
    rgb = spaces.Box(0, 255, (height, width, 3), np.uint8)
    if not truth:
        return rgb
    return spaces.Dict(
        {
            "rgb": rgb,
            "depth": spaces.Box(0, np.inf, (height, width), np.float32),
            "object": spaces.Box(0, np.iinfo(np.uint32).max, (height, width), np.uint32),
        }
    )


Observation = np.ndarray | dict[str, np.ndarray]


def _pick(obs: dict[str, np.ndarray], view: str, truth: bool, index: slice | int) -> Observation:
    rgb = obs[view][index, ..., :3]
    if not truth:
        return rgb
    return {"rgb": rgb, "depth": obs[f"{view}.depth"][index], "object": obs[f"{view}.object"][index]}


class FramefieldsEnv(gym.Env):
    """One framefields env as a Gymnasium env."""

    metadata = {"render_modes": ["rgb_array"]}  # noqa: RUF012 (Gymnasium's own convention)

    def __init__(
        self,
        env: str = "push",
        server: EnvServer | None = None,
        view: str | None = None,
        truth: bool = False,
        render_mode: str | None = "rgb_array",
    ) -> None:
        self._own = server is None
        self.server = server or EnvServer()
        self.batch: EnvBatch = self.server.make(env, count=1, truth=truth)
        layout = self.batch.layout[0] if view is None else next(v for v in self.batch.layout if v.name == view)
        self.view = layout.name
        self.truth = truth
        self.render_mode = render_mode
        self.spec_info = self.batch.spec
        self.action_space = _action_space(self.batch.spec.action_space)
        self.observation_space = _observation_space(layout.width, layout.height, truth)
        self._last: np.ndarray | None = None

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[Observation, dict[str, Any]]:
        super().reset(seed=seed)
        scene = (options or {}).get("scene")
        if scene is None:
            scene = int(self.np_random.integers(0, 2**31 - 1))
        obs, infos = self.batch.reset([scene])
        self._last = obs[self.view][0, ..., :3]
        return _pick(obs, self.view, self.truth, 0), infos[0]

    def step(self, action: Any) -> tuple[Observation, float, bool, bool, dict[str, Any]]:
        obs, rewards, terminated, truncated, infos = self.batch.step([action])
        self._last = obs[self.view][0, ..., :3]
        return (
            _pick(obs, self.view, self.truth, 0),
            float(rewards[0]),
            bool(terminated[0]),
            bool(truncated[0]),
            infos[0],
        )

    def render(self) -> np.ndarray | None:
        return self._last

    def close(self) -> None:
        self.batch.close()
        if self._own:
            self.server.close()


class FramefieldsVectorEnv(gym.vector.VectorEnv):
    """``num_envs`` framefields envs stepped together on one server (one GPU),
    resetting each when its episode ends (next-step autoreset)."""

    def __init__(
        self,
        env: str = "push",
        num_envs: int = 8,
        server: EnvServer | None = None,
        view: str | None = None,
        truth: bool = False,
    ) -> None:
        self._own = server is None
        self.server = server or EnvServer()
        self.batch = self.server.make(env, count=num_envs, truth=truth)
        layout = self.batch.layout[0] if view is None else next(v for v in self.batch.layout if v.name == view)
        self.view = layout.name
        self.truth = truth
        self.num_envs = num_envs
        self.single_action_space = _action_space(self.batch.spec.action_space)
        self.single_observation_space = _observation_space(layout.width, layout.height, truth)
        self.action_space = gym.vector.utils.batch_space(self.single_action_space, num_envs)
        self.observation_space = gym.vector.utils.batch_space(self.single_observation_space, num_envs)
        self.metadata = {"autoreset_mode": gym.vector.AutoresetMode.NEXT_STEP}
        self._done = np.zeros(num_envs, dtype=bool)
        self._rng = np.random.default_rng()

    def _seeds(self, n: int) -> list[int]:
        return [int(s) for s in self._rng.integers(0, 2**31 - 1, size=n)]

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[Observation, dict[str, Any]]:
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        scenes = (options or {}).get("scenes") or self._seeds(self.num_envs)
        obs, infos = self.batch.reset(scenes)
        self._done[:] = False
        return _pick(obs, self.view, self.truth, slice(None)), {"infos": infos}

    def step(self, actions: Any) -> tuple[Observation, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        actions = list(actions)
        done = np.flatnonzero(self._done)
        if len(done):
            # Next-step autoreset: envs that ended last step start over and
            # return their first frame; their action is ignored (not stepped).
            self.batch.reset(self._seeds(len(done)), indices=done.tolist())
            for i in done:
                actions[i] = None
        obs, rewards, terminated, truncated, infos = self.batch.step(actions)
        self._done = terminated | truncated
        return _pick(obs, self.view, self.truth, slice(None)), rewards, terminated, truncated, {"infos": infos}

    def close(self, **kwargs: Any) -> None:
        self.batch.close()
        if self._own:
            self.server.close()
