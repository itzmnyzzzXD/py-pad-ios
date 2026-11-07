#!/usr/bin/env bash
set -euo pipefail
VERSION="0.26.4"
DEST="Web/vendor/pyodide"
ARCHIVE="${RUNNER_TEMP:-/tmp}/pyodide-${VERSION}.tar.bz2"
if [[ -s "$DEST/pyodide.js" && -s "$DEST/pyodide.asm.wasm" && -s "$DEST/python_stdlib.zip" && -s "$DEST/pyodide-lock.json" ]]; then
  echo "Using cached Pyodide $VERSION"
  exit 0
fi
mkdir -p Web/vendor
curl --fail --location --retry 3 --retry-delay 2 "https://github.com/pyodide/pyodide/releases/download/${VERSION}/pyodide-${VERSION}.tar.bz2" --output "$ARCHIVE"
rm -rf "$DEST"
tar -xjf "$ARCHIVE" -C Web/vendor
for file in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do
  test -s "$DEST/$file" || { echo "Missing required Pyodide file: $DEST/$file" >&2; exit 1; }
done
find "$DEST" -maxdepth 1 -type f -name '*.whl' -print -quit | grep -q . || { echo "No bundled wheels found" >&2; exit 1; }
SIZE_KB="$(du -sk "$DEST" | awk '{print $1}')"
if (( SIZE_KB < 100000 )); then echo "Pyodide distribution unexpectedly small ($SIZE_KB KB)" >&2; exit 1; fi
echo "Verified Pyodide $VERSION bundle: $(du -sh "$DEST" | cut -f1)"
