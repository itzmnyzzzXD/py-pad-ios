#!/usr/bin/env bash
# Downloads CodeMirror into Web/vendor so the editor works fully offline.
# Failures are non-fatal: the app falls back to the CDN at runtime.
set -u
BASE="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16"
DEST="Web/vendor/cm"
FILES="codemirror.min.js codemirror.min.css
mode/python/python.min.js mode/javascript/javascript.min.js mode/xml/xml.min.js
mode/css/css.min.js mode/htmlmixed/htmlmixed.min.js mode/markdown/markdown.min.js
addon/edit/closebrackets.min.js addon/edit/matchbrackets.min.js
addon/selection/active-line.min.js addon/comment/comment.min.js"
for f in $FILES; do
  mkdir -p "$DEST/$(dirname "$f")"
  curl -fsSL "$BASE/$f" -o "$DEST/$f" || echo "warning: could not fetch $f"
done
echo "vendored $(find "$DEST" -type f | wc -l) editor files"
