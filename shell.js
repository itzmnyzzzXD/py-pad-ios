'use strict';
/* ═════════ Run orchestration ═════════ */
const Run = {
  siblingHtml(path) {
    const d = Path.dir(path), base = Path.base(path);
    const htmls = Object.keys(WS.files).filter(p => Path.dir(p) === d && /\.html?$/i.test(p));
    return htmls.find(p => (WS.files[p] || '').includes(base)) || null;
  },
  async current() {
    const p = Ed.active;
    if (!p) { toast('Open a file first'); return; }
    await this.file(p);
  },
  async file(p) {
    if (WS.isBinary(p)) { toast('Binary files cannot be run'); return; }
    await WS.flush();
    haptic('medium');
    const ext = Path.ext(p), code = WS.files[p] || '';
    if (ext === 'py') {
      UI.showOut('term');
      if (!Prefs.get('keepOutput')) Con.clear();
      Con.cmd('$ python ' + p);
      await Py.run(p);
    } else if (ext === 'js' || ext === 'mjs') {
      const sib = /\b(document|window)\b/.test(code) ? this.siblingHtml(p) : null;
      if (sib) { UI.showOut('prev'); await PV.showHTML(sib); return; }
      UI.showOut('term');
      if (!Prefs.get('keepOutput')) Con.clear();
      Con.cmd('$ node ' + p);
      JSRun.run(p);
    } else if (ext === 'html' || ext === 'htm') {
      UI.showOut('prev'); await PV.showHTML(p);
    } else if (ext === 'css') {
      const sib = this.siblingHtml(p);
      if (sib) { UI.showOut('prev'); await PV.showHTML(sib); } else toast('No HTML file links this stylesheet');
    } else toast("Don't know how to run ." + (ext || 'this file'));
  }
};

