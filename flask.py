"""Flask-compatible framework for PyPad.

Runs entirely inside the app: ``app.run()`` registers the app and opens the Preview tab.
Supports routing (with converters), methods, request/form/json/args, templates (real Jinja2),
static files, sessions (in-memory), flash, redirects, abort, errorhandlers, before/after request,
blueprints, jsonify, async view functions and a test client.
"""
import re, os, sys, json as _json, inspect, base64, mimetypes, traceback, contextvars
from urllib.parse import parse_qsl, urlsplit, urlencode, quote

try:
    import js
except ImportError:
    js = None

__version__ = "3.0.0-pypad"

_apps = []
_current_app = None
_req_var = contextvars.ContextVar("pypad_request", default=None)
_session = {}


def _reset():
    global _current_app
    _apps.clear()
    _current_app = None


# ───────────── helpers ─────────────
try:
    from markupsafe import Markup, escape
except Exception:  # jinja2/markupsafe not loaded yet
    import html as _html

    class Markup(str):
        def __html__(self):
            return self

    def escape(s):
        return Markup(_html.escape(str(s)))


class Headers(dict):
    def __init__(self, data=None):
        super().__init__()
        for k, v in dict(data or {}).items():
            self[k] = v

    def __setitem__(self, k, v):
        super().__setitem__(str(k).lower(), str(v))

    def __getitem__(self, k):
        return super().__getitem__(str(k).lower())

    def get(self, k, default=None):
        return super().get(str(k).lower(), default)

    def __contains__(self, k):
        return super().__contains__(str(k).lower())

    def add(self, k, v):
        self[k] = v

    def set(self, k, v):
        self[k] = v

    def getlist(self, k):
        v = self.get(k)
        return [v] if v is not None else []


class MultiDict(dict):
    def __init__(self, pairs=()):
        super().__init__()
        self._l = {}
        for k, v in pairs:
            self._l.setdefault(k, []).append(v)
        for k, l in self._l.items():
            dict.__setitem__(self, k, l[0])

    def getlist(self, k):
        return list(self._l.get(k, []))

    def get(self, k, default=None, type=None):
        if k in self:
            v = dict.__getitem__(self, k)
            if type is not None:
                try:
                    return type(v)
                except Exception:
                    return default
            return v
        return default

    def to_dict(self, flat=True):
        return dict(self) if flat else {k: list(v) for k, v in self._l.items()}

    def items(self, multi=False):
        if multi:
            return [(k, v) for k, l in self._l.items() for v in l]
        return super().items()


class HTTPException(Exception):
    code = 500
    name = "Internal Server Error"
    description = "The server encountered an internal error."

    def __init__(self, description=None, response=None):
        super().__init__(description or self.description)
        if description:
            self.description = description
        self.response = response

    def get_response(self):
        body = ("<!doctype html>\n<html lang=en>\n<title>%d %s</title>\n<h1>%s</h1>\n<p>%s</p>\n"
                % (self.code, self.name, self.name, self.description))
        return Response(body, self.code)


def _exc(code, name, desc):
    return type(name.replace(" ", ""), (HTTPException,), {"code": code, "name": name, "description": desc})


BadRequest = _exc(400, "Bad Request", "The browser sent a request that this server could not understand.")
Unauthorized = _exc(401, "Unauthorized", "You need to log in to view this.")
Forbidden = _exc(403, "Forbidden", "You don't have permission to access this resource.")
NotFound = _exc(404, "Not Found", "The requested URL was not found on the server.")
MethodNotAllowed = _exc(405, "Method Not Allowed", "The method is not allowed for the requested URL.")
Conflict = _exc(409, "Conflict", "A conflict happened while processing the request.")
Gone = _exc(410, "Gone", "The requested resource is no longer available.")
UnprocessableEntity = _exc(422, "Unprocessable Entity", "The request was well-formed but could not be processed.")
TooManyRequests = _exc(429, "Too Many Requests", "Too many requests.")
InternalServerError = _exc(500, "Internal Server Error", "The server encountered an internal error.")
_HTTP = {e.code: e for e in (BadRequest, Unauthorized, Forbidden, NotFound, MethodNotAllowed, Conflict, Gone,
                             UnprocessableEntity, TooManyRequests, InternalServerError)}


