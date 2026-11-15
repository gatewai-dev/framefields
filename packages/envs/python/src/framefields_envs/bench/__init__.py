"""The framefields world bench: load items, score answers, export to the Hugging Face Hub.

    from framefields_envs.bench import load_hub, score_item, summarize

    scores = [score_item(item, my_model(item)) for item in load_hub(repo, tasks=["violation"])]
    summarize(scores)

The items are built and the ``recreate`` task is scored by the reference
implementation in the framefields repository (``pnpm --filter
@framefields/envs bench``); this module scores the other tasks the same way.
"""

from .data import TASKS, BenchItem, load_hub, load_local, read_replies
from .scoring import PYTHON_TASKS, AnswerError, ItemScore, score_item, summarize

__all__ = [
    "PYTHON_TASKS",
    "TASKS",
    "AnswerError",
    "BenchItem",
    "ItemScore",
    "load_hub",
    "load_local",
    "read_replies",
    "score_item",
    "summarize",
]
