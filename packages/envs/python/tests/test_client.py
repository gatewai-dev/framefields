"""The client against a real env server (needs a GPU, Node and pnpm):

cd packages/envs/python && pip install -e ".[gym]" && pytest tests/test_client.py
"""

from __future__ import annotations

import unittest

import numpy as np

from framefields_envs import EnvError, EnvServer

try:
    import gymnasium  # noqa: F401

    HAS_GYM = True
except ImportError:
    HAS_GYM = False


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = EnvServer()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.close()

    def test_lists_the_envs(self) -> None:
        push = next(s for s in self.server.list() if s.name == "push")
        self.assertEqual(push.action_space, {"type": "box", "shape": [2], "low": -1, "high": 1})
        self.assertEqual(push.views, [{"name": "top", "width": 128, "height": 128}])
        self.assertEqual(push.max_steps, 120)

    def test_steps_a_batch_with_observations_in_shared_memory(self) -> None:
        envs = self.server.make("push", count=3, truth=True)
        try:
            obs, infos = envs.reset(seeds=[4, 4, 9])
            self.assertEqual(obs["top"].shape, (3, 128, 128, 4))
            self.assertEqual(obs["top.depth"].dtype, np.float32)
            self.assertEqual(infos[0]["params"], infos[1]["params"])
            # Same scene, same frame; another scene differs.
            np.testing.assert_array_equal(obs["top"][0], obs["top"][1])
            self.assertFalse(np.array_equal(obs["top"][0], obs["top"][2]))
            self.assertTrue((obs["top.object"][0] > 0).any())

            # The same scene pushed two ways goes two ways.
            for _ in range(8):
                obs, rewards, terminated, truncated, infos = envs.step([[1, 0], [-1, 0], [0, 0]])
            self.assertEqual(rewards.dtype, np.float32)
            self.assertGreater(infos[0]["agent"][0], infos[1]["agent"][0] + 50)
            self.assertFalse(np.array_equal(obs["top"][0], obs["top"][1]))
            self.assertFalse(terminated.any() or truncated.any())

            # A null action leaves an env as it is.
            frames_before = infos[2]
            _, _, _, _, infos = envs.step([[0, 0], [0, 0], None])
            self.assertEqual(infos[2], {})
            self.assertNotEqual(frames_before, {})
        finally:
            envs.close()

    def test_reports_server_errors(self) -> None:
        with self.assertRaisesRegex(EnvError, 'no env "nope"'):
            self.server.make("nope")
        envs = self.server.make("push", count=2)
        try:
            envs.reset(seeds=[0, 1])
            with self.assertRaisesRegex(EnvError, "one per env"):
                envs.step([[0, 0]])
        finally:
            envs.close()


@unittest.skipUnless(HAS_GYM, "gymnasium is not installed")
class GymTest(unittest.TestCase):
    def test_env_and_vector_env(self) -> None:
        from framefields_envs.gym import FramefieldsEnv, FramefieldsVectorEnv

        with EnvServer() as server:
            env = FramefieldsEnv("push", server=server)
            obs, _info = env.reset(seed=0)
            self.assertIn(obs, env.observation_space)
            obs, reward, _terminated, _truncated, _info = env.step(env.action_space.sample())
            self.assertIsInstance(reward, float)
            env.close()

            vec = FramefieldsVectorEnv("push", num_envs=2, server=server)
            obs, _ = vec.reset(seed=1)
            self.assertEqual(obs.shape, (2, 128, 128, 3))
            obs, rewards, _terminated, _truncated, _ = vec.step(vec.action_space.sample())
            self.assertEqual(rewards.shape, (2,))
            vec.close()


if __name__ == "__main__":
    unittest.main()