def abort(code, description=None):
    if isinstance(code, Response):
        raise HTTPException(response=code)
    cls = _HTTP.get(code)
    if cls is None:
        cls = _exc(code, "Error", "Error")
    raise cls(description)


# ───────────── request / response ─────────────
class Request:
    def __init__(self, method, path, query, body, ctype):
        self.method = method.upper()
        self.path = path
        self.query_string = query.encode()
        self.full_path = path + ("?" + query if query else "")
        self.host = "localhost:%d" % (_current_app.port if _current_app else 5000)
        self.base_url = "http://" + self.host + path
        self.url = "http://" + self.host + self.full_path
        self.url_root = "http://" + self.host + "/"
        self.scheme = "http"
        self.args = MultiDict(parse_qsl(query, keep_blank_values=True))
        self.content_type = ctype or None
        self.mimetype = (ctype or "").split(";")[0].strip().lower()
        self.is_json = self.mimetype == "application/json" or self.mimetype.endswith("+json")
        self.headers = Headers({"content-type": ctype, "host": self.host, "user-agent": "PyPad"})
        self.data = body.encode() if isinstance(body, str) else body
        self._text = body
        self.form = MultiDict(parse_qsl(body, keep_blank_values=True)) if self.mimetype == "application/x-www-form-urlencoded" else MultiDict()
        self.files = MultiDict()
        self.values = MultiDict(list(self.args.items(multi=True)) + list(self.form.items(multi=True)))
        self.cookies = {}
        self.remote_addr = "127.0.0.1"
        self.endpoint = None
        self.view_args = {}
        self.blueprint = None
        self.g = _G()
        self._json = None

    def get_json(self, force=False, silent=False, cache=True):
        if self._json is not None and cache:
            return self._json
        if not (force or self.is_json):
            if silent:
                return None
            raise BadRequest("Did not attempt to load JSON data because the request Content-Type was not 'application/json'.")
        try:
            self._json = _json.loads(self._text or "null")
        except ValueError:
            if silent:
                return None
            raise BadRequest("Failed to decode JSON object")
        return self._json

    @property
    def json(self):
        return self.get_json()

    def get_data(self, as_text=False):
        return self._text if as_text else self.data


class Response:
    default_mimetype = "text/html"

    def __init__(self, response=None, status=None, headers=None, mimetype=None, content_type=None):
        self.headers = Headers(headers if isinstance(headers, dict) else dict(headers or []))
        self.status_code = 200
        if isinstance(status, str):
            m = re.match(r"\s*(\d+)", status)
            self.status_code = int(m.group(1)) if m else 200
        elif status:
            self.status_code = int(status)
        if response is None:
            response = b""
        if not isinstance(response, (str, bytes, bytearray)):
            response = b"".join(x.encode() if isinstance(x, str) else x for x in response)
        self._data = response.encode("utf-8") if isinstance(response, str) else bytes(response)
        if content_type:
            self.headers["content-type"] = content_type
        elif mimetype:
            self.headers["content-type"] = mimetype + ("; charset=utf-8" if mimetype.startswith("text/") else "")
        elif "content-type" not in self.headers:
            self.headers["content-type"] = self.default_mimetype + "; charset=utf-8"

    @property
    def data(self):
        return self._data

    @data.setter
    def data(self, v):
        self._data = v.encode() if isinstance(v, str) else v

    def get_data(self, as_text=False):
        return self._data.decode("utf-8", "replace") if as_text else self._data

    def set_data(self, v):
        self.data = v

    @property
    def text(self):
        return self.get_data(True)

    @property
    def status(self):
        return str(self.status_code)

    @property
    def mimetype(self):
        return self.headers.get("content-type", "").split(";")[0]

    @property
    def location(self):
        return self.headers.get("location")

    @property
    def json(self):
        return _json.loads(self.text)

    def get_json(self, **kw):
        return self.json

    def set_cookie(self, *a, **k):
        pass

    def delete_cookie(self, *a, **k):
        pass


