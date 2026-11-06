# PyPad: a pocket IDE for iPad and iPhone

Write and run **Python, JavaScript, HTML/CSS, Flask apps and Discord bots** on your device.
Built-in terminal (Python REPL + shell), live HTML preview, a Packages manager, templates,
and a custom cursor for mouse / trackpad / Bluetooth pointers.

## Get the IPA (no Mac needed)

1. **Unzip** this archive on your computer.
2. Create a new **GitHub repository** and upload the *contents* of the `PyPad` folder so that
   `project.yml` sits at the top level of the repo (not inside another folder).
   * The folder `.github/workflows/` is **hidden**. Make sure it uploads. If it does not show up in
     your repo, open the repo → **Add file → Create new file**, type the name
     `.github/workflows/build-ipa.yml`, and paste the contents of `build-ipa.workflow.yml.txt`.
3. Go to the **Actions** tab. The *Build IPA* workflow starts automatically on every push
   (or press **Run workflow**). It takes about 5 to 10 minutes.
4. When it finishes, open the run and download the artifact **PyPad-ipa**. Unzip it to get `PyPad.ipa`.

### Offline Python (optional)
Press **Run workflow** and tick *Bundle Python (Pyodide)…*. The app then contains the whole Python runtime
(about 300 MB bigger) and works with no internet. Without it the runtime is downloaded the first time you run
Python and cached afterwards.

## Install it on your device
The IPA is **unsigned**, so it must be signed when installed. Any of these work:

* **Sideloadly** (Windows/Mac): drag in the IPA, sign in with your Apple ID. Apps expire after 7 days on a free account.
* **AltStore / SideStore**: same idea, can auto-refresh.
* **TrollStore** (supported iOS versions): installs unsigned IPAs permanently.
* A paid Apple Developer account can sign and distribute it through TestFlight.

## What's inside

| Feature | How it works |
|---|---|
| Python | Real CPython 3.12 via [Pyodide](https://pyodide.org) (WebAssembly). `input()`, `asyncio`, top-level `await`, tracebacks, matplotlib figures shown inline |
| Packages | numpy, pandas, scipy, matplotlib, scikit-learn, sympy, pillow, opencv, requests, bs4, lxml, pydantic, sqlalchemy and more. Missing imports are **auto-installed** on Run. Any pure-Python PyPI package works via `pip install` |
| Flask | Built-in Flask-compatible framework (routes, converters, Jinja2 templates, forms, JSON, sessions, blueprints, error handlers, static files, test client). `app.run()` opens a live **Preview** |
| Discord | Built-in `discord.py`-compatible library (Client/Bot, commands, cogs, embeds, events, tasks, slash commands) with a **chat simulator** tab |
| JavaScript | Runs in a sandboxed iframe with console capture, top-level `await`, and `await use("lodash")` to load any npm package from a CDN. **Stop** button works |
| HTML/CSS/JS | Preview inlines your local CSS/JS/images, with console output in the Terminal tab |
| Terminal | Tap `>>>` / `$` to switch between a Python REPL and a shell (`ls cd cat rm mv cp echo pip python node` and more) |
| Files | Real files in *Files app → PyPad → Workspace*. Import, rename, duplicate, share, export all as zip |
| Cursor | Custom ring / dot / arrow / crosshair for mice and trackpads, with size, color, smoothing and system-pointer hiding |
| Editor | CodeMirror with syntax highlighting, bracket matching, touch **extra-keys bar** (`( ) [ ] { } : ⇥ ↶ ↷ ←→↑↓`) |

Hardware keyboard shortcuts: `⌘↵` run, `⌘S` save, `⌘N` new file, `⌘B` sidebar, `⌘J` output panel, `⌘K` clear, `⌘,` settings, `⌘/` comment.

## Honest limitations

* **Discord bots do not connect to real Discord.** iOS apps can't open the gateway connection the real
  `discord.py` needs, so `bot.run(token)` starts a local simulator. Code is written exactly like discord.py,
  so you can copy the same file to a server later. Like the real thing, prefix commands need
  `intents.message_content = True`.
* **Flask runs in-process**, not as a network server. It is only reachable from the Preview tab.
* **Python runs on the main thread.** An infinite `while True:` loop will freeze the app (force-quit to recover); use
  `await asyncio.sleep()` in loops. JavaScript runs in a separate iframe and can be stopped.
* Only packages with Pyodide builds or pure-Python wheels install (no packages that need compiling C code).
* Network requests from Python/JS are subject to browser CORS rules.

## Project layout

```
project.yml               XcodeGen spec (the CI generates the .xcodeproj from this)
App/                      SwiftUI shell, WKWebView, native bridge (files, dialogs, share, pointer)
Web/                      The IDE (HTML/CSS/JS) + Python shims (flask, discord, runtime)
scripts/                  CI helpers that vendor CodeMirror / Pyodide for offline use
.github/workflows/        Build IPA workflow
```

To change the app name or bundle id, edit `project.yml` (`PRODUCT_BUNDLE_IDENTIFIER`, `CFBundleDisplayName`).
