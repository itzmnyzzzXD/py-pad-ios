'use strict';
const STARTERS = {
  py: '# New Python file\nprint("Hello from PyPad")\n', js: '// New JavaScript file\nconsole.log("Hello from PyPad");\n',
  html: '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>New page</title>\n</head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>\n',
  css: 'body {\n  font-family: system-ui, sans-serif;\n}\n', md: '# Notes\n', json: '{\n  \n}\n'
};
const JS_LIBS = [['lodash', 'Utility belt'], ['axios', 'HTTP client'], ['dayjs', 'Dates'], ['d3', 'Data viz'], ['mathjs', 'Math'], ['chart.js', 'Charts'],
  ['three', 'WebGL 3D'], ['p5', 'Creative coding'], ['moment', 'Dates (classic)'], ['marked', 'Markdown'], ['uuid', 'IDs'], ['ramda', 'Functional'], ['rxjs', 'Reactive'], ['crypto-js', 'Hashing'], ['jquery', 'jQuery']];

const UI = {
  app: null, sbTab: 'files', collapsed: new Set(), phone: () => matchMedia('(max-width:760px)').matches,

  init() {
    this.app = $('#app');
    this.app.dataset.sb = innerWidth >= 900 ? 'open' : 'closed';
    this.app.dataset.view = 'code';
    $('#work').dataset.screen = 'home';
    // header
    $('#btnMenu').addEventListener('click', () => this.toggleSidebar());
    $('#btnHome').addEventListener('click', () => this.showHome());
    $('#homeScreen').addEventListener('click', e => {
      const b = e.target.closest('[data-home],[data-template]'); if (!b) return;
      if (b.dataset.template) this.useTemplate(b.dataset.template);
      else if (b.dataset.home === 'new') this.newFile('');
      else if (b.dataset.home === 'templates') { this.toggleSidebar(true); this.sbSwitch('tpl'); }
      else if (b.dataset.home === 'import') this.importFiles('');
      else if (b.dataset.home === 'files') { this.toggleSidebar(true); this.sbSwitch('files'); }
      else if (b.dataset.home === 'extensions') { this.toggleSidebar(true); this.sbSwitch('ext'); }
    });
    $('#scrim').addEventListener('click', () => this.toggleSidebar(false));
    $('#btnPanel').addEventListener('click', () => this.toggleOut());
    $('#btnSettings').addEventListener('click', () => this.settings());
    $('#btnRun').addEventListener('click', () => this.runClick());
    $('#btnClear').addEventListener('click', () => { Con.clear(); });
    // sidebar
    $('#sbTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.sbSwitch(b.dataset.sb); });
    $('#sbBody').addEventListener('click', e => this.sbClick(e));
    $('#sbBody').addEventListener('contextmenu', e => { const r = e.target.closest('.row'); if (r) { e.preventDefault(); this.rowMenu(r.dataset.p, r.classList.contains('dir')); } });
    $('#sbBody').addEventListener('input', e => { if (e.target.id === 'pkgSearch') this.renderPkgs(); });
    // out tabs + bottom nav
    $('#outTabs').addEventListener('click', e => { const b = e.target.closest('button[data-out]'); if (b) this.outTab(b.dataset.out); });
    $('#bnav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.setView(b.dataset.view); });
    // empty state in editor
    const em = document.createElement('div'); em.id = 'edEmpty'; em.className = 'empty'; em.style.cssText = 'background:var(--bg)';
    em.innerHTML = '<b>No file open</b><span>Pick a file from the sidebar or start from a template.</span><div style="display:flex;gap:8px;margin-top:10px;pointer-events:auto"><button class="chip" data-a="new">' + icon('plus') + 'New file</button><button class="chip" data-a="tpl">' + icon('layers') + 'Templates</button></div>';
    em.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'new') this.newFile(''); else { this.setView('files'); this.toggleSidebar(true); this.sbSwitch('tpl'); } });
    $('#editorPane').appendChild(em);
    WS.onChange(() => { this.renderFiles(); this.refreshPkgs(); });
    this.gutter();
    this.shortcuts();
    this.sbSwitch('files');
    this.outTab('term');
    this.setView(this.phone() ? 'files' : 'code');
    addEventListener('resize', () => Ed.refresh());
    addEventListener('orientationchange', () => setTimeout(() => Ed.refresh(), 200));
  },

  updateEmpty() { const e = $('#edEmpty'); if (e) e.style.display = Ed.tabs.length ? 'none' : 'flex'; },

  /* ───── layout ───── */
  setScreen(screen) {
    $('#work').dataset.screen = screen;
    if (screen === 'home') this.renderHome();
    setTimeout(() => Ed.refresh(), 30);
  },
  showHome() { this.setScreen('home'); },
  renderHome() {
    const recent = [], last = localStorage.getItem('pypad.last');
    if (last && last in WS.files && !WS.isBinary(last)) recent.push(last);
    for (const p of Object.keys(WS.files).reverse()) {
      if (recent.includes(p) || WS.isBinary(p) || !/^(py|js|mjs|html|htm|css|md|json|csv)$/i.test(Path.ext(p))) continue;
      recent.push(p); if (recent.length >= 6) break;
    }
    const host = $('#homeRecent');
    host.innerHTML = recent.length ? recent.map(p => {
      const ext = Path.ext(p).toUpperCase() || 'FILE';
      return `<button class="recent-file" data-recent="${esc(p)}"><span class="recent-ext ${esc(Path.ext(p))}">${esc(ext.slice(0,4))}</span><span class="recent-name"><b>${esc(Path.base(p))}</b><small>${esc(Path.dir(p) || 'Workspace')}</small></span><span class="recent-open">Open ↗</span></button>`;
    }).join('') : '<div class="home-empty"><b>Your workspace is ready.</b><span>Create a Python file or start from a project template.</span></div>';
    host.querySelectorAll('[data-recent]').forEach(b => b.addEventListener('click', () => this.openFile(b.dataset.recent)));
  },

  /* ───── layout ───── */
  setView(v) {
    this.app.dataset.view = v;
    $$('#bnav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    setTimeout(() => Ed.refresh(), 30);
  },
  toggleSidebar(force) {
    if (this.phone()) { this.setView('files'); return; }
    const open = force !== undefined ? force : this.app.dataset.sb !== 'open';
    this.app.dataset.sb = open ? 'open' : 'closed';
    setTimeout(() => Ed.refresh(), 30);
  },
  toggleOut(force) {
    const show = force !== undefined ? force : this.app.dataset.out === 'hidden';
    this.app.dataset.out = show ? 'show' : 'hidden';
    setTimeout(() => Ed.refresh(), 30);
  },
  showOut(tab) {
    this.app.dataset.out = 'show';
    if (this.phone()) this.setView('out');
    if (tab) this.outTab(tab);
  },
  outTab(name) {
    $$('#outTabs button[data-out]').forEach(b => { const on = b.dataset.out === name; b.classList.toggle('on', on); if (on) { const bd = $('.badge', b); bd && bd.remove(); } });
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + name));
    this.curOut = name;
    if (name === 'term') setTimeout(() => { Con.el.scrollTop = Con.el.scrollHeight; }, 0);
  },
  badge(name) {
    if (this.curOut === name && this.app.dataset.view !== 'code') return;
    if (this.curOut === name) return;
    const b = $('#outTabs button[data-out="' + name + '"]');
    if (b && !$('.badge', b)) { const s = document.createElement('i'); s.className = 'badge'; b.appendChild(s); }
  },
  setRunning(on, kind) {
    const b = $('#btnRun');
    b.classList.remove('busy', 'stop');
    if (on && kind === 'js') { b.classList.add('stop'); b.innerHTML = icon('stop') + '<span>Stop</span>'; }
    else if (on) { b.classList.add('busy'); b.innerHTML = icon('play') + '<span>Running</span>'; }
    else b.innerHTML = icon('play') + '<span>Run</span>';
  },
  runClick() { if (JSRun.frame && $('#btnRun').classList.contains('stop')) JSRun.stop(); else Run.current(); },

  gutter() {
    const g = $('#gutter'), split = $('#split');
    g.addEventListener('pointerdown', e => {
      g.setPointerCapture(e.pointerId);
      const move = ev => {
        const r = split.getBoundingClientRect(), row = getComputedStyle(split).flexDirection === 'row';
        const pct = row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        split.style.setProperty('--split', Math.max(20, Math.min(80, pct * 100)) + '%');
        Ed.refresh();
      };
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
    });
  },

  shortcuts() {
    addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey; if (!mod) return;
      const k = e.key.toLowerCase();
      const act = {
        enter: () => this.runClick(), r: () => Run.current(), s: async () => { await WS.flush(); toast('Saved'); },
        n: () => this.newFile(''), b: () => this.toggleSidebar(), j: () => this.toggleOut(), ',': () => this.settings(),
        k: () => Con.clear(), w: () => Ed.active && Ed.close(Ed.active), '`': () => { this.showOut('term'); $('#termIn').focus(); }
      }[k];
      if (act) { e.preventDefault(); act(); }
    });
  },

  /* ───── sidebar ───── */
  sbSwitch(name) {
    this.sbTab = name;
    $('#sbTabs button').forEach(b => b.classList.toggle('on', b.dataset.sb === name));
    if (name === 'files') this.renderFiles(); else if (name === 'pkgs') this.renderPkgs(); else if (name === 'ext') this.renderExtensions(); else this.renderTpl();
  },
  sbClick(e) {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'new') this.newFile(''); else if (a === 'dir') this.newFolder(''); else if (a === 'import') this.importFiles('');
      else if (a === 'zip') this.exportZip();
      else if (a === 'install') this.pkgInstall(act.dataset.pkg, act);
      else if (a === 'pipgo') { const v = $('#pipName').value.trim(); if (v) this.pkgInstall(v.split(/[<>=!~ ]/)[0], act); }
      else if (a === 'tpl') this.useTemplate(act.dataset.id);
      else if (a === 'ext-toggle') { ExtensionManager.toggle(act.dataset.id); this.renderExtensions(); }
      return;
    }
    const more = t.closest('.more');
    const row = t.closest('.row');
    if (more && row) { e.stopPropagation(); this.rowMenu(row.dataset.p, row.classList.contains('dir')); return; }
    if (row) {
      const p = row.dataset.p;
      if (row.classList.contains('dir')) { this.collapsed.has(p) ? this.collapsed.delete(p) : this.collapsed.add(p); this.renderFiles(); }
      else this.openFile(p);
    }
  },

  renderFiles() {
    if (this.sbTab !== 'files') return;
    const body = $('#sbBody');
    const rows = [];
    const walk = (dir, depth) => {
      const c = WS.children(dir);
      for (const d of c.dirs) {
        const open = !this.collapsed.has(d);
        rows.push(`<div class="row dir" data-p="${esc(d)}" style="--d:${depth}">${icon('chev').replace('class="i"', 'class="i chev ' + (open ? 'open' : '') + '"')}${icon('folder')}<span class="nm">${esc(Path.base(d))}</span><button class="ib sm more">${icon('more')}</button></div>`);
        if (open) walk(d, depth + 1);
      }
      for (const f of c.files) {
        const ext = Path.ext(f);
        rows.push(`<div class="row ${f === Ed.active ? 'on' : ''}" data-p="${esc(f)}" style="--d:${depth}"><span class="fx ${ext}">${esc((ext || 'txt').slice(0, 4).toUpperCase())}</span><span class="nm">${esc(Path.base(f))}</span><button class="ib sm more">${icon('more')}</button></div>`);
      }
    };
    walk('', 0);
    const scroll = body.scrollTop;
    body.innerHTML = `<div class="sb-actions"><button class="chip" data-act="new">${icon('plus')}File</button><button class="chip" data-act="dir">${icon('folder')}Folder</button><button class="chip" data-act="import">${icon('upload')}Import</button><button class="chip" data-act="zip" title="Export all as zip">${icon('download')}Zip</button></div>
      <div class="tree">${rows.join('') || '<div class="hint">Empty workspace. Create a file or use a template.</div>'}</div>
      <div class="hint" style="margin-top:14px">Files live in the Files app → On My iPad/iPhone → PyPad → Workspace.</div>`;
    body.scrollTop = scroll;
  },

  openFile(p) {
    if (WS.isBinary(p)) {
      const c = WS.files[p];
      if (c.startsWith('data:image/')) Modal.open(`<h3>${esc(Path.base(p))}</h3><img src="${c}" style="max-width:100%;border-radius:12px;background:repeating-conic-gradient(#222 0 25%,#333 0 50%) 0 0/16px 16px"><div class="actions"><button class="btn" data-a="x">Close</button></div>`, { onMount: (el, close) => el.addEventListener('click', e => e.target.closest('[data-a]') && close()) });
      else toast('Binary file: cannot edit');
      return;
    }
    this.setScreen('editor');
    Ed.open(p);
    this.renderFiles();
    if (this.phone()) this.setView('code'); else if (innerWidth < 900) this.toggleSidebar(false);
    if (!IS_TOUCH) Ed.focus();
  },

  rowMenu(p, isDir) {
    const items = [];
    if (isDir) {
      items.push({ label: 'New file here', icon: 'plus', run: () => this.newFile(p) }, { label: 'New folder here', icon: 'folder', run: () => this.newFolder(p) }, { label: 'Import here', icon: 'upload', run: () => this.importFiles(p) });
    } else {
      items.push({ label: 'Open', icon: 'file', run: () => this.openFile(p) });
      if (['py', 'js', 'html', 'htm', 'css'].includes(Path.ext(p))) items.push({ label: 'Run', icon: 'play', run: () => { this.openFile(p); Run.file(p); } });
      items.push({ label: 'Duplicate', icon: 'copy', run: async () => { const n = WS.uniquePath(p); await WS.create(n, WS.files[p]); } },
        { label: 'Share / export', icon: 'download', run: () => this.shareFile(p) });
    }
    items.push({ label: 'Rename', icon: 'edit', run: () => this.rename(p) }, { label: 'Delete', icon: 'trash', danger: true, run: () => this.del(p, isDir) });
    Modal.menu(Path.base(p), items);
  },

  async newFile(dir) {
    const name = await Modal.prompt('New file', 'untitled.py', 'name.ext'); if (!name) return;
    const p = WS.uniquePath(Path.join(dir, name));
    await WS.create(p, STARTERS[Path.ext(p)] || '');
    this.openFile(p);
  },
  async newFolder(dir) {
    const name = await Modal.prompt('New folder', '', 'folder name'); if (!name) return;
    await WS.mkdir(WS.uniquePath(Path.join(dir, name)));
  },
  async importFiles(dir) {
    try { const a = await WS.importFiles(dir); if (a && a.length) toast('Imported ' + a.length + ' file' + (a.length > 1 ? 's' : '')); } catch (e) { toast('Import failed'); }
  },
  async rename(p) {
    const n = await Modal.prompt('Rename', Path.base(p)); if (!n || n === Path.base(p)) return;
    const to = Path.join(Path.dir(p), n);
    if (WS.exists(to)) { toast('That name already exists'); return; }
    const map = await WS.rename(p, to); Ed.remap(map);
  },
  async del(p, isDir) {
    if (!await Modal.confirm('Delete ' + Path.base(p) + '?', isDir ? 'The folder and everything in it will be removed.' : 'This cannot be undone.')) return;
    await WS.remove(p); Ed.prune(); Ed.updateEmpty && Ed.renderTabs();
  },
  shareFile(p) {
    if (NATIVE) native('share', { name: Path.base(p), text: WS.files[p] });
    else { const a = document.createElement('a'); a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(WS.files[p]); a.download = Path.base(p); a.click(); }
  },
  exportZip() { if (NATIVE) native('exportZip'); else toast('Zip export is available in the iOS app'); },

  /* ───── packages ───── */
  refreshPkgs() { if (this.sbTab === 'pkgs') this.renderPkgs(); },
  renderPkgs() {
    const body = $('#sbBody'), q = ($('#pkgSearch') ? $('#pkgSearch').value : this._q || '').toLowerCase();
    this._q = q;
    const row = ([n, d]) => {
      const ok = Py.isLoaded(n);
      return `<div class="pkg"><div class="t"><b>${esc(n)}</b><span>${esc(d)}</span></div>${ok ? '<button class="ok" disabled>Ready</button>' : `<button data-act="install" data-pkg="${esc(n)}">Install</button>`}</div>`;
    };
    let html = `<input class="search" id="pkgSearch" placeholder="Search packages" value="${esc(q)}" autocapitalize="none" autocorrect="off" spellcheck="false">
      <div class="hint">Python packages run on Pyodide. Missing imports are installed automatically when you press Run.</div>`;
    for (const g of PKG_CATALOG) {
      const items = g.items.filter(([n, d]) => !q || n.includes(q) || d.toLowerCase().includes(q));
      if (items.length) html += `<div class="grp">${esc(g.g.toUpperCase())}</div>` + items.map(row).join('');
    }
    const libs = JS_LIBS.filter(([n, d]) => !q || n.includes(q) || d.toLowerCase().includes(q));
    if (libs.length) html += `<div class="grp">JAVASCRIPT (load with <code>await use("name")</code>)</div>` + libs.map(([n, d]) => `<div class="pkg"><div class="t"><b>${esc(n)}</b><span>${esc(d)}</span></div><code>use("${esc(n)}")</code></div>`).join('');
    html += `<div class="grp">ANY PURE-PYTHON PACKAGE FROM PYPI</div><div class="pkg"><input class="search" id="pipName" style="margin:0" placeholder="e.g. emoji, pyfiglet" autocapitalize="none" autocorrect="off" spellcheck="false"><button data-act="pipgo">Add</button></div>`;
    const keep = document.activeElement && document.activeElement.id, pos = keep && document.activeElement.selectionStart, sc = body.scrollTop;
    body.innerHTML = html; body.scrollTop = sc;
    if (keep === 'pkgSearch') { const i = $('#pkgSearch'); i.focus(); i.setSelectionRange(pos, pos); }
  },
  async pkgInstall(name, btn) {
    btn && btn.classList.add('busy'); if (btn) btn.textContent = '…';
    this.showOut('term');
    await Py.install(name);
    this.renderPkgs();
  },

  /* ───── templates ───── */
  renderTpl() {
    $('#sbBody').innerHTML = '<div class="hint">Start a new project from a template. Each one is created in its own folder.</div>' +
      TEMPLATES.map(t => `<button class="tpl" data-act="tpl" data-id="${t.id}"><b><span class="em">${t.emoji}</span>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('');
  },
  renderExtensions() {
    const body = $('#sbBody');
    body.innerHTML = '<div class="hint">Small tools that add real file actions to the editor. Enable or disable each extension independently.</div>' +
      ExtensionManager.catalog.map(x => `<div class="extension-row"><div class="extension-top"><span class="extension-badge">${esc(x.badge)}</span><label class="extension-switch"><input type="checkbox" data-act="ext-toggle" data-id="${esc(x.id)}" ${ExtensionManager.enabled(x.id) ? 'checked' : ''}><i></i></label></div><b>${esc(x.name)}</b><p>${esc(x.description)}</p><small>${esc(x.types)}</small></div>`).join('');
  },
  async useTemplate(id) {
    const t = TEMPLATES.find(x => x.id === id); if (!t) return;
    const main = await instantiateTemplate(t);
    this.sbSwitch('files'); this.openFile(main); toast(t.name + ' created');
  },

  /* ───── settings ───── */
  settings() {
    const P = Prefs.data, C = P.cursor;
    const row = (l, s, c) => `<div class="set-row"><div>${l}${s ? `<small>${s}</small>` : ''}</div>${c}</div>`;
    const sw = (k, on, sc) => `<label class="sw"><input type="checkbox" data-${sc}="${k}" ${on ? 'checked' : ''}><i></i></label>`;
    const seg = (k, opts, cur, sc) => `<div class="seg" data-${sc}seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const rng = (k, mn, mx, st, v, sc) => `<input type="range" data-${sc}rng="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}">`;
    const swatches = ['accent', '#ffffff', '#59c2ff', '#ff6b8b', '#a6e35f', '#ffb454'].map(c => `<button data-cseg="color" data-v="${c}" class="${C.color === c ? 'on' : ''}" style="background:${c === 'accent' ? 'linear-gradient(135deg,var(--accent),var(--accent3))' : c}"></button>`).join('');
    Modal.open(`<h3>Settings</h3>
      <div class="set-h">APPEARANCE</div>
      ${row('Theme', '', seg('theme', [['ink', 'Ink'], ['oled', 'OLED'], ['moss', 'Moss'], ['dusk', 'Dusk']], P.theme, 'p'))}
      <div class="set-h">EDITOR</div>
      ${row('Font size', '', rng('fontSize', 11, 24, 1, P.fontSize, 'p'))}
      ${row('Tab width', '', seg('tabSize', [[2, '2'], [4, '4'], [8, '8']], P.tabSize, 'p'))}
      ${row('Wrap long lines', '', sw('wrap', P.wrap, 'p'))}
      ${row('Line numbers', '', sw('lineNumbers', P.lineNumbers, 'p'))}
      <div class="set-h">RUNNING</div>
      ${row('Auto-install missing packages', 'When an import fails, fetch it for you', sw('autoInstall', P.autoInstall, 'p'))}
      ${row('Keep output between runs', 'Otherwise the terminal clears on Run', sw('keepOutput', P.keepOutput, 'p'))}
      <div class="set-h">MOUSE / TRACKPAD CURSOR</div>
      ${row('Custom cursor', 'Shown when a mouse or trackpad is connected', sw('enabled', C.enabled, 'c'))}
      ${row('Style', '', seg('style', [['ring', 'Ring'], ['dot', 'Dot'], ['arrow', 'Arrow'], ['cross', 'Cross']], C.style, 'c'))}
      ${row('Size', '', rng('size', 16, 56, 2, C.size, 'c'))}
      ${row('Smoothing', 'How much the ring trails the pointer', rng('smooth', 0.08, 1, 0.02, C.smooth, 'c'))}
      ${row('Color', '', `<div class="swatches">${swatches}</div>`)}
      ${row('Hide the system pointer', 'iPadOS only. Turn off if you see two cursors', sw('hideSystem', C.hideSystem, 'c'))}
      <div class="set-h">WORKSPACE</div>
      <div class="set-row"><div>Export everything<small>Zip of all your files</small></div><button class="btn" data-x="zip">Export</button></div>
      <div class="set-row"><div>Restore sample projects<small>Adds the starter templates again</small></div><button class="btn" data-x="seed">Restore</button></div>
      <div class="actions"><button class="btn primary" data-x="done">Done</button></div>`, {
      onMount: (el, close) => {
        const apply = (sc, k, v) => sc === 'c' ? Prefs.setCursor(k, v) : Prefs.set(k, v);
        el.addEventListener('change', e => { const t = e.target; if (t.type === 'checkbox') { const sc = t.dataset.p ? 'p' : 'c'; apply(sc, t.dataset.p || t.dataset.c, t.checked); } });
        el.addEventListener('input', e => { const t = e.target; if (t.type === 'range') { const sc = t.dataset.prng ? 'p' : 'c'; apply(sc, t.dataset.prng || t.dataset.crng, +t.value); } });
        el.addEventListener('click', async e => {
          const b = e.target.closest('button'); if (!b) return;
          const holder = b.closest('[data-pseg],[data-cseg]');
          if (holder && b.dataset.v !== undefined) {
            const isC = holder.dataset.cseg !== undefined;
            let v = b.dataset.v; if (/^\d+$/.test(v)) v = +v;
            apply(isC ? 'c' : 'p', isC ? holder.dataset.cseg : holder.dataset.pseg, v);
            $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
            return;
          }
          if (b.dataset.x === 'done') close();
          else if (b.dataset.x === 'zip') this.exportZip();
          else if (b.dataset.x === 'seed') { for (const id of SEED_IDS) await instantiateTemplate(TEMPLATES.find(t => t.id === id)); toast('Samples restored'); }
        });
      }
    });
  }
};

PyPad.pyImage = b64 => Con.image('data:image/png;base64,' + b64);
