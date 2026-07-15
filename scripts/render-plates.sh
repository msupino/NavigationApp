#!/usr/bin/env bash
# Rasterise each airfield plate PDF in docs/byop/ to per-page PNGs so the app
# can show them as images — poppler renders the embedded Hebrew CID fonts
# correctly (PDF.js garbles them) and images work in the Android WebView, which
# has no native PDF renderer. Writes <base>-pNN.png + plates-manifest.json.
set -euo pipefail
BYOP="docs/byop"
DPI="${1:-150}"
find "$BYOP" -name '*-p[0-9][0-9].png' -delete
shopt -s nullglob
for pdf in "$BYOP"/*.pdf; do
  base="$(basename "$pdf" .pdf)"
  tmp="$(mktemp -d)"
  pdftoppm -png -r "$DPI" "$pdf" "$tmp/pg"
  i=1
  while IFS= read -r pg; do
    printf -v nn "%02d" "$i"
    out="$BYOP/${base}-p${nn}.png"
    # Palette-compress (charts are line/text art → big savings, visually lossless
    # enough for on-screen viewing). Fall back to the raw PNG if pngquant can't.
    if command -v pngquant >/dev/null 2>&1; then
      pngquant --quality=60-90 --strip --force --output "$out" 256 "$pg" 2>/dev/null || cp "$pg" "$out"
    else
      cp "$pg" "$out"
    fi
    i=$((i+1))
  done < <(ls "$tmp"/pg-*.png | sort -V)
  rm -rf "$tmp"
  echo "rendered: $base ($((i-1)) pages)"
done
# manifest: { "<plate>.pdf": pageCount }
python3 - "$BYOP" <<'PY'
import os,sys,json,glob
byop=sys.argv[1]; man={}
for pdf in sorted(glob.glob(os.path.join(byop,'*.pdf'))):
    base=os.path.basename(pdf)[:-4]
    n=len(glob.glob(os.path.join(byop, base.replace('[','[[]')+'-p[0-9][0-9].png')))
    man[os.path.basename(pdf)]=n
json.dump(man, open(os.path.join(byop,'plates-manifest.json'),'w'), ensure_ascii=False, indent=0)
print('manifest entries:',len(man),'total pages:',sum(man.values()))
PY