class _G:
    def get(self, k, default=None):
        return self.__dict__.get(k, default)

    def pop(self, k, *d):
        return self.__dict__.pop(k, *d)

    def setdefault(self, k, v):
        return self.__dict__.setdefault(k, v)

    def __contains__(self, k):
        return k in self.__dict__

    def __iter__(self):
        return iter(self.__dict__)


class _Proxy:
    def __init__(self, getter, name):
        object.__setattr__(self, "_getter", getter)
        object.__setattr__(self, "_name", name)

    def __getattr__(self, n):
        return getattr(self._getter(), n)

    def __setattr__(self, n, v):
        setattr(self._getter(), n, v)

    def __getitem__(self, k):
        return self._getter()[k]

    def __setitem__(self, k, v):
        self._getter()[k] = v

    def __delitem__(self, k):
        del self._getter()[k]

    def __contains__(self, k):
        return k in self._getter()

    def __iter__(self):
        return iter(self._getter())

    def __len__(self):
        return len(self._getter())

    def __bool__(self):
        try:
            self._getter()
            return True
        except RuntimeError:
            return False

    def __repr__(self):
        return "<LocalProxy %s>" % self._name


def _req():
    r = _req_var.get()
    if r is None:
        raise RuntimeError("Working outside of request context.")
    return r


def _app():
    if _current_app is None:
        raise RuntimeError("Working outside of application context.")
    return _current_app


request = _Proxy(_req, "request")
g = _Proxy(lambda: _req().g, "g")
session = _Proxy(lambda: _session, "session")
current_app = _Proxy(_app, "current_app")


# ───────────── routing ─────────────
_CONV = {"string": r"[^/]+", "int": r"\d+", "float": r"\d+\.\d+", "path": r".+", "uuid": r"[0-9a-fA-F-]{36}", "any": r"[^/]+"}
_PART = re.compile(r"<(?:(?P<conv>[a-zA-Z_]+)(?:\((?P<args>[^)]*)\))?:)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)>")


class Rule:
    def __init__(self, rule, endpoint, methods):
        self.rule, self.endpoint = rule, endpoint
        self.methods = set(m.upper() for m in methods)
        if "GET" in self.methods:
            self.methods.add("HEAD")
        pos, rx, self.convs = 0, "", {}
        for m in _PART.finditer(rule):
            rx += re.escape(rule[pos:m.start()])
            c = m.group("conv") or "string"
            rx += "(?P<%s>%s)" % (m.group("name"), _CONV.get(c, _CONV["string"]))
            self.convs[m.group("name")] = c
            pos = m.end()
        rx += re.escape(rule[pos:])
        self.slash = rule.endswith("/") and len(rule) > 1
        self.regex = re.compile("^" + rx + "$")
        self.alt = re.compile("^" + rx.rstrip("/") + "$") if self.slash else None

    def match(self, path):
        m = self.regex.match(path)
        if m:
            return self._conv(m), False
        if self.alt is not None:
            m = self.alt.match(path)
            if m:
                return self._conv(m), True  # needs redirect to trailing slash
        return None

    def _conv(self, m):
        out = {}
        for k, v in m.groupdict().items():
            c = self.convs[k]
            out[k] = int(v) if c == "int" else float(v) if c == "float" else v
        return out

    def build(self, values):
        values = dict(values)

        def sub(m):
            n = m.group("name")
            if n not in values:
                raise ValueError("Missing value for URL parameter '%s'" % n)
            return quote(str(values.pop(n)), safe="/" if self.convs[n] == "path" else "")
        return _PART.sub(sub, self.rule), values


