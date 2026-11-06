'use strict';
/* ═════════ Scripts that run INSIDE sandboxed iframes (stringified with Function#toString) ═════════ */

function consoleBoot(RUN) {
  const post = (level, args) => { try { parent.postMessage({ pp: 'console', run: RUN, level, args }, '*'); } catch (e) {} };
  const fmt = (v, d, seen) => {
    d = d || 0; seen = seen || [];
    if (typeof v === 'string') return d ? JSON.stringify(v) : v;
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (typeof v === 'bigint') return v + 'n';
    if (typeof v === 'symbol') return String(v);
    if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
    if (typeof v !== 'object') return String(v);
    if (seen.indexOf(v) >= 0) return '[Circular]';
    if (d > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
    seen = seen.concat([v]);
    if (Array.isArray(v)) {
      const items = v.slice(0, 100).map(x => fmt(x, d + 1, seen));
      return '[' + items.join(', ') + (v.length > 100 ? ', … ' + (v.length - 100) + ' more' : '') + ']';
    }
    if (v instanceof Map) return 'Map(' + v.size + ') {' + Array.from(v).map(p => fmt(p[0], d + 1, seen) + ' => ' + fmt(p[1], d + 1, seen)).join(', ') + '}';
    if (v instanceof Set) return 'Set(' + v.size + ') {' + Array.from(v).map(x => fmt(x, d + 1, seen)).join(', ') + '}';
    if (v instanceof Date) return v.toISOString();
    if (typeof Node !== 'undefined' && v instanceof Node) return '<' + (v.nodeName || 'node').toLowerCase() + '>';
    try { return '{ ' + Object.keys(v).map(k => k + ': ' + fmt(v[k], d + 1, seen)).join(', ') + ' }'; } catch (e) { return String(v); }
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(l => {
    const orig = console[l];
    console[l] = function () { const a = Array.prototype.slice.call(arguments); post(l, a.map(x => fmt(x))); try { orig && orig.apply(console, a); } catch (e) {} };
  });
  console.table = function (d) { post('log', [typeof d === 'object' && d ? JSON.stringify(d, null, 2) : fmt(d)]); };
  console.assert = function (c) { if (!c) post('error', ['Assertion failed: ' + Array.prototype.slice.call(arguments, 1).map(x => fmt(x)).join(' ')]); };
  const ptr = (kind, e) => { if (e.pointerType === 'touch') return; try { parent.postMessage({ pp: 'ptr', kind, x: e.clientX, y: e.clientY }, '*'); } catch (_) {} };
  window.addEventListener('pointermove', e => ptr('move', e), { passive: true });
  window.addEventListener('pointerdown', e => ptr('down', e), true);
  window.addEventListener('pointerup', e => ptr('up', e), true);
  window.addEventListener('error', e => post('error', [(e.message || 'Error') + (e.lineno ? ' (line ' + e.lineno + ')' : '')]));
  window.addEventListener('unhandledrejection', e => post('error', ['Unhandled promise rejection: ' + fmt(e.reason)]));
}

function jsBoot(code, RUN) {
  const URLS = { three: 'three@0.128.0/build/three.min.js', axios: 'axios/dist/axios.min.js', p5: 'p5@1.9.0/lib/p5.min.js', jquery: 'jquery/dist/jquery.min.js', 'chart.js': 'chart.js@4.4.1/dist/chart.umd.js' };
  const GLOBALS = { lodash: '_', mathjs: 'math', 'chart.js': 'Chart', three: 'THREE', jquery: 'jQuery', 'crypto-js': 'CryptoJS', ramda: 'R', 'date-fns': 'dateFns', 'anime.js': 'anime' };
  window.use = async function (spec) {
    const before = new Set(Object.keys(window));
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/' + (URLS[spec] || spec);
      s.onload = res; s.onerror = () => rej(new Error('use(): could not load "' + spec + '" (offline or not a browser-ready package)'));
      document.head.appendChild(s);
    });
    const g = GLOBALS[spec] || Object.keys(window).find(k => !before.has(k));
    return g ? window[g] : undefined;
  };
  (async () => {
    try {
      const AF = Object.getPrototypeOf(async function () {}).constructor;
      await new AF('use', code)(window.use);
      parent.postMessage({ pp: 'done', run: RUN }, '*');
    } catch (e) {
      console.error(e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : String(e));
      parent.postMessage({ pp: 'done', run: RUN, err: true }, '*');
    }
  })();
}

