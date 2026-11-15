"""Client for framefields env servers (``serveEnvs`` in ``framefields/datasets``).

The server is a Node process speaking JSON-RPC over stdin/stdout, one JSON
object per line. Observations never travel in the JSON: ``make`` sizes a
file both sides map, and every ``reset``/``step`` writes each env's views
into its slot before answering, so they are read here in place.

    with EnvServer() as server:
        envs = server.make("push", count=8)
        obs, infos = envs.reset(seeds=range(8))
        obs, rewards, terminated, truncated, infos = envs.step(actions)
        obs["top"].shape  # (8, H, W, 4) uint8
"""

from __future__ import annotations

import contextlib
import json
import mmap
import os
import subprocess
import tempfile
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


def envs_package() -> Path:
    """The ``@framefields/envs`` folder whose ``pnpm serve`` runs by default.

    ``FRAMEFIELDS_ENVS_DIR`` names it; otherwise a source checkout finds its
    own (this file is in ``packages/envs/python/src/framefields_envs``).
    """
    named = os.environ.get("FRAMEFIELDS_ENVS_DIR")
    candidates = [Path(named)] if named else [Path(__file__).resolve().parents[3]]
    for folder in candidates:
        manifest = folder / "package.json"
        if manifest.is_file() and json.loads(manifest.read_text()).get("name") == "@framefields/envs":
            return folder
    raise EnvError(
        "No framefields envs package to serve: set FRAMEFIELDS_ENVS_DIR to a checkout's "
        "packages/envs, or pass EnvServer(command=[...]) to run your own server."
    )


class EnvError(RuntimeError):
    """A request the server refused or failed (its message says why)."""


@dataclass
class ViewLayout:
    name: str
    width: int
    height: int
    rgba: int
    depth: int | None = None
    object: int | None = None


