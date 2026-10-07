#!/usr/bin/env bash
# Stretch the seamless loop into a long video with your music, without re-encoding the picture.
#   tools/make-long.sh <loop.mp4 | loop-part1-of-N.mp4> <music-file> [hours=1] [out.mp4]
# If you pass part 1 of a split loop (…-part1-of-6.mp4), the other parts in the
# same folder are joined first, losslessly.
# The music file is looped too; for a playlist, first concatenate your tracks into one file:
#   ffmpeg -f concat -safe 0 -i tracks.txt -c:a aac -b:a 192k playlist.m4a
set -euo pipefail
if [ $# -lt 2 ]; then
  echo "usage: $0 <loop.mp4 | loop-part1-of-N.mp4> <music-file> [hours=1] [out.mp4]" >&2
  exit 1
fi
LOOP_VIDEO=$1
AUDIO=$2
HOURS=${3:-1}
OUT=${4:-rainy-hollow-${HOURS}h.mp4}
SECS=$(awk "BEGIN { print $HOURS * 3600 }")

if [[ "$LOOP_VIDEO" == *-part1-of-*.mp4 ]]; then
  N=${LOOP_VIDEO##*-part1-of-}
  N=${N%.mp4}
  PREFIX=${LOOP_VIDEO%-part1-of-*.mp4}
  LIST=$(mktemp)
  trap 'rm -f "$LIST"' EXIT
  for i in $(seq 1 "$N"); do
    PART="$PREFIX-part$i-of-$N.mp4"
    [ -f "$PART" ] || { echo "missing $PART" >&2; exit 1; }
    echo "file '$(cd "$(dirname "$PART")" && pwd)/$(basename "$PART")'" >> "$LIST"
  done
  JOINED="$PREFIX.mp4"
  echo "joining $N parts into $JOINED"
  ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$LIST" -c copy "$JOINED"
  LOOP_VIDEO=$JOINED
fi

ffmpeg -hide_banner -y \
  -stream_loop -1 -i "$LOOP_VIDEO" \
  -stream_loop -1 -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k \
  -t "$SECS" -movflags +faststart "$OUT"
echo "wrote $OUT"
