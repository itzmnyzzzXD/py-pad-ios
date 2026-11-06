'use strict';
const PY_VERSION = '0.26.4';
const PY_CDN = 'https://cdn.jsdelivr.net/pyodide/v' + PY_VERSION + '/full/';
const PY_HOME = '/home/pyodide', WS_ROOT = PY_HOME + '/ws', RT_ROOT = PY_HOME + '/_pypad';
const PY_FILES = ['pypad_runtime.py', 'flask.py', 'discord/__init__.py', 'discord/ext/__init__.py', 'discord/ext/commands.py', 'discord/ext/tasks.py', 'discord/utils.py', 'discord/app_commands.py'];

// import-name -> distribution name
const PY_ALIAS = {
  PIL: 'pillow', cv2: 'opencv-python', sklearn: 'scikit-learn', bs4: 'beautifulsoup4', yaml: 'pyyaml', dateutil: 'python-dateutil',
  Crypto: 'pycryptodome', skimage: 'scikit-image', OpenSSL: 'pyopenssl', attr: 'attrs', serial: 'pyserial', docx: 'python-docx', dotenv: 'python-dotenv'
};

/** Packages shown in the Packages tab. "pyodide" ones ship with the runtime; "pypi" ones are pure-Python wheels installed on demand. */
const PKG_CATALOG = [
  { g: 'Data & science', items: [
    ['numpy', 'Arrays and linear algebra'], ['pandas', 'DataFrames'], ['scipy', 'Scientific computing'], ['matplotlib', 'Plots (shown inline)'],
    ['sympy', 'Symbolic math'], ['scikit-learn', 'Machine learning'], ['statsmodels', 'Statistics'], ['networkx', 'Graphs'],
    ['xarray', 'N-D labelled arrays'], ['astropy', 'Astronomy'], ['biopython', 'Bioinformatics'], ['mpmath', 'Arbitrary precision'],
    ['scikit-image', 'Image processing'], ['shapely', 'Geometry'], ['bokeh', 'Interactive charts'], ['nltk', 'Language toolkit']] },
  { g: 'Images & media', items: [['pillow', 'Image library (PIL)'], ['opencv-python', 'Computer vision (cv2)'], ['imageio', 'Read/write images'], ['svgwrite', 'SVG drawing']] },
  { g: 'Web & networking', items: [
    ['requests', 'HTTP client (CORS rules apply)'], ['httpx', 'Modern HTTP client'], ['beautifulsoup4', 'HTML parsing (bs4)'], ['lxml', 'Fast XML/HTML'],
    ['jinja2', 'Templates (used by Flask)'], ['aiohttp', 'Async HTTP'], ['websockets', 'WebSocket client'], ['pyodide-http', 'Patch requests/urllib for the browser']] },
  { g: 'Language & tools', items: [
    ['pyyaml', 'YAML'], ['regex', 'Better regular expressions'], ['pydantic', 'Data validation'], ['sqlalchemy', 'SQL toolkit'], ['attrs', 'Classes without boilerplate'],
    ['click', 'CLIs'], ['rich', 'Pretty terminal output'], ['tqdm', 'Progress bars'], ['tabulate', 'Pretty tables'], ['python-dateutil', 'Date parsing'],
    ['pytz', 'Time zones'], ['openpyxl', 'Excel files'], ['cryptography', 'Crypto primitives'], ['pycryptodome', 'Crypto (Crypto)'], ['jsonschema', 'JSON Schema'],
    ['msgpack', 'MessagePack'], ['toolz', 'Functional helpers'], ['more-itertools', 'Itertools extras'], ['faker', 'Fake data'], ['colorama', 'Terminal colors'], ['emoji', 'Emoji helpers']] },
  { g: 'Built in (this app)', items: [['flask', 'Flask-compatible web framework, runs in Preview'], ['discord', 'discord.py-compatible, runs in the simulator']] }
];