/** Makes a Flask page in the preview behave like a real browser tab talking to a server. */
function flaskBoot() {
  let seq = 0; const pend = {};
  window.addEventListener('message', e => { const d = e.data; if (d && d.pp === 'res' && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } });
  const call = (method, url, body, ctype) => new Promise(r => { const id = ++seq; pend[id] = r; parent.postMessage({ pp: 'req', id, method, url, body, ctype }, '*'); });
  const local = u => { try { const x = new URL(u, document.baseURI); return (x.hostname === 'localhost' || x.hostname === '127.0.0.1') ? x.pathname + x.search : null; } catch (e) { return null; } };

  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    const h = a.getAttribute('href');
    if (/^(javascript:|mailto:|tel:)/i.test(h)) return;
    e.preventDefault();
    if (h.charAt(0) === '#') { const t = document.getElementById(h.slice(1)); t && t.scrollIntoView(); return; }
    const l = local(h);
    if (l === null) parent.postMessage({ pp: 'ext', url: a.href }, '*');
    else parent.postMessage({ pp: 'nav', method: 'GET', url: l }, '*');
  });

  document.addEventListener('submit', e => {
    if (e.defaultPrevented) return;
    const f = e.target; e.preventDefault();
    const sub = e.submitter;
    const method = ((sub && sub.getAttribute('formmethod')) || f.getAttribute('method') || 'get').toUpperCase();
    const action = (sub && sub.getAttribute('formaction')) || f.getAttribute('action') || '';
    let fd; try { fd = new FormData(f, sub); } catch (_) { fd = new FormData(f); }
    const params = new URLSearchParams();
    fd.forEach((v, k) => params.append(k, typeof v === 'string' ? v : v.name));
    const abs = new URL(action, document.baseURI);
    if (local(abs.href) === null) return;
    if (method === 'GET') { const u = new URL(abs.href); u.search = params.toString(); parent.postMessage({ pp: 'nav', method: 'GET', url: u.pathname + u.search }, '*'); }
    else parent.postMessage({ pp: 'nav', method, url: abs.pathname + abs.search, body: params.toString(), ctype: 'application/x-www-form-urlencoded' }, '*');
  });

  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    init = init || {};
    const req = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
    const l = local(req ? req.url : String(input));
    if (l === null) return _fetch(input, init);
    const method = (init.method || (req && req.method) || 'GET').toUpperCase();
    const hdr = new Headers(init.headers || (req && req.headers) || {});
    let ctype = hdr.get('content-type') || '', body = init.body;
    if (body instanceof URLSearchParams) { body = body.toString(); ctype = ctype || 'application/x-www-form-urlencoded'; }
    else if (typeof FormData !== 'undefined' && body instanceof FormData) { const p = new URLSearchParams(); body.forEach((v, k) => p.append(k, String(v))); body = p.toString(); ctype = 'application/x-www-form-urlencoded'; }
    else if (body != null && typeof body !== 'string') body = String(body);
    if (req && body == null && method !== 'GET' && method !== 'HEAD') body = await req.text();
    const r = await call(method, l, body || '', ctype);
    const nullBody = [101, 204, 205, 304].indexOf(r.status) >= 0;
    return new Response(nullBody ? null : r.bytes, { status: r.status, headers: r.headers });
  };
}

/* ═════════ Helpers ═════════ */

