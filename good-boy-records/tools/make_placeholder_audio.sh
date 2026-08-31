#!/usr/bin/env bash
# Stand-in audio, so the deck, the clock and the lyric highlighting can be seen
# working before any real song is committed. A quiet drone with a click on the
# beat — nothing to do with the actual tracks.
#
# Replace assets/audio/tracks/<slug>.mp3 with the real render and set
# audio.placeholder to false in the matching YAML file.
set -euo pipefail
cd "$(dirname "$0")/.."

make() {
  local slug=$1 seconds=$2 beat=$3
  # Commas inside the expression must be escaped or ffmpeg reads them as
  # filter-argument separators.
  local expr="0.22*sin(2*PI*880*t)*exp(-9*mod(t\\,${beat}))+0.06*sin(2*PI*110*t)"
  ffmpeg -loglevel error -y -f lavfi -i "aevalsrc=${expr}:d=${seconds}:s=44100" \
    -ac 1 -b:a 64k "assets/audio/tracks/${slug}.mp3"
  ffmpeg -loglevel error -y -i "assets/audio/tracks/${slug}.mp3" -t 12 \
    -ac 1 -b:a 96k "assets/audio/previews/${slug}.mp3"
  echo "  ${slug}: ${seconds}s placeholder + 12s preview"
}

echo "Writing placeholder audio"
make sixteen-treats     112 0.42
make new-mills-new-mills 104 0.60
make dogtushya          128 0.50
make gimmie-gimmie-ball 120 0.44
