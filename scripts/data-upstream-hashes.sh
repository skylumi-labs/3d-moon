#!/usr/bin/env bash
# Downloads the public originals behind the bundled data and prints the SHA-256 of each, so the open provenance notes in
# DATA-LICENSES.md can be closed. Reads public URLs only; writes nothing outside a fresh temporary directory; uploads nothing.
#
#   scripts/data-upstream-hashes.sh            SVS 4k inputs, the three panorama originals, the LM model (LM_GLB_URL), HYG (HYG_CSV_URL)
#   scripts/data-upstream-hashes.sh --large    also the full-size SVS inputs of the hosted tiles (several GB)
#
# LM_GLB_URL: the "Download" link of https://science.nasa.gov/3d-resources/apollo-lunar-module/ (the page builds it; copy it).
# HYG_CSV_URL: a hygdata_vNN.csv(.gz) from https://codeberg.org/astronexus/hyg; the result says whether it is the shipped release.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
svs=https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720

fetch() { # name url
  local out="$work/$1"
  if curl -fsSL --retry 2 -o "$out" "$2"; then
    printf '%s  %s  %s bytes  %s\n' "$(sha256sum "$out" | cut -d' ' -f1)" "$1" "$(wc -c <"$out" | tr -d ' ')" "$2"
  else
    printf 'FAILED  %s  %s\n' "$1" "$2" >&2
  fi
}

echo "# upstream SHA-256, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
fetch lroc_color_poles_4k.tif "$svs/lroc_color_poles_4k.tif"
fetch ldem_16_uint.tif "$svs/ldem_16_uint.tif"
if [ "${1:-}" = "--large" ]; then
  fetch lroc_color_poles.tif "$svs/lroc_color_poles.tif"
  fetch ldem_64_uint.tif "$svs/ldem_64_uint.tif"
fi
fetch jsc2004e52772~orig.jpg https://images-assets.nasa.gov/image/jsc2004e52772/jsc2004e52772~orig.jpg
fetch JSC2007e045388.jpg https://www.lpi.usra.edu/resources/apollopanoramas/images/print/original/JSC2007e045388.jpg
fetch JSC2007e045387.jpg https://www.lpi.usra.edu/resources/apollopanoramas/images/print/original/JSC2007e045387.jpg

if [ -n "${LM_GLB_URL:-}" ]; then
  fetch apollo-lunar-module.glb "$LM_GLB_URL"
  if [ -f "$work/apollo-lunar-module.glb" ]; then
    if cmp -s "$work/apollo-lunar-module.glb" "$root/public/lm/apollo-lunar-module.glb"; then echo "LM model: byte-identical to public/lm/apollo-lunar-module.glb"
    else echo "LM model: DIFFERS from public/lm/apollo-lunar-module.glb"; fi
  fi
else
  echo "LM model: skipped (set LM_GLB_URL to the model page's download link)"
fi

if [ -n "${HYG_CSV_URL:-}" ]; then
  name=$(basename "$HYG_CSV_URL")
  fetch "$name" "$HYG_CSV_URL"
  [ -f "$work/$name" ] && node --import tsx "$root/scripts/hyg-match.mts" "$work/$name"
else
  echo "HYG: skipped (set HYG_CSV_URL to a hygdata_vNN.csv or .csv.gz)"
fi