const Py = {
  py: null, ready: false, loading: null, running: false, syncedVer: -1, mt: {},

  async init() {
    if (this.ready) return;
    if (!this.loading) this.loading = this._init().catch(e => { this.loading = null; throw e; });
    return this.loading;
  },

  async _init() {
    Con.sys('Starting Python… (first launch downloads the runtime, later launches are cached)');
    let base = PY_CDN;
    try { const r = await fetch('vendor/pyodide/pyodide.js', { method: 'HEAD' }); if (r.ok) base = new URL('vendor/pyodide/', document.baseURI).href; } catch (e) {}
    await loadScript(base + 'pyodide.js');
    const py = this.py = await loadPyodide({ indexURL: base, stdout: s => Con.out(s), stderr: s => Con.err(s) });
    py.setStdin({ stdin: () => null });
    try { await py.loadPackage(['micropip', 'pyodide-http'], { messageCallback: () => {}, errorCallback: () => {} }); } catch (e) { Con.warn('micropip unavailable: ' + e.message); }
    py.FS.mkdirTree(RT_ROOT + '/discord/ext'); py.FS.mkdirTree(WS_ROOT);
    for (const f of PY_FILES) {
      const r = await fetch('py/' + f); if (!r.ok) throw new Error('Missing runtime file ' + f);
      py.FS.writeFile(RT_ROOT + '/' + f, await r.text());
    }
    py.runPython('import sys\nsys.path.insert(0, ' + JSON.stringify(RT_ROOT) + ')\nimport pypad_runtime');
    this.ready = true;
    Con.ok('Python ' + py.runPython('import platform; platform.python_version()') + ' ready');
  },

  /* ── filesystem sync between the workspace and Pyodide's in-memory FS ── */
  _rmTree(dir) {
    const FS = this.py.FS;
    for (const n of FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const p = dir + '/' + n, m = FS.stat(p).mode;
      if (FS.isDir(m)) { this._rmTree(p); FS.rmdir(p); } else FS.unlink(p);
    }
  },
  syncIn(force) {
    if (!force && this.syncedVer === WS.ver) return;
    const FS = this.py.FS;
    this.mt = {};
    this._rmTree(WS_ROOT);
    WS.dirs.forEach(d => FS.mkdirTree(WS_ROOT + '/' + d));
    for (const [p, c] of Object.entries(WS.files)) {
      const full = WS_ROOT + '/' + p;
      FS.mkdirTree(Path.dir(full));
      if (c.startsWith('data:')) {
        const b64 = c.slice(c.indexOf(',') + 1);
        FS.writeFile(full, Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)));
      } else FS.writeFile(full, c);
      this.mt[p] = +FS.stat(full).mtime;
    }
    this.syncedVer = WS.ver;
  },
  _walk(dir, out) {
    const FS = this.py.FS;
    for (const n of FS.readdir(dir)) {
      if (n === '.' || n === '..' || n === '__pycache__') continue;
      const p = dir + '/' + n, st = FS.stat(p);
      if (FS.isDir(st.mode)) { out.dirs.push(p); this._walk(p, out); } else out.files.push([p, st.size, +st.mtime]);
    }
  },
  syncOut() {
    const FS = this.py.FS, out = { files: [], dirs: [] };
    this._walk(WS_ROOT, out);
    let changed = false; const seen = new Set();
    for (const [full, size, mtime] of out.files) {
      const rel = full.slice(WS_ROOT.length + 1); seen.add(rel);
      if (size > 3e6 || this.mt[rel] === mtime) continue;
      this.mt[rel] = mtime;
      const bytes = FS.readFile(full);
      let text = null;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {}
      const val = text !== null ? text : 'data:' + (MIME[Path.ext(rel)] || 'application/octet-stream') + ';base64,' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
      if (WS.files[rel] !== val) { WS.files[rel] = val; WS._addParents(rel); WS._send({ op: 'write', path: rel, content: val }); changed = true; }
    }
    for (const d of out.dirs) { const rel = d.slice(WS_ROOT.length + 1); if (!WS.dirs.has(rel)) { WS.dirs.add(rel); WS._send({ op: 'mkdir', path: rel }); changed = true; } }
    for (const p of Object.keys(WS.files)) if (!seen.has(p) && !WS.pending.has(p)) { delete WS.files[p]; WS._send({ op: 'delete', path: p }); changed = true; }
    this.syncedVer = WS.ver;
    if (changed) { WS.emit(); this.syncedVer = WS.ver; Ed.prune(); }
  },

  /* ── packages ── */
  isLoaded(dist) {
    const norm = s => s.toLowerCase().replace(/[-_.]+/g, '-');
    if (dist === 'flask' || dist === 'discord') return true;
    if (!this.py) return false;
    return Object.keys(this.py.loadedPackages).some(k => norm(k) === norm(dist));
  },
  async install(spec, auto) {
    await this.init();
    const dist = PY_ALIAS[spec] || spec;
    if (this.isLoaded(dist)) return true;
    if (dist === 'flask' || dist === 'discord') return true;
    Con.info((auto ? 'Auto-installing ' : 'Installing ') + dist + '…');
    try { await this.py.loadPackage(dist, { messageCallback: () => {}, errorCallback: () => {} }); } catch (e) {}
    if (this.isLoaded(dist)) { Con.ok('✓ ' + dist + ' (bundled build)'); UI.refreshPkgs && UI.refreshPkgs(); return true; }
    try {
      await this.py.runPythonAsync('import micropip\nawait micropip.install(' + JSON.stringify(dist) + ')');
      Con.ok('✓ ' + dist + ' (from PyPI)'); this.pipInstalled = (this.pipInstalled || new Set()).add(dist); UI.refreshPkgs && UI.refreshPkgs(); return true;
    } catch (e) {
      const m = String(e.message || e).trim().split('\n').pop();
      Con.err('Could not install "' + dist + '": ' + m);
      Con.info('Only pure-Python packages (and the ones built for Pyodide) work on iOS.');
      return false;
    }
  },
  async uninstall(name) {
    await this.init();
    try { await this.py.runPythonAsync('import micropip\nmicropip.uninstall(' + JSON.stringify(name) + ')'); Con.ok('Removed ' + name); }
    catch (e) { Con.err(String(e.message || e).split('\n').pop()); }
  },
  async listInstalled() {
    await this.init();
    return Object.keys(this.py.loadedPackages).sort();
  },
  async preload(code) {
    const py = this.py;
    if (/\bflask\b/.test(code)) await py.loadPackage('jinja2', { messageCallback: () => {}, errorCallback: () => {} });
    await py.loadPackagesFromImports(code, { messageCallback: m => Con.info(m), errorCallback: m => Con.err(m) });
  },

  /* ── running a file ── */
  async run(path) {
    if (this.running) { toast('Python is still busy'); return; }
    this.running = true; UI.setRunning(true, 'py');
    try {
      await this.init();
      const code = WS.files[path] || '';
      await this.preload(code);
      this.syncIn(true);
      const rt = this.py.pyimport('pypad_runtime');
      const dir = Path.dir(path);
      rt.prepare(WS_ROOT, dir ? WS_ROOT + '/' + dir : WS_ROOT);
      for (let attempt = 0; attempt < 8; attempt++) {
        const status = await rt.run_code(code, WS_ROOT + '/' + path);
        if (typeof status === 'string' && status.startsWith('missing:')) {
          const mod = status.slice(8);
          if (Prefs.get('autoInstall') && await this.install(mod, true)) continue;
          Con.err(rt.last_error());
        }
        break;
      }
      rt.flush();
      const imgs = rt.collect_images().toJs(); imgs.forEach(b => Con.image('data:image/png;base64,' + b));
      rt.destroy();
      this.syncOut();
    } catch (e) {
      Con.err(String(e && e.message || e).split('\n').slice(-6).join('\n'));
    } finally { this.running = false; UI.setRunning(false); }
  }
};
