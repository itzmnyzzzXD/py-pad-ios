#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for file in Web/js/*.js; do
  node --check "$file"
done

python3 - <<'PY'
from pathlib import Path
import re

for name in ("Web/py/pypad_runtime.py", "Web/py/flask.py"):
    source = Path(name).read_text(encoding="utf-8")
    compile(source, name, "exec")

python_js = Path("Web/js/python.js").read_text(encoding="utf-8")
runtime = Path("Web/py/pypad_runtime.py").read_text(encoding="utf-8")
ui = Path("Web/js/ui.js").read_text(encoding="utf-8")
shell = Path("Web/js/shell.js").read_text(encoding="utf-8")
extensions = Path("Web/js/extensions.js").read_text(encoding="utf-8")
html = Path("Web/index.html").read_text(encoding="utf-8")

# $() returns one node; $$() returns a list. Catch the exact startup regression.
bad = re.findall(r"(?<!\$)\$\([^)]*\)\.(?:forEach|map|filter|reduce|some|every|find|findIndex)\s*\(", ui)
if bad:
    raise SystemExit("Single-element selector used as an array: " + ", ".join(bad))
if "$$('#sbTabs button')" not in ui:
    raise SystemExit("Sidebar selector regression: expected $$() in sbSwitch")

# Python bootstrap must create the helper directory before writing pypad_runtime.py.
if "py.FS.mkdirTree(RT_ROOT)" not in python_js:
    raise SystemExit("Python runtime helper directory is not created")
if "async def shell_push(" not in runtime or "def prepare(" not in runtime:
    raise SystemExit("Python runtime is missing its script/REPL entry points")

for src in re.findall(r'<script\s+src="([^"]+)"', html):
    if not (Path("Web") / src).is_file():
        raise SystemExit("Missing script referenced by index.html: " + src)

if "ExtensionManager.runFile(p)" not in shell or "async runFile(path)" not in extensions:
    raise SystemExit("Extension manager is not connected to the Run dispatcher")

print("PyPad source checks passed: JavaScript syntax, Python syntax, selector regression, Python bootstrap, and script references.")
PY
