# @framefields/renderer-service

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

## 2.2.0

### Patch Changes

- 1e8756d: The worker image starts on a pod with a mounted volume. RunPod mounts a pod volume owned by root, and the worker (uid 1001) crash-looped with `EACCES` creating its cache dir, so `pod.template.json` with its volume never booted. The entrypoint now starts as root, creates the cache, work and output dirs and hands them to `framefields`, then drops to that user with `gosu`. A dir that is still not writable stops the worker with a `CONFIG_INVALID` line naming the setting instead of a stack trace. The after-job temp cleanup now keeps tsx's and Node's compile caches, so jobs don't recompile the project.

## 2.2.0-beta.4

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

## 2.1.3

## 2.1.2

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

## 2.0.11

## 2.0.10

## 2.0.9

## 2.0.8

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
