#!/bin/bash
# Starts the renderer per FF_MODE (PLAN.md §5):
#   runpod-serverless (default when RUNPOD_POD_ID is set): Node server on
#     localhost + the Python shim in front of it.
#   http: the Node server alone.
set -euo pipefail

SERVICE_DIR=apps/renderer-service
MODE="${FF_MODE:-}"
if [ -z "$MODE" ]; then
  if [ -n "${RUNPOD_POD_ID:-}" ]; then MODE=runpod-serverless; else MODE=http; fi
fi
export FF_MODE="$MODE"

# Headless Vulkan/EGL normally needs no X server; FF_XVFB=1 forces one.
NODE_CMD=(node "$SERVICE_DIR/dist/src/index.js")
if [ "${FF_XVFB:-0}" = "1" ] && command -v xvfb-run >/dev/null 2>&1; then
  NODE_CMD=(xvfb-run -a -e /dev/stderr --server-args="-screen 0 4096x2160x24" "${NODE_CMD[@]}")
fi

git lfs install --skip-repo >/dev/null

if [ "$MODE" = "runpod-serverless" ]; then
  "${NODE_CMD[@]}" &
  NODE_PID=$!
  # If either process exits, stop the other so RunPod replaces the worker.
  trap 'kill -TERM "$NODE_PID" 2>/dev/null || true' EXIT TERM INT
  python3 "$SERVICE_DIR/runpod_worker.py"
else
  exec "${NODE_CMD[@]}"
fi