def url_for(endpoint, **values):
    app = _app()
    anchor = values.pop("_anchor", None)
    values.pop("_external", None)
    values.pop("_scheme", None)
    values.pop("_method", None)
    if endpoint.startswith("."):
        r = _req_var.get()
        bp = r.blueprint if r else None
        endpoint = (bp + endpoint) if bp else endpoint[1:]
    if endpoint == "static":
        fn = values.pop("filename", "")
        url = app.static_url_path.rstrip("/") + "/" + fn
        rest = values
    else:
        rule = next((r for r in app.rules if r.endpoint == endpoint), None)
        if rule is None:
            raise RuntimeError("Could not build url for endpoint '%s'." % endpoint)
        url, rest = rule.build(values)
    if rest:
        url += "?" + urlencode(rest, doseq=True)
    if anchor:
        url += "#" + anchor
    return url


# ───────────── responses ─────────────
def jsonify(*args, **kwargs):
    if args and kwargs:
        raise TypeError("jsonify() behavior undefined when passed both args and kwargs")
    data = args[0] if len(args) == 1 else (list(args) if args else kwargs)
    return Response(_json.dumps(data, ensure_ascii=False, default=str, indent=None) + "\n", mimetype="application/json")


def redirect(location, code=302, Response=Response):
    r = Response("<!doctype html><title>Redirecting...</title><p>Redirecting to <a href='%s'>%s</a></p>" % (location, location), code)
    r.headers["location"] = str(location)
    return r


def make_response(*args):
    return _app().make_response(args if len(args) > 1 else (args[0] if args else ""))


def render_template(template_name, **context):
    app = _app()
    ctx = app._template_context()
    ctx.update(context)
    return app._env().get_template(template_name).render(**ctx)


def render_template_string(source, **context):
    app = _app()
    ctx = app._template_context()
    ctx.update(context)
    return app._env().from_string(source).render(**ctx)


def flash(message, category="message"):
    _session.setdefault("_flashes", []).append((category, message))


def get_flashed_messages(with_categories=False, category_filter=()):
    fl = _session.pop("_flashes", [])
    if category_filter:
        fl = [f for f in fl if f[0] in category_filter]
    return fl if with_categories else [m for _, m in fl]


def send_from_directory(directory, path, **kw):
    full = os.path.normpath(os.path.join(directory, path))
    if not full.startswith(os.path.normpath(directory)) or not os.path.isfile(full):
        abort(404)
    return send_file(full)


def send_file(path, mimetype=None, **kw):
    if not os.path.isfile(path):
        abort(404)
    with open(path, "rb") as f:
        data = f.read()
    mt = mimetype or mimetypes.guess_type(path)[0] or "application/octet-stream"
    return Response(data, mimetype=mt)


def stream_with_context(x):
    return x


# ───────────── application ─────────────
class _Ctx:
    def __init__(self, req):
        self.req, self.tok = req, None

    def __enter__(self):
        self.tok = _req_var.set(self.req)
        return self

    def __exit__(self, *a):
        _req_var.reset(self.tok)

    push = __enter__

    def pop(self):
        self.__exit__()


