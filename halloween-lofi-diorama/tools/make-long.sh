#!/usr/bin/env bash
# Stretch the seamless loop into a long video with your music, without re-encoding the picture.
#   tools/make-long.sh <loop.mp4> <music-file> [hours=10] [out.mp4]
# The music file is looped too; for a playlist, first concatenate your tracks into one file:
#   ffmpeg -f concat -safe 0 -i tracks.txt -c:a aac -b:a 192k playlist.m4a
set -euo pipefail
if [ $# -lt 2 ]; then
  echo "usage: $0 <loop.mp4> <music-file> [hours=10] [out.mp4]" >&2
  exit 1
fi
LOOP_VIDEO=$1
AUDIO=$2
HOURS=${3:-10}
OUT=${4:-rainy-hollow-${HOURS}h.mp4}
SECS=$(awk "BEGIN { print $HOURS * 3600 }")
ffmpeg -hide_banner -y \
  -stream_loop -1 -i "$LOOP_VIDEO" \
  -stream_loop -1 -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -t "$SECS" -movflags +faststart "$OUT"
echo "wrote $OUT"
