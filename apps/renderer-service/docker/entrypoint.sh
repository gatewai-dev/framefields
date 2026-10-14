#!/bin/bash
# Starts the renderer per FF_MODE (PLAN.md §5):
#   runpod-serverless (default when RUNPOD_POD_ID is set): the Node server on
#     localhost plus the Python shim in front of it.
#   http: the Node server alone.
#   cli: one job; pass the CLI's arguments, e.g. --job-file /jobs/job.json
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
  echo "warning: nvidia-smi not found; rendering needs a Vulkan-capable GPU" >&2
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
