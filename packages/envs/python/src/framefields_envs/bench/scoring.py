"""Scores answers to framefields world-bench items, as the TypeScript scorer does.

``violation``, ``predict`` and ``spatial`` are scored here from the truth each
item carries. ``recreate`` renders the answer, so it needs the engine:
``pnpm --filter @framefields/envs bench score`` (the reference scorer;
``tests/test_bench.py`` checks the two agree on recorded runs).

Every task scores 0..1 per item. A missing or malformed answer scores 0 and
says why in ``error``.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .data import BenchItem

#: Tasks this module scores without the engine.
PYTHON_TASKS = ("violation", "predict", "spatial")


class AnswerError(ValueError):
    """An answer that does not have the asked-for shape."""


@dataclass
class ItemScore:
    id: str
    task: str
    score: float
    details: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "task": self.task, "score": self.score}
        if self.details:
            out["details"] = self.details
        if self.error is not None:
            out["error"] = self.error
        return out


def _is_int(v: Any) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def score_violation(truth: Mapping[str, Any], answer: Any) -> tuple[float, dict[str, Any]]:
    if not isinstance(answer, dict):
        raise AnswerError("answer: an object")
    if not isinstance(answer.get("violation"), bool):
        raise AnswerError("violation: true or false")
    if "frame" in answer and not _is_int(answer["frame"]):
        raise AnswerError("frame: an integer")
    if "object" in answer and not isinstance(answer["object"], str):
        raise AnswerError('object: "obj<index>"')
    if answer["violation"] != truth["violation"]:
        return 0.0, {"detected": False, "score": 0}
    if not truth["violation"]:
        return 1.0, {"detected": True, "score": 1}
    details: dict[str, Any] = {"detected": True}
    frame_error = abs(answer["frame"] - truth["frame"]) if "frame" in answer else None
    if frame_error is not None:
        details["frameError"] = frame_error
    if truth["kind"] == "antigravity":
        object_correct = "object" not in answer
    else:
        object_correct = answer.get("object") == truth["object"]
    details["objectCorrect"] = object_correct
    if "kind" in answer:
        details["kindCorrect"] = answer["kind"] == truth["kind"]
    score = 0.5 + (0.25 if frame_error is not None and frame_error <= 2 else 0) + (0.25 if object_correct else 0)
    details["score"] = score
    return score, details


def _vec3(v: Any) -> bool:
    return (
        isinstance(v, list)
        and len(v) == 3
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in v)
    )


def _parse_poses(answer: Any) -> dict[str, dict[str, list[float]]]:
    frames = answer.get("frames") if isinstance(answer, dict) else None
    if not isinstance(frames, dict):
        raise AnswerError('answer: {"frames": {"<frame>": {...}}}')
    out: dict[str, dict[str, list[float]]] = {}
    for frame, objects in frames.items():
        if not isinstance(objects, dict):
            raise AnswerError(f"frames.{frame}: an object of obj<index> poses")
        out[frame] = {}
        for name, pose in objects.items():
            if not isinstance(pose, dict) or not _vec3(pose.get("position")):
                raise AnswerError(f"frames.{frame}.{name}.position: three numbers")
            if "rotation" in pose and not _vec3(pose["rotation"]):
                raise AnswerError(f"frames.{frame}.{name}.rotation: three numbers")
            out[frame][name] = pose["position"]
    return out


def score_predict(truth: Mapping[str, Any], answer: Any) -> tuple[float, dict[str, Any]]:
    """Share of (frame, object) positions within ``tolerance`` px (a missing one counts as 4 tolerances)."""
    predicted = _parse_poses(answer)
    tolerance = truth["tolerance"]
    within = count = 0
    total = 0.0
    by_frame: dict[str, float] = {}
    for frame, poses in truth["poses"].items():
        frame_sum = 0.0
        for name, pose in poses.items():
            guess = predicted.get(frame, {}).get(name)
            error = math.dist(guess, pose["position"]) if guess is not None else tolerance * 4
            within += error <= tolerance
            total += error
            frame_sum += error
            count += 1
        by_frame[frame] = frame_sum / len(poses) if poses else 0.0
    score = within / count if count else 1.0
    return score, {"score": score, "positionError": total / count if count else 0.0, "byFrame": by_frame}


def score_spatial(truth: Mapping[str, Any], answer: Any) -> tuple[float, dict[str, Any]]:
    if not isinstance(answer, dict) or "answer" not in answer:
        raise AnswerError('answer: {"answer": …}')
    given = answer["answer"]
    expected = truth["answer"]
    if isinstance(expected, str):
        right = str(given).strip().upper().removesuffix(".") == expected
    else:
        try:
            right = float(given) == expected
        except (TypeError, ValueError):
            right = False
    return float(right), {"question": truth["question"], "expected": expected, "given": given}


_SCORERS = {"violation": score_violation, "predict": score_predict, "spatial": score_spatial}


def score_item(item: BenchItem, answer: Any) -> ItemScore:
    """Scores one answer (``None``: no JSON could be read from the reply)."""
    if item.task not in _SCORERS:
        raise NotImplementedError(
            f"{item.task} answers are rendered to be scored: use `pnpm --filter @framefields/envs bench score`."
        )
    if answer is None:
        return ItemScore(item.id, item.task, 0.0, error="no JSON answer in the reply")
    try:
        score, details = _SCORERS[item.task](item.truth, answer)
    except AnswerError as e:
        return ItemScore(item.id, item.task, 0.0, error=str(e))
    return ItemScore(item.id, item.task, score, details)


def _mean(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def summarize(scores: Iterable[ItemScore]) -> dict[str, dict[str, Any]]:
    """Per task: items, mean score (the headline), invalid answers."""
    by_task: dict[str, list[ItemScore]] = {}
    for s in scores:
        by_task.setdefault(s.task, []).append(s)
    return {
        task: {
            "items": len(of),
            "score": _mean(s.score for s in of),
            "invalid": sum(s.error is not None for s in of),
        }
        for task, of in by_task.items()
    }