class Flask:
    def __init__(self, import_name=None, static_url_path=None, static_folder="static", template_folder="templates", **kw):
        global _current_app
        self.import_name = self.name = import_name or "app"
        self.static_folder = static_folder
        self.static_url_path = static_url_path or ("/" + static_folder.strip("/") if static_folder else "/static")
        self.template_folder = template_folder
        self.config = {"DEBUG": False, "TESTING": False, "SECRET_KEY": None, "JSON_SORT_KEYS": False}
        self.secret_key = None
        self.rules, self.view_functions = [], {}
        self.error_handlers, self.before_funcs, self.after_funcs, self.ctx_processors = {}, [], [], []
        self.filters, self.globals_ = {}, {}
        self.port = 5000
        self._jenv = None
        self.blueprints = {}
        self.debug = False
        _apps.append(self)
        if _current_app is None:
            _current_app = self

    # routing
    def add_url_rule(self, rule, endpoint=None, view_func=None, methods=None, **opts):
        endpoint = endpoint or getattr(view_func, "__name__", "view")
        self.rules.append(Rule(rule, endpoint, methods or getattr(view_func, "methods", None) or ["GET"]))
        if view_func is not None:
            self.view_functions[endpoint] = view_func

    def route(self, rule, **opts):
        def deco(f):
            self.add_url_rule(rule, opts.pop("endpoint", None), f, **opts)
            return f
        return deco

    def get(self, rule, **o):
        return self.route(rule, methods=["GET"], **o)

    def post(self, rule, **o):
        return self.route(rule, methods=["POST"], **o)

    def put(self, rule, **o):
        return self.route(rule, methods=["PUT"], **o)

    def delete(self, rule, **o):
        return self.route(rule, methods=["DELETE"], **o)

    def patch(self, rule, **o):
        return self.route(rule, methods=["PATCH"], **o)

    def errorhandler(self, code_or_exc):
        def deco(f):
            self.error_handlers[code_or_exc] = f
            return f
        return deco

    def register_error_handler(self, code_or_exc, f):
        self.error_handlers[code_or_exc] = f

    def before_request(self, f):
        self.before_funcs.append(f)
        return f

    def after_request(self, f):
        self.after_funcs.append(f)
        return f

    def teardown_request(self, f):
        return f

    teardown_appcontext = teardown_request

    def before_first_request(self, f):
        return f

    def context_processor(self, f):
        self.ctx_processors.append(f)
        return f

    def template_filter(self, name=None):
        def deco(f):
            self.filters[name or f.__name__] = f
            self._jenv = None
            return f
        return deco

    def template_global(self, name=None):
        def deco(f):
            self.globals_[name or f.__name__] = f
            self._jenv = None
            return f
        return deco

    def register_blueprint(self, bp, url_prefix=None, **kw):
        bp._register(self, url_prefix)

    def test_client(self, *a, **k):
        return _TestClient(self)

    def test_request_context(self, path="/", method="GET", **k):
        return _Ctx(Request(method, path, "", "", ""))

    def app_context(self):
        return _Ctx(_req_var.get() or Request("GET", "/", "", "", ""))

    def url_for(self, *a, **k):
        return url_for(*a, **k)

    # templates
    def _env(self):
        if self._jenv is None:
            import jinja2
            loaders = [jinja2.FileSystemLoader(os.path.join(os.getcwd(), self.template_folder or "templates"))]
            self._jenv = jinja2.Environment(
                loader=jinja2.ChoiceLoader(loaders),
                autoescape=jinja2.select_autoescape(("html", "htm", "xml"), default_for_string=True, default=False))
            self._jenv.filters.update(self.filters)
            self._jenv.globals.update(self.globals_)
        else:
            self._jenv.loader.loaders[0].searchpath = [os.path.join(os.getcwd(), self.template_folder or "templates")]
        return self._jenv

    def _template_context(self):
        ctx = {"url_for": url_for, "request": request, "session": session, "g": g, "config": self.config,
               "get_flashed_messages": get_flashed_messages}
        for p in self.ctx_processors:
            ctx.update(p() or {})
        return ctx

    # responses
    def make_response(self, rv):
        status = headers = None
        if isinstance(rv, tuple):
            if len(rv) == 3:
                rv, status, headers = rv
            elif len(rv) == 2:
                rv, x = rv
                if isinstance(x, (dict, list)) and not isinstance(x, int):
                    headers = x
                else:
                    status = x
        if rv is None:
            raise TypeError("The view function did not return a valid response. The function either returned None or ended without a return statement.")
        if isinstance(rv, Response):
            resp = rv
        elif isinstance(rv, (dict, list)):
            resp = jsonify(rv)
        elif isinstance(rv, (str, bytes, bytearray)):
            resp = Response(rv)
        elif hasattr(rv, "__iter__"):
            resp = Response(rv)
        else:
            raise TypeError("The view function return type %s is not supported" % type(rv).__name__)
        if status is not None:
            resp.status_code = int(status) if not isinstance(status, str) else int(status.split()[0])
        if headers:
            for k, v in (headers.items() if isinstance(headers, dict) else headers):
                resp.headers[k] = v
        return resp

    def _find_handler(self, exc):
        code = getattr(exc, "code", None)
        for key, h in self.error_handlers.items():
            if isinstance(key, int):
                if key == code:
                    return h
            elif isinstance(exc, key):
                return h
        return None

    # the request pipeline
    async def _handle(self, req):
        resp = None
        try:
            resp = await self._serve(req)
        except HTTPException as e:
            resp = await self._error(e)
        except Exception as e:  # noqa
            tb = traceback.format_exc()
            sys.stderr.write("Exception on %s [%s]\n%s" % (req.path, req.method, _trim(tb)))
            h = self._find_handler(e)
            if h is not None:
                resp = self.make_response(await _maybe(h(e)))
            else:
                h500 = self._find_handler(InternalServerError())
                if h500 is not None:
                    resp = self.make_response(await _maybe(h500(e)))
                else:
                    body = ("<!doctype html><title>500 Internal Server Error</title><h1>Internal Server Error</h1>"
                            "<pre style='white-space:pre-wrap;font-size:12px'>%s</pre>" % escape(_trim(tb)))
                    resp = Response(body, 500)
        for f in self.after_funcs:
            try:
                resp = (await _maybe(f(resp))) or resp
            except Exception:
                sys.stderr.write(traceback.format_exc())
        print('127.0.0.1 - "%s %s" %d' % (req.method, req.full_path, resp.status_code), file=sys.stdout)
        return resp

    async def _error(self, e):
        if e.response is not None:
            return e.response
        h = self._find_handler(e)
        if h is not None:
            return self.make_response(await _maybe(h(e)))
        return e.get_response()

    async def _serve(self, req):
        # static files
        sp = self.static_url_path.rstrip("/") + "/"
        if self.static_folder and req.path.startswith(sp):
            base = os.path.join(os.getcwd(), self.static_folder)
            return send_from_directory(base, req.path[len(sp):])
        matched, need_slash, allowed = None, False, set()
        for rule in self.rules:
            m = rule.match(req.path)
            if m is None:
                continue
            if req.method in rule.methods:
                matched, need_slash = (rule, m[0]), m[1]
                break
            allowed |= rule.methods
        if matched is None:
            if allowed:
                raise MethodNotAllowed()
            raise NotFound()
        rule, args = matched
        if need_slash:
            return redirect(req.path + "/" + ("?" + req.query_string.decode() if req.query_string else ""), 308)
        req.endpoint, req.view_args = rule.endpoint, args
        req.blueprint = rule.endpoint.split(".")[0] if "." in rule.endpoint else None
        for f in self.before_funcs:
            rv = await _maybe(f())
            if rv is not None:
                return self.make_response(rv)
        view = self.view_functions[rule.endpoint]
        rv = await _maybe(view(**args))
        return self.make_response(rv)

    def run(self, host=None, port=None, debug=None, **kw):
        global _current_app
        self.port = int(port or 5000)
        self.debug = bool(debug)
        _current_app = self
        print(" * Serving Flask app '%s'" % self.import_name)
        print(" * Running on http://127.0.0.1:%d (PyPad preview)" % self.port)
        if js is not None:
            js.PyPad.flaskReady(self.port)

    __call__ = lambda self, *a, **k: None


