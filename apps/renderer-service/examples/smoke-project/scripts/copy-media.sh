#!/usr/bin/env bash
# Copies the media this project uses from a framefields checkout into
# assets/. The framefields repo keeps media out of git, so these files exist
# only in local checkouts: fonts from assets/fonts, and the portrait, dancer
# video and score from examples/19_framefields_film/assets. Needs ffmpeg.
#
# Usage: scripts/copy-media.sh [path-to-framefields-checkout]
# (defaults to the checkout this project sits in)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${1:-$(cd "$here/../../../.." && pwd)}"
film="$repo/examples/19_framefields_film/assets"
out="$here/assets"

for f in "$repo/assets/fonts/Inter.ttf" "$repo/assets/fonts/Syne.ttf" "$repo/assets/fonts/JetBrainsMono.ttf" \
	"$film/dancer.mp4" "$film/portrait.png" "$film/score.mp3"; do
	[ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

mkdir -p "$out/fonts"
cp "$repo/assets/fonts/Inter.ttf" "$repo/assets/fonts/Syne.ttf" "$repo/assets/fonts/JetBrainsMono.ttf" "$out/fonts/"
cp "$film/score.mp3" "$out/score.mp3"
# 6 s at 1280 px keeps the repo small; the vision models don't need more.
ffmpeg -v error -y -i "$film/dancer.mp4" -t 6 -vf "scale=1280:-2,fps=30" \
	-c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -an "$out/dancer.mp4"
ffmpeg -v error -y -i "$film/portrait.png" -vf "scale=1280:-2" -q:v 3 "$out/portrait.jpg"

echo "copied media into $out"
