"""Benchmark items: from a built folder (``pnpm bench build``) or the Hugging Face Hub."""

from __future__ import annotations

import io
import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TASKS = ("violation", "predict", "recreate", "spatial")


@dataclass(frozen=True)
class BenchItem:
    """One question: its images in order, its prompt, its inputs as data, its truth."""

    id: str
    task: str
    seed: int
    prompt: str
    #: Image files (paths) from a local folder; PNG bytes from the Hub.
    images: tuple[str | bytes, ...]
    inputs: dict[str, Any]
    truth: Any

    def image_bytes(self) -> list[bytes]:
        """Each image as PNG bytes."""
        return [image if isinstance(image, bytes) else Path(image).read_bytes() for image in self.images]

    def pil_images(self) -> list[Any]:
        """Each image as a PIL image (needs Pillow)."""
        from PIL import Image

        return [Image.open(io.BytesIO(png)) for png in self.image_bytes()]


def load_local(folder: str | Path, tasks: Sequence[str] = TASKS) -> list[BenchItem]:
    """The items of ``tasks`` in a folder ``pnpm bench build`` wrote."""
    root = Path(folder)
    items = []
    for task in tasks:
        path = root / task / "items.jsonl"
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            if not line:
                continue
            raw = json.loads(line)
            items.append(
                BenchItem(
                    id=raw["id"],
                    task=raw["task"],
                    seed=raw["seed"],
                    prompt=raw["prompt"],
                    images=tuple(str(root / task / f) for f in raw["images"]),
                    inputs=raw.get("inputs", {}),
                    truth=raw["truth"],
                )
            )
    return items


def load_hub(repo_id: str, tasks: Sequence[str] = TASKS, split: str = "test") -> Iterator[BenchItem]:
    """The items of ``tasks`` from a Hub dataset, or a folder ``export_hub`` wrote (needs the ``bench`` extra)."""
    from datasets import Image, Sequence, load_dataset

    local = Path(repo_id)
    for task in tasks:
        if local.is_dir():
            # A folder `export_hub` wrote: read its files, since `datasets` caches a
            # folder's configs by its name, not its contents.
            files = sorted(str(f) for f in (local / "data" / task).glob(f"{split}-*.parquet"))
            dataset = load_dataset("parquet", data_files=files, split="train")
        else:
            dataset = load_dataset(repo_id, task, split=split)
        rows = dataset.cast_column("images", Sequence(Image(decode=False)))
        for row in rows:
            yield BenchItem(
                id=row["id"],
                task=task,
                seed=row["seed"],
                prompt=row["prompt"],
                images=tuple(image["bytes"] for image in row["images"]),
                inputs=json.loads(row["inputs"]),
                truth=json.loads(row["truth"]),
            )


def read_replies(path: str | Path) -> dict[str, dict[str, Any]]:
    """A run's replies (``replies.jsonl``) by item id; a good reply wins over a failed request."""
    replies: dict[str, dict[str, Any]] = {}
    for line in Path(path).read_text().splitlines():
        if not line:
            continue
        r = json.loads(line)
        if not r.get("error") or r["id"] not in replies:
            replies[r["id"]] = r
    return replies