@dataclass
class EnvSpec:
    name: str
    description: str
    fps: int
    frames: int
    frame_skip: int
    action_space: dict[str, Any]
    views: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_json(cls, s: dict[str, Any]) -> EnvSpec:
        return cls(
            name=s["name"],
            description=s["description"],
            fps=s["fps"],
            frames=s["frames"],
            frame_skip=s["frameSkip"],
            action_space=s["actionSpace"],
            views=s["views"],
        )

    @property
    def max_steps(self) -> int:
        """Steps an episode lasts at most (frames after the first, per step)."""
        return -(-(self.frames - 1) // self.frame_skip)


def _shm_dir() -> str:
    # RAM-backed on Linux; elsewhere the page cache keeps a small file in memory.
    return "/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir()


class EnvServer:
    """A running env server.

    ``command`` starts it (default: the envs package's ``pnpm serve``) in
    ``cwd``. Use it as a context manager, or call ``close()``.
    """

    def __init__(
        self,
        command: Sequence[str] | None = None,
        cwd: str | os.PathLike[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        if command is None:
            command = ["pnpm", "--silent", "serve"]
            cwd = cwd or envs_package()
        self._proc = subprocess.Popen(
            list(command),
            cwd=cwd,
            env={**os.environ, **(env or {})},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._next_id = 0
        self._batches: list[EnvBatch] = []

    def call(self, method: str, **params: Any) -> dict[str, Any]:
        """Sends one request and returns its result (raises EnvError on an error)."""
        if self._proc.poll() is not None:
            raise EnvError(f"the env server exited with {self._proc.returncode}")
        self._next_id += 1
        request_id = self._next_id
        assert self._proc.stdin and self._proc.stdout
        self._proc.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        self._proc.stdin.flush()
        while True:
            line = self._proc.stdout.readline()
            if not line:
                raise EnvError(f"the env server closed during {method} (exit {self._proc.wait()})")
            if not line.startswith("{"):
                continue
            message = json.loads(line)
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise EnvError(message["error"]["message"])
            return message["result"]

    def list(self) -> list[EnvSpec]:
        """Every env the server offers."""
        return [EnvSpec.from_json(s) for s in self.call("list")["envs"]]

    def make(
        self,
        env: str,
        count: int = 1,
        truth: bool = False,
        views: Sequence[str] | None = None,
    ) -> EnvBatch:
        """``count`` envs of one kind, stepped together on the server's GPU."""
        shm = os.path.join(_shm_dir(), f"framefields-env-{uuid.uuid4().hex}.bin")
        params: dict[str, Any] = {"env": env, "count": count, "shm": shm, "truth": truth}
        if views is not None:
            params["views"] = list(views)
        made = self.call("make", **params)
        batch = EnvBatch(self, made, shm, count)
        self._batches.append(batch)
        return batch

    def close(self) -> None:
        for batch in self._batches:
            batch.close()
        self._batches.clear()
        if self._proc.poll() is None:
            assert self._proc.stdin
            self._proc.stdin.close()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def __enter__(self) -> EnvServer:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class EnvBatch:
    """``count`` envs of one kind on a server. Observations are dicts of
    arrays by view name: ``obs[view]`` is (count, H, W, 4) uint8, and with
    ``truth`` also ``obs[f"{view}.depth"]`` (count, H, W) float32 and
    ``obs[f"{view}.object"]`` (count, H, W) uint32."""

    def __init__(self, server: EnvServer, made: dict[str, Any], shm: str, count: int) -> None:
        self.server = server
        self.handle = made["handle"]
        self.spec = EnvSpec.from_json(made["spec"])
        self.count = count
        self.slot_bytes = made["layout"]["slotBytes"]
        self.layout = [ViewLayout(**v) for v in made["layout"]["views"]]
        self._path = shm
        self._file = open(shm, "r+b")  # noqa: SIM115 (held for the mapping's lifetime; close() closes it)
        self._map = mmap.mmap(self._file.fileno(), made["layout"]["bytes"])
        self._closed = False

    def observations(self, copy: bool = True) -> dict[str, np.ndarray]:
        """The latest observations. ``copy=False`` returns views into the
        shared file, overwritten by the next reset or step."""
        out: dict[str, np.ndarray] = {}
        for v in self.layout:
            px = v.width * v.height
            arrays: list[tuple[str, int, type[np.generic], tuple[int, ...], int]] = [
                ("", v.rgba, np.uint8, (v.height, v.width, 4), px * 4)
            ]
            if v.depth is not None:
                arrays.append((".depth", v.depth, np.float32, (v.height, v.width), px))
            if v.object is not None:
                arrays.append((".object", v.object, np.uint32, (v.height, v.width), px))
            for suffix, offset, dtype, shape, _size in arrays:
                strided: np.ndarray = np.ndarray(
                    shape=(self.count, *shape),
                    dtype=dtype,
                    buffer=self._map,
                    offset=offset,
                    strides=(self.slot_bytes, *np.empty(shape, dtype).strides),
                )
                out[v.name + suffix] = strided.copy() if copy else strided
        return out

    def reset(
        self, seeds: Iterable[int], indices: Sequence[int] | None = None
    ) -> tuple[dict[str, np.ndarray], list[dict[str, Any]]]:
        """Starts new episodes (all envs, or ``indices``) from scene ``seeds``."""
        params: dict[str, Any] = {"handle": self.handle, "seeds": [int(s) for s in seeds]}
        if indices is not None:
            params["indices"] = [int(i) for i in indices]
        result = self.server.call("reset", **params)
        return self.observations(), result["infos"]

    def step(
        self, actions: Sequence[Any]
    ) -> tuple[dict[str, np.ndarray], np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]]]:
        """One action per env. Returns observations, rewards, terminated, truncated, infos."""
        result = self.server.call("step", handle=self.handle, actions=[_jsonable(a) for a in actions])
        return (
            self.observations(),
            np.asarray(result["rewards"], dtype=np.float32),
            np.asarray(result["terminated"], dtype=bool),
            np.asarray(result["truncated"], dtype=bool),
            result["infos"],
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(EnvError):
            self.server.call("close", handle=self.handle)
        self._map.close()
        self._file.close()
        with contextlib.suppress(FileNotFoundError):
            os.unlink(self._path)


def _jsonable(action: Any) -> Any:
    if isinstance(action, np.ndarray):
        return action.tolist()
    if isinstance(action, np.generic):
        return action.item()
    return action