/* ═════════ Terminal ═════════ */
const Shell = {
  mode: 'py', more: false, cwd: '', hist: [], hi: 0, busy: false,

  init() {
    const inp = $('#termIn');
    $('#termForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (this.busy) return;
      const v = inp.value; inp.value = '';
      this.busy = true;
      try { await this.submit(v); } catch (err) { Con.err(String(err && err.message || err)); }
      this.busy = false; this.prompt();
    });
    $('#termMode').addEventListener('click', () => this.toggle());
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.step(1); }
      else if (e.key === 'Tab') { e.preventDefault(); inp.value += '    '; }
    });
    this.prompt();
  },
  step(d) {
    if (!this.hist.length) return;
    this.hi = Math.max(0, Math.min(this.hist.length, this.hi + d));
    $('#termIn').value = this.hist[this.hi] || '';
  },
  prompt() {
    const b = $('#termMode');
    b.textContent = this.mode === 'sh' ? '$' : (this.more ? '...' : '>>>');
    b.classList.toggle('sh', this.mode === 'sh');
    $('#termIn').placeholder = this.mode === 'sh' ? 'Shell — try: help, ls, pip install rich, python hello.py' : 'Python REPL — try 1+1, or: pip install rich';
  },
  toggle() { if (this.more) return; this.mode = this.mode === 'py' ? 'sh' : 'py'; this.prompt(); haptic('light'); },
  abs(p) { return Path.resolve(this.cwd, p); },

  async submit(line) {
    if (this.more) { Con.write('cmd', '... ' + line); return this.pyPush(line, true); }
    const t = line.trim(); if (!t) return;
    this.hist.push(line); this.hi = this.hist.length;
    const sh = this.mode === 'sh';
    Con.cmd((sh ? '$ ' : '>>> ') + line);
    if (t.startsWith('!')) return this.sh(t.slice(1).trim());
    if (sh || /^pip3?\s/.test(t)) return this.sh(t);
    return this.pyPush(line, false);
  },

  async pyPush(line, continuation) {
    await Py.init();
    if (/\b(import|from)\b/.test(line)) { try { await Py.preload(line); } catch (e) {} }
    Py.syncIn();
    const rt = Py.py.pyimport('pypad_runtime');
    try {
      rt.repl_setup(WS_ROOT, WS_ROOT + (this.cwd ? '/' + this.cwd : ''));
      let st = await rt.shell_push(line);
      if (st.startsWith('missing:')) {
        const mod = st.slice(8);
        if (!continuation && Prefs.get('autoInstall') && await Py.install(mod, true)) st = await rt.shell_push(line);
        else { Con.err(rt.last_error()); st = 'done'; }
      }
      this.more = st === 'more';
      rt.flush();
      rt.collect_images().toJs().forEach(b => Con.image('data:image/png;base64,' + b));
    } finally { rt.destroy(); }
    Py.syncOut();
  },

  async sh(line) {
    const a = (line.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^(["'])(.*)\1$/, '$2'));
    const cmd = a.shift(); if (!cmd) return;
    const f = SH[cmd];
    if (!f) { Con.err(cmd + ': command not found (type "help")'); return; }
    await f.call(this, a, line);
  },

  list(dir) {
    const c = WS.children(dir);
    return [...c.dirs.map(d => Path.base(d) + '/'), ...c.files.map(Path.base)];
  }
};

const SH = {
  help() {
    Con.out([
      'Shell commands',
      '  ls [dir]            list files        tree [dir]       show tree',
      '  cd <dir> / pwd      change / show directory',
      '  cat <file>          print a file      open <file>      open in editor',
      '  touch / mkdir       create file / folder',
      '  rm [-r] <path>      delete            mv / cp <a> <b>  move / copy',
      '  echo text > file    write a file (>> appends)',
      '  python <file.py>    run Python        node <file.js>   run JavaScript',
      '  pip install <pkg>   install a package (pip list / pip uninstall / -r requirements.txt)',
      '  clear               clear screen      history          past commands',
      '',
      'Tap the >>> / $ button to switch between Python and Shell. In Python mode',
      'prefix a shell command with ! (for example  !ls ).'
    ].join('\n'));
  },
  pwd() { Con.out('/' + this.cwd); },
  cd(a) {
    const p = a[0] && a[0] !== '~' ? this.abs(a[0]) : '';
    if (p === '' || WS.dirs.has(p)) this.cwd = p; else Con.err('cd: no such directory: ' + a[0]);
  },
  ls(a) {
    const p = a.filter(x => !x.startsWith('-'))[0]; const d = p ? this.abs(p) : this.cwd;
    if (d && !WS.dirs.has(d)) { if (d in WS.files) { Con.out(Path.base(d)); return; } Con.err('ls: ' + p + ': no such file or directory'); return; }
    const l = this.list(d); Con.out(l.length ? l.join('   ') : '(empty)');
  },
  tree(a) {
    const root = a[0] ? this.abs(a[0]) : this.cwd, out = [];
    const walk = (d, pre) => {
      const c = WS.children(d), items = [...c.dirs, ...c.files];
      items.forEach((p, i) => {
        const last = i === items.length - 1, isDir = c.dirs.includes(p);
        out.push(pre + (last ? '└─ ' : '├─ ') + Path.base(p) + (isDir ? '/' : ''));
        if (isDir) walk(p, pre + (last ? '   ' : '│  '));
      });
    };
    out.push('/' + root); walk(root, ''); Con.out(out.join('\n'));
  },
  cat(a) { for (const f of a) { const p = this.abs(f); if (!(p in WS.files)) Con.err('cat: ' + f + ': no such file'); else Con.out(WS.isBinary(p) ? '<binary file>' : WS.files[p]); } },
  open(a) { const p = this.abs(a[0] || ''); if (p in WS.files) { UI.openFile(p); } else Con.err('open: no such file: ' + a[0]); },
  async touch(a) { for (const f of a) { const p = this.abs(f); if (!(p in WS.files)) await WS.create(p, ''); } },
  async mkdir(a) { for (const f of a) if (!f.startsWith('-')) await WS.mkdir(this.abs(f)); },
  async rm(a) {
    for (const f of a.filter(x => !x.startsWith('-'))) {
      const p = this.abs(f);
      if (!WS.exists(p)) { Con.err('rm: ' + f + ': no such file or directory'); continue; }
      if (WS.dirs.has(p) && !a.some(x => /^-.*r/.test(x))) { Con.err('rm: ' + f + ': is a directory (use -r)'); continue; }
      await WS.remove(p); Ed.prune();
    }
  },
  async mv(a) { if (a.length < 2) return Con.err('usage: mv <from> <to>'); const m = await WS.rename(this.abs(a[0]), this.abs(a[1])); Ed.remap(m); },
  async cp(a) {
    if (a.length < 2) return Con.err('usage: cp <from> <to>');
    const from = this.abs(a[0]), to = this.abs(a[1]);
    if (from in WS.files) await WS.create(WS.dirs.has(to) ? Path.join(to, Path.base(from)) : to, WS.files[from]);
    else Con.err('cp: ' + a[0] + ': no such file');
  },
  async echo(a, line) {
    const m = line.match(/^echo\s+(.*?)\s*(>>?)\s*(\S+)\s*$/);
    if (!m) { Con.out(a.join(' ')); return; }
    const p = this.abs(m[3]), txt = m[1].replace(/^(["'])(.*)\1$/, '$2') + '\n';
    await WS.create(p, m[2] === '>>' ? (WS.files[p] || '') + txt : txt);
  },
  clear() { Con.clear(); }, cls() { Con.clear(); },
  history() { Con.out(this.hist.map((h, i) => (i + 1) + '  ' + h).join('\n')); },
  date() { Con.out(new Date().toString()); },
  whoami() { Con.out('pypad'); },
  async python(a) { if (!a[0]) { this.mode = 'py'; this.prompt(); return Con.info('Switched to the Python REPL'); } await Py.run(this.abs(a[0])); },
  async node(a) { if (!a[0]) return Con.err('usage: node <file.js>'); JSRun.run(this.abs(a[0])); await sleep(50); },
  async run(a) { await Run.file(a[0] ? this.abs(a[0]) : Ed.active); },
  async pip(a) {
    const sub = a.shift();
    const clean = n => n.split(/[<>=!~;\[ ]/)[0].trim();
    if (sub === 'install') {
      const names = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '-r') { const f = this.abs(a[++i] || ''); (WS.files[f] || '').split('\n').map(l => l.split('#')[0].trim()).filter(Boolean).forEach(l => names.push(clean(l))); }
        else if (!a[i].startsWith('-')) names.push(clean(a[i]));
      }
      if (!names.length) return Con.err('usage: pip install <package> [...]');
      for (const n of names) await Py.install(n);
    } else if (sub === 'uninstall') { for (const n of a.filter(x => !x.startsWith('-'))) await Py.uninstall(n); }
    else if (sub === 'list' || sub === 'freeze') { const l = await Py.listInstalled(); Con.out(l.length ? l.join('\n') : '(nothing extra installed yet)'); }
    else Con.err('usage: pip install|uninstall|list');
  }
};
SH.ll = SH.ls; SH.edit = SH.open; SH.python3 = SH.python; SH.rmdir = SH.rm; SH.pip3 = SH.pip; SH.type = SH.cat;
