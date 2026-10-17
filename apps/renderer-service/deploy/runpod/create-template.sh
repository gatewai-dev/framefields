#!/bin/bash
# Creates (or updates, with TEMPLATE_ID set) a RunPod template from one of the
# JSON files here, via RunPod's GraphQL API (`saveTemplate`).
#   RUNPOD_API_KEY=... ./create-template.sh serverless.template.json [image]
# Edit the env values first (allowlist, storage endpoint). Secrets stay as
# {{ RUNPOD_SECRET_* }} references; create them under RunPod → Secrets.
set -euo pipefail
cd "$(dirname "$0")"
file="${1:?usage: create-template.sh <template.json> [image]}"
: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY}"

input=$(jq --arg image "${2:-}" --arg id "${TEMPLATE_ID:-}" '
  (if $image != "" then .imageName = $image else . end)
  | (if $id != "" then .id = $id else . end)
  | .readme = (.readme // "See apps/renderer-service/README.md in gatewai-dev/framefields.")
  | .volumeMountPath = (.volumeMountPath // "/runpod-volume")
' "$file")

payload=$(jq -n --argjson input "$input" '{
  query: "mutation SaveTemplate($input: SaveTemplateInput) { saveTemplate(input: $input) { id name imageName isServerless } }",
  variables: { input: $input }
}')

curl -sS https://api.runpod.io/graphql \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${RUNPOD_API_KEY}" \
  -d "$payload" | jq .