async def _maybe(v):
    return await v if inspect.isawaitable(v) else v


def _trim(tb):
    keep, skip = [], False
    for line in tb.splitlines():
        if line.startswith("  File ") and "flask.py" in line:
            skip = True
            continue
        if skip and line.startswith("    "):
            continue
        skip = False
        keep.append(line)
    return "\n".join(keep) + "\n"


class Blueprint:
    def __init__(self, name, import_name=None, url_prefix=None, template_folder=None, static_folder=None, **kw):
        self.name, self.url_prefix = name, url_prefix
        self._rules, self._errors, self._before = [], {}, []

    def route(self, rule, **opts):
        def deco(f):
            self._rules.append((rule, opts.pop("endpoint", None) or f.__name__, f, opts.get("methods")))
            return f
        return deco

    def add_url_rule(self, rule, endpoint=None, view_func=None, methods=None, **kw):
        self._rules.append((rule, endpoint or view_func.__name__, view_func, methods))

    def get(self, rule, **o):
        return self.route(rule, methods=["GET"], **o)

    def post(self, rule, **o):
        return self.route(rule, methods=["POST"], **o)

    def errorhandler(self, code):
        def deco(f):
            self._errors[code] = f
            return f
        return deco

    def before_request(self, f):
        self._before.append(f)
        return f

    def _register(self, app, prefix=None):
        pre = (prefix if prefix is not None else self.url_prefix) or ""
        for rule, ep, f, methods in self._rules:
            app.add_url_rule(pre.rstrip("/") + rule if rule != "/" or not pre else pre, self.name + "." + ep, f, methods=methods)
        app.error_handlers.update(self._errors)
        app.before_funcs.extend(self._before)
        app.blueprints[self.name] = self


