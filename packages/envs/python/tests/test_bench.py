"""The world bench in Python: scorers, agreement with the reference scorer, Hub export.

The scorer tests need nothing. The others build a small benchmark with the
engine (a GPU, Node, pnpm), and the export test needs the ``bench`` extra:

    cd packages/envs/python && pip install -e ".[bench]" && pytest tests/test_bench.py
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, ClassVar

from framefields_envs.bench import BenchItem, load_local, score_item, summarize
from framefields_envs.bench.scoring import score_predict, score_spatial, score_violation

ENVS = Path(__file__).resolve().parents[2]

try:
    import datasets  # noqa: F401

    HAS_DATASETS = True
except ImportError:
    HAS_DATASETS = False


class ScorerTest(unittest.TestCase):
    def test_violation(self) -> None:
        truth = {"violation": True, "frame": 20, "object": "obj2", "kind": "vanish"}
        self.assertEqual(score_violation(truth, {"violation": True, "frame": 21, "object": "obj2"})[0], 1.0)
        self.assertEqual(score_violation(truth, {"violation": True, "frame": 30, "object": "obj2"})[0], 0.75)
        self.assertEqual(score_violation(truth, {"violation": True})[0], 0.5)
        self.assertEqual(score_violation(truth, {"violation": False})[0], 0.0)
        self.assertEqual(score_violation({"violation": False}, {"violation": False})[0], 1.0)
        # Antigravity has no object: right when none is named.
        up = {"violation": True, "frame": 20, "kind": "antigravity"}
        self.assertEqual(score_violation(up, {"violation": True, "frame": 20})[0], 1.0)
        self.assertEqual(score_violation(up, {"violation": True, "frame": 20, "object": "obj0"})[0], 0.75)

    def test_predict(self) -> None:
        truth = {
            "tolerance": 25,
            "poses": {"29": {"obj0": {"position": [0, 0, 0]}, "obj1": {"position": [100, 0, 0]}}},
        }
        answer = {"frames": {"29": {"obj0": {"position": [10, 0, 0]}, "obj1": {"position": [100, 60, 0]}}}}
        score, details = score_predict(truth, answer)
        self.assertEqual(score, 0.5)
        self.assertEqual(details["positionError"], 35)
        # A missing object counts as four tolerances off.
        self.assertEqual(score_predict(truth, {"frames": {}})[1]["positionError"], 100)

    def test_spatial(self) -> None:
        self.assertEqual(score_spatial({"question": "closest", "answer": "B"}, {"answer": " b."})[0], 1.0)
        self.assertEqual(score_spatial({"question": "count", "answer": 4}, {"answer": "4"})[0], 1.0)
        self.assertEqual(score_spatial({"question": "count", "answer": 4}, {"answer": "four"})[0], 0.0)

    def test_malformed_answers_score_zero_and_say_why(self) -> None:
        item = BenchItem("p", "predict", 0, "", (), {}, {"tolerance": 25, "poses": {}})
        self.assertEqual(score_item(item, None).error, "no JSON answer in the reply")
        bad = score_item(item, {"frames": {"29": {"obj0": {"position": [1, 2]}}}})
        self.assertEqual((bad.score, bad.error), (0.0, "frames.29.obj0.position: three numbers"))
        with self.assertRaises(NotImplementedError):
            score_item(BenchItem("r", "recreate", 0, "", (), {}, {}), {"layout": []})


def _answers(item: BenchItem) -> list[Any]:
    """Answers of every kind for an item: right, partly right, wrong, malformed, none."""
    t = item.truth
    if item.task == "violation":
        if not t["violation"]:
            return [{"violation": False}, {"violation": True, "frame": 3}, {"violation": "no"}, None]
        near = {"violation": True, "frame": t["frame"] + 1, **({"object": t["object"]} if "object" in t else {})}
        return [near, {"violation": True, "frame": t["frame"] + 9, "object": "obj9"}, {"violation": False}, None]
    if item.task == "predict":
        right = {"frames": {f: {n: {"position": p["position"]} for n, p in o.items()} for f, o in t["poses"].items()}}
        off = copy.deepcopy(right)
        for objects in off["frames"].values():
            for k, pose in enumerate(objects.values()):
                pose["position"][0] += 15 * k
        missing = copy.deepcopy(right)
        for objects in missing["frames"].values():
            objects.pop(next(iter(objects)))
        return [right, off, missing, {"frames": []}, None]
    return [{"answer": t["answer"]}, {"answer": "Z" if isinstance(t["answer"], str) else 99}, {}, None]


@unittest.skipUnless(shutil.which("pnpm"), "needs pnpm, Node and a GPU")
class AgreementTest(unittest.TestCase):
    """The Python scorers give the reference scorer's scores, item by item."""

    dir: ClassVar[Path]

    @classmethod
    def setUpClass(cls) -> None:
        cls.dir = Path(tempfile.mkdtemp(prefix="ff-bench-"))
        cls._pnpm("build", "--out", str(cls.dir / "data"), "--limit", "3", "--tasks", "violation,predict,spatial")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    @staticmethod
    def _pnpm(*args: str) -> None:
        subprocess.run(
            ["pnpm", "--silent", "bench", *args],
            cwd=ENVS,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def test_scores_agree(self) -> None:
        items = load_local(self.dir / "data", ["violation", "predict", "spatial"])
        self.assertEqual(len(items) > 10, True)
        rows: list[tuple[BenchItem, Any]] = [(item, a) for item in items for a in _answers(item)]
        # One run per answer variant, so each item has one reply per run.
        variants = max(len(_answers(i)) for i in items)
        for v in range(variants):
            run = self.dir / f"run{v}"
            run.mkdir()
            lines = [
                json.dumps({"id": item.id, "answer": answers[v]})
                for item in items
                if v < len(answers := _answers(item))
            ]
            (run / "replies.jsonl").write_text("\n".join(lines) + "\n")
            self._pnpm(
                "score", "--data", str(self.dir / "data"), "--run", str(run), "--tasks", "violation,predict,spatial"
            )
            reference = {s["id"]: s for s in map(json.loads, (run / "scores.jsonl").read_text().splitlines()) if s}
            for item in items:
                answers = _answers(item)
                if v >= len(answers):
                    continue
                mine = score_item(item, answers[v])
                theirs = reference[item.id]
                self.assertAlmostEqual(mine.score, theirs["score"], places=9, msg=f"{item.id} answer {v}")
                self.assertEqual(mine.error is None, "error" not in theirs, msg=f"{item.id} answer {v}")
        self.assertGreater(len(rows), 40)


@unittest.skipUnless(shutil.which("pnpm") and HAS_DATASETS, "needs pnpm, Node, a GPU and the bench extra")
class ExportTest(unittest.TestCase):
    def test_export_loads_back(self) -> None:
        from framefields_envs.bench import load_hub
        from framefields_envs.bench.export import export_hub

        with tempfile.TemporaryDirectory(prefix="ff-bench-") as tmp:
            data = Path(tmp) / "data"
            AgreementTest._pnpm("build", "--out", str(data), "--limit", "2", "--tasks", "violation,spatial")
            run = Path(tmp) / "baseline-static"
            AgreementTest._pnpm("baseline", "--data", str(data), "--out", str(run), "--tasks", "violation,spatial")
            AgreementTest._pnpm("score", "--data", str(data), "--run", str(run), "--tasks", "violation,spatial")
            hub = export_hub(data, Path(tmp) / "hub", [run], ["violation", "spatial"])
            card = (hub / "README.md").read_text()
            self.assertIn("config_name: violation", card)
            self.assertIn("| `baseline:static` |", card)
            local = {i.id: i for i in load_local(data, ["violation", "spatial"])}
            loaded = list(load_hub(str(hub), tasks=["violation", "spatial"]))
            self.assertEqual(sorted(i.id for i in loaded), sorted(local))
            for item in loaded:
                self.assertEqual(item.truth, local[item.id].truth)
                self.assertEqual(item.inputs, local[item.id].inputs)
                self.assertEqual(item.image_bytes(), local[item.id].image_bytes())
            self.assertEqual(
                summarize([score_item(i, {"violation": False}) for i in loaded if i.task == "violation"])["violation"][
                    "score"
                ],
                0.5,
            )


if __name__ == "__main__":
    unittest.main()
