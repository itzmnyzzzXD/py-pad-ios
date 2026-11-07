"""PyPad runtime glue. Loaded once into Pyodide at startup."""
import sys, os, builtins, ast, inspect, traceback, io, base64, codeop, warnings
import importlib, importlib.abc, importlib.util

try:
    import js
except ImportError:  # running outside the browser (tests)
    js = None

os.environ.setdefault("MPLBACKEND", "Agg")
warnings.filterwarnings("ignore", message=".*non-interactive.*")

WS = ""
_last_error = ""
_pyodide_http_done = False


# ───────────── input() ─────────────
def _input(prompt=""):
    prompt = str(prompt)
    if js is None:
        raise EOFError("input() unavailable")
    r = js.window.prompt(prompt or "input()")
    if r is None:
        raise EOFError("input cancelled")
    r = str(r)
    print(prompt + r)
    return r


builtins.input = _input


# ───────────── matplotlib: show figures inline ─────────────
def _emit_figures(plt):
    for n in plt.get_fignums():
        fig = plt.figure(n)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor="white")
        data = base64.b64encode(buf.getvalue()).decode()
        if js is not None:
            js.PyPad.pyImage(data)
    plt.close("all")


def _patch_plt(mod):
    def show(*a, **k):
        _emit_figures(mod)
    mod.show = show


class _PostImportHook(importlib.abc.MetaPathFinder):
    def __init__(self, target, patch):
        self.target, self.patch = target, patch

    def find_spec(self, name, path, target=None):
        if name != self.target:
            return None
        sys.meta_path.remove(self)
        try:
            spec = importlib.util.find_spec(name)
        except Exception:
            spec = None
        finally:
            sys.meta_path.insert(0, self)
        if spec is None or spec.loader is None:
            return None
        loader, orig, patch = spec.loader, spec.loader.exec_module, self.patch

        def exec_module(module):
            orig(module)
            try:
                patch(module)
            except Exception:
                pass

        try:
            loader.exec_module = exec_module
        except Exception:
            pass
        return spec


def install_hooks(target="matplotlib.pyplot", patch=_patch_plt):
    if not any(isinstance(f, _PostImportHook) and f.target == target for f in sys.meta_path):
        sys.meta_path.insert(0, _PostImportHook(target, patch))


install_hooks()


def collect_images():
    out = []
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None and plt.get_fignums():
        for n in plt.get_fignums():
            fig = plt.figure(n)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor="white")
            out.append(base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    return out


def flush():
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass


# ───────────── running files ─────────────
def prepare(ws_root, cwd):
    global WS, _pyodide_http_done
    WS = ws_root
    os.chdir(cwd)
    for p in (ws_root, cwd):
        while p in sys.path:
            sys.path.remove(p)
        sys.path.insert(0, p)
    for name, m in list(sys.modules.items()):
        f = getattr(m, "__file__", None)
        if f and isinstance(f, str) and f.startswith(ws_root):
            sys.modules.pop(name, None)
    importlib.invalidate_caches()
    for shim in ("flask",):
        m = sys.modules.get(shim)
        if m is not None and hasattr(m, "_reset"):
            try:
                m._reset()
            except Exception:
                pass
    if not _pyodide_http_done:
        try:
            import pyodide_http
            pyodide_http.patch_all()
            _pyodide_http_done = True
        except Exception:
            pass


def repl_setup(ws_root, cwd):
    global WS
    WS = ws_root
    os.chdir(cwd)
    for p in (ws_root, cwd):
        if p not in sys.path:
            sys.path.insert(0, p)


def _format(e):
    tb = traceback.extract_tb(e.__traceback__)
    keep = [f for f in tb if (WS and f.filename.startswith(WS)) or f.filename == "<console>"]
    lines = []
    if keep:
        lines.append("Traceback (most recent call last):")
        lines += [l.rstrip("\n") for l in traceback.format_list(keep)]
    lines += [l.rstrip("\n") for l in traceback.format_exception_only(type(e), e)]
    text = "\n".join(lines)
    return text.replace(WS + "/", "") if WS else text


def _is_local(name):
    top = name.split(".")[0]
    for base in {os.getcwd(), WS}:
        if base and (os.path.exists(os.path.join(base, top + ".py")) or os.path.isdir(os.path.join(base, top))):
            return True
    return False


async def run_code(code, path):
    global _last_error
    g = {"__name__": "__main__", "__file__": path, "__builtins__": builtins}
    try:
        co = compile(code, path, "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        r = eval(co, g)
        if inspect.isawaitable(r):
            await r
        return "ok"
    except SystemExit:
        return "ok"
    except BaseException as e:  # noqa
        text = _format(e)
        if isinstance(e, ModuleNotFoundError) and e.name and not _is_local(e.name):
            _last_error = text
            return "missing:" + e.name.split(".")[0]
        sys.stderr.write(text + "\n")
        return "error"
    finally:
        _sh.ns.update({k: v for k, v in g.items() if not k.startswith("__")})


def last_error():
    return _last_error


# ───────────── interactive REPL (Terminal tab) ─────────────
class _Shell:
    def __init__(self):
        self.reset()

    def reset(self):
        self.ns = {"__name__": "__main__", "__builtins__": builtins}
        self.buf = []
        self.comp = codeop.CommandCompiler()
        self.comp.compiler.flags |= ast.PyCF_ALLOW_TOP_LEVEL_AWAIT


_sh = _Shell()


async def shell_push(line):
    """Feed one line to the REPL. Returns 'more', 'done' or 'missing:<module>'."""
    global _last_error
    _sh.buf.append(line)
    src = "\n".join(_sh.buf)
    try:
        code = _sh.comp(src, "<console>", "single")
    except (SyntaxError, OverflowError, ValueError) as e:
        _sh.buf = []
        sys.stderr.write(_format(e) + "\n")
        return "done"
    if code is None:
        return "more"
    _sh.buf = []
    try:
        r = eval(code, _sh.ns)
        if inspect.isawaitable(r):
            await r
    except SystemExit:
        pass
    except BaseException as e:  # noqa
        if isinstance(e, ModuleNotFoundError) and e.name and not _is_local(e.name):
            _last_error = _format(e)
            return "missing:" + e.name.split(".")[0]
        sys.stderr.write(_format(e) + "\n")
    return "done"


def shell_reset():
    _sh.reset()