# ───────────── dispatch (called from the Preview tab) ─────────────
def _is_text(ct):
    ct = (ct or "").lower()
    return ct.startswith("text/") or any(x in ct for x in ("json", "xml", "javascript", "svg", "x-www-form"))


async def _dispatch(method, url, body="", ctype=""):
    app = _current_app
    if app is None:
        return (503, {"content-type": "text/plain"}, "No Flask app is running. Call app.run() in your script.", False)
    sp = urlsplit(url)
    req = Request(method, sp.path or "/", sp.query, body or "", ctype or "")
    tok = _req_var.set(req)
    try:
        resp = await app._handle(req)
    finally:
        _req_var.reset(tok)
    data = resp.get_data()
    ct = resp.headers.get("content-type", "")
    binary = not _is_text(ct)
    return (resp.status_code, dict(resp.headers),
            base64.b64encode(data).decode() if binary else data.decode("utf-8", "replace"), binary)


# ───────────── test client ─────────────
def _run_sync(coro):
    try:
        coro.send(None)
    except StopIteration as e:
        return e.value
    coro.close()
    raise RuntimeError("Async operations inside the sync test client are not supported")


class _TestClient:
    def __init__(self, app):
        self.app = app

    def open(self, path, method="GET", data=None, json=None, query_string=None, headers=None, **kw):
        sp = urlsplit(path)
        query = sp.query
        if query_string:
            query = urlencode(query_string) if isinstance(query_string, dict) else query_string
        ctype, body = "", ""
        if json is not None:
            ctype, body = "application/json", _json.dumps(json)
        elif data is not None:
            ctype, body = "application/x-www-form-urlencoded", urlencode(data) if isinstance(data, dict) else data
        req = Request(method, sp.path, query, body, ctype)
        tok = _req_var.set(req)
        try:
            return _run_sync(self.app._handle(req))
        finally:
            _req_var.reset(tok)

    def get(self, path, **k):
        return self.open(path, "GET", **k)

    def post(self, path, **k):
        return self.open(path, "POST", **k)

    def put(self, path, **k):
        return self.open(path, "PUT", **k)

    def delete(self, path, **k):
        return self.open(path, "DELETE", **k)

    def patch(self, path, **k):
        return self.open(path, "PATCH", **k)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass
