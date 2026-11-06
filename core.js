'use strict';
/* ───────────── Utilities ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const NATIVE = window.webkit && window.webkit.messageHandlers;
const IS_TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

const Path = {
  dir: p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
  base: p => p.slice(p.lastIndexOf('/') + 1),
  ext: p => { const b = Path.base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; },
  join: (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/'),
  norm(p) {
    const out = [];
    for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return out.join('/');
  },
  resolve: (from, rel) => Path.norm(rel.startsWith('/') ? rel : Path.join(from, rel))
};

function native(cmd, extra) { try { NATIVE && NATIVE.native.postMessage(Object.assign({ cmd }, extra || {})); } catch (e) {} }
const haptic = (style = 'light') => native('haptic', { style });

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}
function loadCSS(href) {
  return new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = res; l.onerror = () => rej(new Error('load ' + href));
    document.head.appendChild(l);
  });
}
/** Try each URL in order (local vendored copy first, CDN second). */
async function loadAny(urls, loader = loadScript) {
  let err;
  for (const u of urls) { try { await loader(u); return u; } catch (e) { err = e; } }
  throw err;
}

/* ───────────── Preferences ───────────── */
const Prefs = {
  key: 'pypad.prefs.v1',
  data: {
    theme: 'ink', fontSize: IS_TOUCH && innerWidth < 760 ? 14 : 15, tabSize: 4, wrap: false, lineNumbers: true,
    autoInstall: true, keepOutput: false,
    cursor: { enabled: true, style: 'ring', size: 28, color: 'accent', smooth: 0.28, hideSystem: true }
  },
  subs: [],
  load() {
    try { const s = JSON.parse(localStorage.getItem(this.key) || '{}'); this.data = { ...this.data, ...s, cursor: { ...this.data.cursor, ...(s.cursor || {}) } }; } catch (e) {}
  },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; this.save(); },
  setCursor(k, v) { this.data.cursor[k] = v; this.save(); },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} this.subs.forEach(f => f(this.data)); },
  on(f) { this.subs.push(f); }
};
Prefs.load();

/* ───────────── Workspace (files persisted natively in Documents/Workspace) ───────────── */
const WS = {
  files: {},            // path -> content (text, or data: URL for binary)
  dirs: new Set(),
  pending: new Map(),   // path -> timer
  ver: 0,               // bumps on every change (Python re-syncs its filesystem when it moves)
  listeners: [],
  onChange(f) { this.listeners.push(f); },
  emit() { this.ver++; this.listeners.forEach(f => f()); },
  isBinary: p => (WS.files[p] || '').startsWith('data:'),

  async load() {
    if (NATIVE && NATIVE.fs) {
      const r = await NATIVE.fs.postMessage({ op: 'readAll' });
      this.files = r.files || {}; this.dirs = new Set(r.dirs || []);
    } else {
      try { const r = JSON.parse(localStorage.getItem('pypad.ws') || '{}'); this.files = r.files || {}; this.dirs = new Set(r.dirs || []); } catch (e) {}
    }
    Object.keys(this.files).forEach(p => this._addParents(p));
  },
  _persistLocal() { try { localStorage.setItem('pypad.ws', JSON.stringify({ files: this.files, dirs: [...this.dirs] })); } catch (e) { toast('Storage full'); } },
  async _send(msg) {
    if (NATIVE && NATIVE.fs) { try { return await NATIVE.fs.postMessage(msg); } catch (e) { toast('File error: ' + e); } }
    else this._persistLocal();
  },
  _addParents(p) { let d = Path.dir(p); while (d) { this.dirs.add(d); d = Path.dir(d); } },

  exists: p => p in WS.files || WS.dirs.has(p),
  uniquePath(p) {
    if (!this.exists(p)) return p;
    const d = Path.dir(p), b = Path.base(p), i = b.lastIndexOf('.');
    const stem = i > 0 ? b.slice(0, i) : b, ext = i > 0 ? b.slice(i) : '';
    for (let n = 2; ; n++) { const c = Path.join(d, `${stem}-${n}${ext}`); if (!this.exists(c)) return c; }
  },

  /** Called on every keystroke: update memory now, persist after a short pause. */
  touch(path, content) {
    this.files[path] = content; this.ver++;
    clearTimeout(this.pending.get(path));
    this.pending.set(path, setTimeout(() => this.flushOne(path), 450));
  },
  async flushOne(path) {
    clearTimeout(this.pending.get(path)); this.pending.delete(path);
    if (path in this.files) await this._send({ op: 'write', path, content: this.files[path] });
  },
  async flush() { await Promise.all([...this.pending.keys()].map(p => this.flushOne(p))); },

  async create(path, content = '') {
    this.files[path] = content; this._addParents(path);
    await this._send({ op: 'write', path, content }); this.emit(); return path;
  },
  async mkdir(path) { this.dirs.add(path); this._addParents(path); await this._send({ op: 'mkdir', path }); this.emit(); },
  async remove(path) {
    const pre = path + '/';
    for (const p of Object.keys(this.files)) if (p === path || p.startsWith(pre)) delete this.files[p];
    for (const d of [...this.dirs]) if (d === path || d.startsWith(pre)) this.dirs.delete(d);
    await this._send({ op: 'delete', path }); this.emit();
  },
  async rename(from, to) {
    const pre = from + '/', map = {};
    for (const p of Object.keys(this.files)) {
      if (p === from) map[p] = to; else if (p.startsWith(pre)) map[p] = to + '/' + p.slice(pre.length);
    }
    for (const [a, b] of Object.entries(map)) { this.files[b] = this.files[a]; delete this.files[a]; }
    for (const d of [...this.dirs]) if (d === from || d.startsWith(pre)) { this.dirs.delete(d); this.dirs.add(to + d.slice(from.length)); }
    this._addParents(to);
    await this._send({ op: 'rename', from, to }); this.emit(); return map;
  },
  async importFiles(dir = '') {
    if (NATIVE && NATIVE.fs) {
      const added = await NATIVE.fs.postMessage({ op: 'import', dir });
      await this.load(); this.emit(); return added;
    }
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
      inp.onchange = async () => {
        const out = [];
        for (const f of inp.files) {
          const isText = /^text\/|json|javascript|xml/.test(f.type) || /\.(py|js|md|txt|html|css|json|csv|yaml|yml|toml|ini|cfg)$/i.test(f.name);
          const content = isText ? await f.text() : await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
          await this.create(Path.join(dir, f.name), content); out.push(f.name);
        }
        res(out);
      };
      inp.click();
    });
  },
  children(dir) {
    const files = [], dirs = [];
    for (const p of Object.keys(this.files)) if (Path.dir(p) === dir) files.push(p);
    for (const d of this.dirs) if (Path.dir(d) === dir) dirs.push(d);
    const cmp = (a, b) => Path.base(a).localeCompare(Path.base(b), undefined, { numeric: true });
    return { files: files.sort(cmp), dirs: dirs.sort(cmp) };
  }
};
window.addEventListener('pagehide', () => WS.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) WS.flush(); });

