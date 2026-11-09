#!/usr/bin/env bash
# Shrink photos in src/photos to at most 1280px on the long edge, as JPEG.
# The frame has ~1 GB of RAM and a screen 1280 px wide at DPR 1: a 6000x3376 camera photo takes
# ~81 MB to decode and can crash the WebView, while 1280 px looks identical on the panel.
#
# Originals are moved to photos-originals/ (git-ignored) first, never overwritten.
# Uses macOS `sips`. Already-small photos are left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=src/photos
KEEP=photos-originals
MAX=1280
mkdir -p "$KEEP"
shopt -s nullglob nocaseglob
files=( "$SRC"/*.jpg "$SRC"/*.jpeg "$SRC"/*.png "$SRC"/*.heic "$SRC"/*.webp )
[ ${#files[@]} -eq 0 ] && { echo "No photos in $SRC"; exit 0; }

for f in "${files[@]}"; do
  name=$(basename "$f")
  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')
  ext=$(echo "${name##*.}" | tr '[:upper:]' '[:lower:]')
  if [ "$w" -le $MAX ] && [ "$h" -le $MAX ] && { [ "$ext" = jpg ] || [ "$ext" = jpeg ]; }; then
    echo "ok       $name (${w}x${h})"; continue
  fi
  [ -e "$KEEP/$name" ] || cp -p "$f" "$KEEP/$name"
  out="$SRC/${name%.*}.jpg"
  tmp="$out.tmp.jpg"
  sips -s format jpeg -s formatOptions 82 -Z $MAX "$f" --out "$tmp" >/dev/null
  rm "$f"
  mv "$tmp" "$out"
  echo "resized  $name ${w}x${h} -> $(basename "$out") $(sips -g pixelWidth "$out" | awk '/pixelWidth/{print $2}')x$(sips -g pixelHeight "$out" | awk '/pixelHeight/{print $2}'), $(( $(stat -f%z "$out") / 1024 )) KB  (original kept in $KEEP/)"
done
