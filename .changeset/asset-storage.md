---
"framefields": minor
---

Keep media out of git on your own bucket. `framefields assets add|push|pull|status` stores files by sha256 on any S3-compatible bucket (Cloudflare R2, S3, B2, MinIO) and pins them in `framefields.json`; a remote's `publicUrl` (a custom domain or CDN) serves reads without keys, and uploads are marked immutable so CDNs cache them. Cloud renders upload what the bucket lacks, sign reads of private remotes, and workers download and cache them by hash. `framefields/storage` exposes the client.
