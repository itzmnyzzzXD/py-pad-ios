#!/usr/bin/env bash
# Bundles the full Pyodide distribution (CPython + numpy/pandas/scipy/...) inside the app.
set -eu
V="0.26.4"
mkdir -p Web/vendor
curl -fL "https://github.com/pyodide/pyodide/releases/download/$V/pyodide-$V.tar.bz2" -o /tmp/pyodide.tar.bz2
tar -xjf /tmp/pyodide.tar.bz2 -C Web/vendor
ls Web/vendor/pyodide | head
