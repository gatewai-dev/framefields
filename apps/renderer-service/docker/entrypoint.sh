#!/bin/bash
# Starts the renderer per FF_MODE (PLAN.md §5):
#   runpod-serverless (default when RUNPOD_POD_ID is set): the Node server on
#     localhost plus the Python shim in front of it.
#   http: the Node server alone.
#   cli: one job; pass the CLI's arguments, e.g. --job-file /jobs/job.json
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# As root: give framefields its cache, work and output dirs (volumes such as a
# RunPod pod volume are mounted root-owned), then rerun this script as
# framefields. The cache default matches the worker's (config/schema.ts).
if [ "$(id -u)" = 0 ]; then
  cache="${FF_CACHE_DIR:-}"
  if [ -z "$cache" ]; then
    if [ -e /runpod-volume ]; then cache=/runpod-volume/framefields; else cache=/var/cache/framefields; fi
  fi
  for dir in "$cache" "${FF_WORK_DIR:-/tmp/framefields}" ${FF_OUTPUT_DIR:+"$FF_OUTPUT_DIR"}; do
    mkdir -p "$dir" && chown framefields:framefields "$dir" \
      || echo "cannot hand $dir to the framefields user; the worker may not be able to write there" >&2
  done
  exec gosu framefields "$0" "$@"
fi

MODE="${FF_MODE:-}"
if [ -z "$MODE" ]; then
  if [ -n "${RUNPOD_POD_ID:-}" ]; then MODE=runpod-serverless; else MODE=http; fi
fi
export FF_MODE="$MODE"

# Headless Vulkan/EGL needs no X server; FF_XVFB=1 forces one for GL fallbacks.
wrap=()
if [ "${FF_XVFB:-0}" = "1" ] && command -v xvfb-run >/dev/null 2>&1; then
  wrap=(xvfb-run -a -e /dev/stderr --server-args="-screen 0 4096x2160x24")
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || true
else
  echo "no NVIDIA GPU visible (nvidia-smi not found); FF_GPU=${FF_GPU:-auto} decides whether to render on the CPU" >&2
fi

case "$MODE" in
  runpod-serverless)
    "${wrap[@]}" node "$SERVICE_DIR/dist/src/index.js" &
    NODE_PID=$!
    # If either process exits, stop the other so RunPod replaces the worker.
    trap 'kill -TERM "$NODE_PID" 2>/dev/null || true' EXIT TERM INT
    python3 "$SERVICE_DIR/runpod_worker.py" &
    SHIM_PID=$!
    wait -n "$NODE_PID" "$SHIM_PID"
    ;;
  cli)
    exec "${wrap[@]}" node "$SERVICE_DIR/dist/src/cli.js" "$@"
    ;;
  *)
    exec "${wrap[@]}" node "$SERVICE_DIR/dist/src/index.js"
    ;;
esac
