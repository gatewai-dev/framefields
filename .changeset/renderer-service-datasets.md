---
"@framefields/renderer-service": minor
---

`render.kind: "dataset"`: renders a `framefields/datasets` env with the project's own framefields. A part job renders its slice of the seeds into WebDataset shards and a manifest (files in a fixed order, so each upload can be presigned); a `finish` job checks the parts' manifests (URLs, keys or inline) and writes the dataset card.
