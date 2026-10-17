---
"@framefields/renderer-service": patch
---

The worker image starts on a pod with a mounted volume. RunPod mounts a pod volume owned by root, and the worker (uid 1001) crash-looped with `EACCES` creating its cache dir, so `pod.template.json` with its volume never booted. The entrypoint now starts as root, creates the cache, work and output dirs and hands them to `framefields`, then drops to that user with `gosu`. A dir that is still not writable stops the worker with a `CONFIG_INVALID` line naming the setting instead of a stack trace. The after-job temp cleanup now keeps tsx's and Node's compile caches, so jobs don't recompile the project.
