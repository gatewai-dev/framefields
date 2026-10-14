"""RunPod serverless shim (PLAN.md §5).

The Node renderer runs as a long-lived server on localhost, so the GPU is
initialised once per worker. This handler only forwards each job to it,
relays progress, and returns the result or a structured error.
"""

import json
import os
import time
import urllib.error
import urllib.request

import runpod

BASE = f"http://127.0.0.1:{os.environ.get('RENDERER_PORT', '8082')}"
API_KEY = os.environ.get("RENDERER_API_KEY", "")
POLL_SEC = float(os.environ.get("FF_RUNPOD_POLL_SEC", "1"))
BOOT_TIMEOUT_SEC = float(os.environ.get("FF_BOOT_TIMEOUT_SEC", "300"))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if API_KEY:
        req.add_header("authorization", f"Bearer {API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        payload = err.read()
        try:
            return err.code, json.loads(payload)
        except ValueError:
            return err.code, {"error": {"code": "INTERNAL", "message": payload.decode(errors="replace")}}


def wait_ready():
    deadline = time.monotonic() + BOOT_TIMEOUT_SEC
    while time.monotonic() < deadline:
        try:
            status, body = call("GET", "/health")
            if status == 200:
                return
            if body and body.get("status") == "failed":
                raise RuntimeError(f"Renderer failed to start: {body.get('error')}")
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(1)
    raise RuntimeError("Renderer did not become healthy in time")


def draining():
    """True when the worker decided to recycle (job count, memory, GPU loss)."""
    try:
        status, body = call("GET", "/health")
        return status != 200 and (body or {}).get("status") == "draining"
    except (urllib.error.URLError, ConnectionError):
        return True


def failure(error, refresh=False):
    """RunPod marks a job failed when the output has an `error` key."""
    out = {"error": json.dumps(error), "refresh_worker": refresh}
    return out


def handler(job):
    status, body = call("POST", "/v2/jobs", job["input"])
    if status != 202:
        error = (body or {}).get("error", {"code": "INTERNAL", "message": str(body)})
        return failure(error, refresh=status == 503)

    job_id = body["id"]
    last_progress = None
    while True:
        time.sleep(POLL_SEC)
        status, record = call("GET", f"/v2/jobs/{job_id}")
        if status != 200:
            return failure({"code": "INTERNAL", "message": f"lost job {job_id} ({status})"}, refresh=True)

        progress = record.get("progress")
        if progress and progress != last_progress:
            runpod.serverless.progress_update(job, progress)
            last_progress = progress

        if record["status"] == "COMPLETED":
            result = dict(record["result"])
            if draining():
                result["refresh_worker"] = True
            return result
        if record["status"] in ("FAILED", "CANCELLED"):
            error = record.get("error") or {"code": "INTERNAL", "message": "unknown failure"}
            # Device loss / crashes leave the worker unhealthy: ask for a fresh one.
            refresh = error.get("code") in ("GPU_DEVICE_LOST", "RENDER_OOM", "RENDER_CRASHED") or draining()
            return failure(error, refresh=refresh)


if __name__ == "__main__":
    wait_ready()
    runpod.serverless.start({"handler": handler})
