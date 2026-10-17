#!/bin/bash
# Verifies deploy/known_hosts against the pinned fingerprints (default), or
# refreshes it from the live hosts first (--refresh). Fails on any key whose
# fingerprint isn't pinned, or any pinned fingerprint that's missing.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--refresh" ]; then
  : > known_hosts.new
  for host in $(grep -v '^#' known_hosts.fingerprints | awk '{print $1}' | sort -u); do
    ssh-keyscan -T 15 -t ed25519,ecdsa,rsa "$host" 2>/dev/null | grep -v "^#" >> known_hosts.new
  done
  mv known_hosts.new known_hosts
fi

actual=$(ssh-keygen -lf known_hosts | awk '{print $3, $2}' | sort)
expected=$(grep -v '^#' known_hosts.fingerprints | sed '/^$/d' | sort)
if [ "$actual" != "$expected" ]; then
  echo "known_hosts does not match known_hosts.fingerprints:" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  exit 1
fi
echo "known_hosts verified ($(echo "$actual" | wc -l | tr -d ' ') keys)"
