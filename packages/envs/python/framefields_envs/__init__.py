"""Python client for framefields training environments.

``EnvServer`` runs a framefields env server (Node) and ``EnvServer.make``
gives a batch of envs stepped together on its GPU; observations arrive in
shared memory as NumPy arrays. ``framefields_envs.gym`` wraps them for
Gymnasium (``FramefieldsEnv``, ``FramefieldsVectorEnv``) when it is
installed.
"""

from .client import EnvBatch, EnvError, EnvServer, EnvSpec, ViewLayout

__all__ = ["EnvBatch", "EnvError", "EnvServer", "EnvSpec", "ViewLayout"]
