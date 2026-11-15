"""``framefields-bench``: score a run's replies, or export a built benchmark for the Hub.

framefields-bench score --data <folder> --run <run> [--tasks violation,predict,spatial]
framefields-bench export --data <folder> --out <hub folder> [--run <run> …]
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from .data import TASKS, load_local, read_replies
from .scoring import PYTHON_TASKS, ItemScore, score_item, summarize


def _score(data: Path, run: Path, tasks: Sequence[str]) -> dict[str, dict[str, object]]:
    replies = read_replies(run / "replies.jsonl")
    scores = []
    for item in load_local(data, tasks):
        reply = replies.get(item.id)
        if reply is None or reply.get("error"):
            scores.append(ItemScore(item.id, item.task, 0.0, error=(reply or {}).get("error") or "not answered"))
        else:
            scores.append(score_item(item, reply.get("answer")))
    return summarize(scores)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="framefields-bench",
        description="Score a run's replies, or export a built framefields world bench for the Hugging Face Hub.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    score = commands.add_parser("score", help="score a run's replies (violation, predict, spatial)")
    score.add_argument("--data", type=Path, required=True, help="a folder `pnpm bench build` wrote")
    score.add_argument("--run", type=Path, required=True, help="a folder holding replies.jsonl")
    score.add_argument("--tasks", default=",".join(PYTHON_TASKS))
    export = commands.add_parser("export", help="write a Hugging Face dataset folder")
    export.add_argument("--data", type=Path, required=True)
    export.add_argument("--out", type=Path, required=True)
    export.add_argument("--run", type=Path, action="append", default=[], help="a scored run (repeatable)")
    export.add_argument("--tasks", default=",".join(TASKS))
    args = parser.parse_args(argv)
    tasks = [t for t in args.tasks.split(",") if t]
    if args.command == "score":
        print(json.dumps(_score(args.data, args.run, tasks), indent=2))
    else:
        from .export import export_hub

        print(export_hub(args.data, args.out, args.run, tasks))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