/* ───────────── Modals ───────────── */
const Modal = {
  open(html, { onMount, dismiss = true } = {}) {
    return new Promise(resolve => {
      const back = document.createElement('div'); back.className = 'back';
      back.innerHTML = `<div class="sheet">${html}</div>`;
      const close = v => { back.remove(); resolve(v); };
      if (dismiss) back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
      $('#modalRoot').appendChild(back);
      back.close = close;
      onMount && onMount(back.firstElementChild, close);
    });
  },
  prompt(title, value = '', placeholder = '') {
    return this.open(`<h3>${esc(title)}</h3><input type="text" id="mp" value="${esc(value)}" placeholder="${esc(placeholder)}" autocapitalize="none" autocorrect="off" spellcheck="false">
      <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">OK</button></div>`, {
      onMount: (el, close) => {
        const inp = $('#mp', el); setTimeout(() => { inp.focus(); inp.select(); }, 60);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value.trim() || null); });
        el.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) close(a.dataset.a === 'ok' ? (inp.value.trim() || null) : null); });
      }
    });
  },
  confirm(title, body = '', danger = true, okLabel = 'Delete') {
    return this.open(`<h3>${esc(title)}</h3><div style="color:var(--dim)">${esc(body)}</div>
      <div class="actions"><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okLabel)}</button></div>`, {
      onMount: (el, close) => el.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) close(a.dataset.a === 'ok'); })
    }).then(v => !!v);
  },
  menu(title, items) {
    const h = items.map((it, i) => `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${icon(it.icon || 'file')}<span>${esc(it.label)}</span></button>`).join('');
    return this.open(`<h3>${esc(title)}</h3>${h}`, {
      onMount: (el, close) => el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { close(null); items[+b.dataset.i].run(); } })
    });
  }
};

/* ───────────── Terminal output ───────────── */
const Con = {
  el: null, max: 1500,
  init() { this.el = $('#termOut'); },
  write(kind, text) {
    const d = document.createElement('div'); d.className = 'ln ' + kind; d.textContent = text;
    this._push(d);
  },
  _push(d) {
    const near = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 80;
    this.el.appendChild(d);
    while (this.el.childElementCount > this.max) this.el.firstChild.remove();
    if (near) this.el.scrollTop = this.el.scrollHeight;
    UI.badge('term');
  },
  out(t) { this.write('out', t); }, err(t) { this.write('err', t); }, info(t) { this.write('info', t); },
  ok(t) { this.write('ok', t); }, warn(t) { this.write('warn', t); }, sys(t) { this.write('sys', t); }, cmd(t) { this.write('cmd', t); },
  image(src) { const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = `<img alt="figure" src="${src}">`; this._push(d); },
  clear() { this.el.innerHTML = ''; }
};

const PyPad = window.PyPad = {};   // hooks called from Python shims
