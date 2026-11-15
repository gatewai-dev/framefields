"""Python client for framefields training environments.

``EnvServer`` runs a framefields env server (Node) and ``EnvServer.make``
gives a batch of envs stepped together on its GPU; observations arrive in
shared memory as NumPy arrays. ``framefields_envs.gym`` wraps them for
Gymnasium (``FramefieldsEnv``, ``FramefieldsVectorEnv``) when it is
installed; ``framefields_envs.bench`` loads and scores the framefields world
bench.
"""

from importlib.metadata import PackageNotFoundError, version

from .client import EnvBatch, EnvError, EnvServer, EnvSpec, ViewLayout, envs_package

try:
    __version__ = version("framefields-envs")
except PackageNotFoundError:  # running from a source tree that is not installed
    __version__ = "0.0.0"

__all__ = ["EnvBatch", "EnvError", "EnvServer", "EnvSpec", "ViewLayout", "__version__", "envs_package"]
