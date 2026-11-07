# PyPad IDE

PyPad is an iPad-first coding workspace with a project dashboard, persistent file explorer, tabbed editor, Python REPL, terminal, web preview, package manager and built-in extensions.

## Python runtime

Every iOS release bundles Pyodide 0.26.4, a WebAssembly build of CPython. The runtime, standard library, package lockfile and prebuilt wheels are copied into the app at build time. A missing or undersized runtime makes the workflow fail; it is not an optional download.

Python source files execute locally inside the app's WebKit process. `input()` uses the native iOS prompt bridge. Standard-library code works without fetching the interpreter on launch. Installing additional packages from PyPI and accessing web APIs require a network connection and remain subject to browser CORS and Pyodide compatibility.

PyPad is not a full native CPython environment and does not run arbitrary iOS binaries, native desktop extensions, or unrestricted operating-system shell commands.

## IDE features

- Project-first home screen with recent files and starter projects.
- iOS Documents workspace, file/folder creation, import, rename, delete and ZIP export.
- CodeMirror editor, syntax highlighting, line numbers, keyboard shortcuts and iPad extra keys.
- Python file execution, `input()`, tracebacks, image output and an interactive Python REPL.
- Workspace shell commands and Python package manager.
- JavaScript execution and HTML/CSS/JS preview.
- Built-in JSON tools, Markdown preview and CSV grid extensions.
- Flask-compatible local preview for small learning projects.

## Build an unsigned IPA

Push to `main`, or run **Actions → Build PyPad iOS IPA → Run workflow**. The workflow vendors the complete Pyodide distribution, verifies its WebAssembly/runtime files, generates the Xcode project with XcodeGen, builds an unsigned archive and checks that the IPA contains the Python runtime.

The artifact is named **PyPad-unsigned-ipa**. It must be signed with a suitable development or sideloading certificate before installation.