const MIME = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', ico: 'image/x-icon', woff2: 'font/woff2' };
const safeJSON = s => JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function wsAsset(baseDir, href) {
  const p = Path.resolve(baseDir, href.split(/[?#]/)[0]);
  const c = WS.files[p];
  if (c == null) return null;
  if (c.startsWith('data:')) return { dataUrl: c };
  return { text: c, dataUrl: 'data:' + (MIME[Path.ext(p)] || 'text/plain') + ';charset=utf-8,' + encodeURIComponent(c) };
}

/** Inline local CSS/JS/images into an HTML string so it can run in a sandboxed srcdoc. */
async function inlineAssets(html, resolve, mutate) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const isLocal = u => u && !/^(https?:|data:|blob:|about:|mailto:|tel:|#|\/\/)/i.test(u);
  const jobs = [];
  doc.querySelectorAll('link[rel~=stylesheet][href]').forEach(l => {
    const h = l.getAttribute('href'); if (!isLocal(h)) return;
    jobs.push(Promise.resolve(resolve(h)).then(r => { if (r && r.text != null) { const s = doc.createElement('style'); s.textContent = r.text; l.replaceWith(s); } }));
  });
  doc.querySelectorAll('script[src]').forEach(sc => {
    const h = sc.getAttribute('src'); if (!isLocal(h)) return;
    jobs.push(Promise.resolve(resolve(h)).then(r => {
      if (r && r.text != null) { const n = doc.createElement('script'); if (sc.type) n.type = sc.type; if (sc.defer) n.defer = true; n.textContent = r.text.replace(/<\/script/gi, '<\\/script'); sc.replaceWith(n); }
    }));
  });
  doc.querySelectorAll('img[src],source[src],video[src],audio[src],link[rel~=icon][href]').forEach(el => {
    const attr = el.hasAttribute('src') ? 'src' : 'href', h = el.getAttribute(attr); if (!isLocal(h)) return;
    jobs.push(Promise.resolve(resolve(h)).then(r => { if (r && r.dataUrl) el.setAttribute(attr, r.dataUrl); }));
  });
  await Promise.all(jobs);
  mutate && mutate(doc);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
function bootTag(doc, code) { const s = doc.createElement('script'); s.textContent = code.replace(/<\/script/gi, '<\\/script'); doc.head.insertBefore(s, doc.head.firstChild); }

/* ═════════ JavaScript runner ═════════ */
const JSRun = {
  frame: null, id: 0,
  stop() { if (this.frame) { this.frame.remove(); this.frame = null; UI.setRunning(false); } },
  run(path) {
    this.stop();
    const id = ++this.id;
    const f = this.frame = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-modals');
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = '<!doctype html><html><body><script>(' + consoleBoot + ')(' + id + ');(' + jsBoot + ')(' + safeJSON(WS.files[path] || '') + ',' + id + ');<\/script></body></html>';
    document.body.appendChild(f);
    UI.setRunning(true, 'js');
  }
};

/* ═════════ Preview (HTML files + Flask) ═════════ */
const PV = {
  frame: null, id: 0, mode: null, path: null, url: '/', port: 5000,
  init() {
    this.frame = $('#pvFrame');
    $('#pvReload').addEventListener('click', () => this.reload());
  },
  _show(html, label) {
    $('#pvEmpty').style.display = 'none'; this.frame.classList.remove('hidden');
    $('#pvUrl').textContent = label; this.frame.srcdoc = html;
  },
  async showHTML(path) {
    this.mode = 'html'; this.path = path; const id = ++this.id;
    const dir = Path.dir(path);
    const html = await inlineAssets(WS.files[path] || '', h => wsAsset(dir, h), doc => bootTag(doc, '(' + consoleBoot + ')(' + id + ')'));
    this._show(html, path);
    Con.info('Preview: ' + path);
  },
  reload() {
    if (this.mode === 'html' && this.path) this.showHTML(this.path);
    else if (this.mode === 'flask') this.nav('GET', this.url);
  },
  async openFlask(port) {
    this.mode = 'flask'; this.port = port || 5000;
    UI.outTab('prev'); UI.showOut();
    await this.nav('GET', '/');
  },
  async nav(method, url, body, ctype, depth) {
    depth = depth || 0; if (depth > 6) return;
    const r = await Flask.dispatch(method, url, body || '', ctype || '');
    const loc = r.headers && r.headers.location;
    if ([301, 302, 303, 307, 308].includes(r.status) && loc) {
      const u = new URL(loc, 'http://localhost:' + this.port + url);
      const keep = r.status === 307 || r.status === 308;
      return this.nav(keep ? method : 'GET', u.pathname + u.search, keep ? body : '', ctype, depth + 1);
    }
    this.url = url;
    const id = ++this.id, ct = (r.headers['content-type'] || 'text/html').toLowerCase();
    const label = 'localhost:' + this.port + url + (r.status >= 400 ? '  · ' + r.status : '');
    const wrap = inner => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px ui-monospace,Menlo,monospace;background:#fff;color:#111;margin:0;padding:14px;white-space:pre-wrap;word-break:break-word}</style></head><body>' + inner + '</body></html>';
    if (ct.includes('html')) {
      const base = 'http://localhost:' + this.port + url.split('?')[0];
      const html = await inlineAssets(r.body, async h => {
        const u = new URL(h, base); if (u.hostname !== 'localhost') return null;
        const a = await Flask.dispatch('GET', u.pathname + u.search, '', '');
        if (a.status !== 200) return null;
        const t = (a.headers['content-type'] || '').split(';')[0];
        return { text: a.b64 ? null : a.body, dataUrl: a.b64 ? 'data:' + t + ';base64,' + a.body : 'data:' + t + ';charset=utf-8,' + encodeURIComponent(a.body) };
      }, doc => {
        const b = doc.createElement('base'); b.href = base; doc.head.insertBefore(b, doc.head.firstChild);
        bootTag(doc, '(' + flaskBoot + ')();(' + consoleBoot + ')(' + id + ')');
      });
      this._show(html, label);
    } else if (ct.includes('json')) {
      let pretty = r.body; try { pretty = JSON.stringify(JSON.parse(r.body), null, 2); } catch (e) {}
      this._show(wrap(esc(pretty)), label);
    } else if (ct.startsWith('image/')) {
      this._show(wrap('<img style="max-width:100%" src="data:' + ct.split(';')[0] + ';base64,' + r.body + '">'), label);
    } else this._show(wrap(esc(r.body)), label);
  }
};

/* ═════════ Flask bridge (calls into pypad flask shim running in Pyodide) ═════════ */
const Flask = {
  async dispatch(method, url, body, ctype) {
    await Py.init();
    const mod = Py.py.pyimport('flask');
    try {
      const r = await mod._dispatch(method, url, body || '', ctype || '');
      const [status, headers, text, b64] = r.toJs({ dict_converter: Object.fromEntries });
      r.destroy && r.destroy();
      return { status, headers, body: text, b64 };
    } finally { mod.destroy(); }
  }
};
PyPad.flaskReady = port => { PV.openFlask(port); };

/* ═════════ Message hub (iframes → IDE) ═════════ */
window.addEventListener('message', async e => {
  const d = e.data; if (!d || !d.pp) return;
  const fromPreview = PV.frame && e.source === PV.frame.contentWindow;
  if (d.pp === 'console') {
    if (!(d.run === JSRun.id && JSRun.frame && e.source === JSRun.frame.contentWindow) && !(fromPreview && d.run === PV.id)) return;
    const kind = { log: 'out', info: 'info', warn: 'warn', error: 'err', debug: 'info' }[d.level] || 'out';
    Con.write(kind, d.args.join(' '));
  } else if (d.pp === 'done') {
    if (d.run === JSRun.id && JSRun.frame && e.source === JSRun.frame.contentWindow) {
      Con.info(d.err ? '— stopped with an error —' : '— done —');
      UI.setRunning(false);
    }
  } else if (fromPreview && (d.pp === 'req' || d.pp === 'nav')) {
    if (d.pp === 'nav') { PV.nav(d.method, d.url, d.body, d.ctype); return; }
    let out;
    try {
      const r = await Flask.dispatch(d.method, d.url, d.body, d.ctype);
      let loc = r.headers.location, st = r.status, depth = 0, res = r;
      while ([301, 302, 303, 307, 308].includes(st) && loc && depth++ < 5) {
        const u = new URL(loc, 'http://localhost:' + PV.port + d.url);
        res = await Flask.dispatch('GET', u.pathname + u.search, '', ''); st = res.status; loc = res.headers.location;
      }
      const bytes = res.b64 ? Uint8Array.from(atob(res.body), c => c.charCodeAt(0)) : res.body;
      out = { pp: 'res', id: d.id, status: res.status, headers: res.headers, bytes };
    } catch (err) { out = { pp: 'res', id: d.id, status: 500, headers: {}, bytes: String(err) }; }
    PV.frame.contentWindow.postMessage(out, '*');
  } else if (fromPreview && d.pp === 'ptr') {
    Cursor.fromFrame(d, PV.frame.getBoundingClientRect());
  } else if (fromPreview && d.pp === 'ext') {
    native('openURL', { url: d.url });
  }
});
