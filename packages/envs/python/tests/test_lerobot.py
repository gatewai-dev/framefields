"""A reacher dataset exported by `pnpm lerobot`, read back as LeRobot reads
LeRobot v3.0 datasets (needs a GPU, Node, pnpm; pyarrow, pandas and Hugging
Face `datasets`; ffprobe for the videos):

    cd packages/envs/python && python3 -m unittest tests.test_lerobot
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ENVS = Path(__file__).resolve().parents[2]

try:
    import datasets
    import numpy as np
    import pandas as pd

    HAS_STACK = True
except ImportError:
    HAS_STACK = False


@unittest.skipUnless(HAS_STACK, "needs pandas, pyarrow and datasets")
class LeRobotExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = tempfile.mkdtemp(prefix="ff-lerobot-")
        subprocess.run(
            ["pnpm", "--silent", "lerobot", "--out", cls.dir, "--seeds", "0-2"],
            cwd=ENVS,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.info = json.loads(Path(cls.dir, "meta/info.json").read_text())

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_info(self) -> None:
        self.assertEqual(self.info["codebase_version"], "v3.0")
        self.assertEqual(self.info["total_episodes"], 3)
        self.assertEqual(self.info["total_frames"], 216)
        self.assertEqual(self.info["features"]["observation.state"]["names"], ["shoulder", "elbow"])

    def test_frames_load_with_lerobot_features(self) -> None:
        # As LeRobot types its frame table: videos left out, [1] a value, [n] a fixed-length sequence.
        features = {}
        for key, f in self.info["features"].items():
            if f["dtype"] == "video":
                continue
            features[key] = (
                datasets.Value(f["dtype"])
                if f["shape"] == [1]
                else datasets.Sequence(datasets.Value(f["dtype"]), length=f["shape"][0])
            )
        files = sorted(glob.glob(os.path.join(self.dir, "data/*/*.parquet")))
        ds = datasets.load_dataset("parquet", data_files=files, features=datasets.Features(features), split="train")
        self.assertEqual(len(ds), 216)
        row = ds[100]
        self.assertEqual((row["episode_index"], row["frame_index"], row["index"]), (1, 28, 100))
        self.assertAlmostEqual(row["timestamp"], 28 / 24, places=5)
        # The joint-position sensors read the state.
        np.testing.assert_allclose(row["observation.sensors"][:2], row["observation.state"], atol=1e-5)

    def test_episode_and_task_tables(self) -> None:
        eps = pd.read_parquet(os.path.join(self.dir, "meta/episodes/chunk-000/file-000.parquet"))
        self.assertEqual(list(eps["dataset_from_index"]), [0, 72, 144])
        self.assertEqual(list(eps["videos/observation.images.wrist/to_timestamp"]), [3.0, 3.0, 3.0])
        self.assertEqual(list(eps["tasks"][0]), ["Sweep the arm across the table."])
        tasks = pd.read_parquet(os.path.join(self.dir, "meta/tasks.parquet"))
        self.assertEqual(int(tasks.loc["Sweep the arm across the table."].task_index), 0)

    @unittest.skipUnless(shutil.which("ffprobe"), "needs ffprobe")
    def test_videos(self) -> None:
        for cam in ["front", "wrist"]:
            for episode in range(3):
                path = os.path.join(self.dir, f"videos/observation.images.{cam}/chunk-000/file-{episode:03d}.mp4")
                probe = json.loads(
                    subprocess.run(
                        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                         "stream=codec_name,pix_fmt,nb_read_frames,width,height", "-of", "json", path],
                        capture_output=True, text=True, check=True,
                    ).stdout
                )["streams"][0]
                self.assertEqual(
                    (probe["codec_name"], probe["pix_fmt"], int(probe["nb_read_frames"]), probe["width"], probe["height"]),
                    ("h264", "yuv420p", 72, 192, 144),
                )


if __name__ == "__main__":
    unittest.main()
