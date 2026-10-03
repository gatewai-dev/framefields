#!/bin/bash
set -e

if command -v xvfb-run >/dev/null 2>&1; then
  echo "Starting with xvfb-run..."
  exec xvfb-run -a -e /dev/stderr --server-args="-screen 0 4096x2160x24" python3 apps/gatewai-renderer/runpod_worker.py
else
  echo "xvfb-run not found, starting directly..."
  exec python3 apps/gatewai-renderer/runpod_worker.py
fi
