'use strict';
const CM_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
const CM_FILES = [
  'codemirror.min.js',
  'mode/python/python.min.js', 'mode/javascript/javascript.min.js', 'mode/xml/xml.min.js',
  'mode/css/css.min.js', 'mode/htmlmixed/htmlmixed.min.js', 'mode/markdown/markdown.min.js',
  'addon/edit/closebrackets.min.js', 'addon/edit/matchbrackets.min.js',
  'addon/selection/active-line.min.js', 'addon/comment/comment.min.js'
];

const XKEYS = [
  { l: '⇥', a: 'tab' }, { l: '⇤', a: 'untab' }, { sep: 1 }, { l: '↶', a: 'undo' }, { l: '↷', a: 'redo' }, { sep: 1 },
  { l: '(', pair: '()' }, { l: ')' }, { l: '[', pair: '[]' }, { l: ']' }, { l: '{', pair: '{}' }, { l: '}' }, { l: '"', pair: '""' }, { l: "'", pair: "''" }, { sep: 1 },
  { l: ':' }, { l: '=' }, { l: '.' }, { l: ',' }, { l: '_' }, { l: '#' }, { l: '/' }, { l: '\\' }, { l: '<' }, { l: '>' }, { l: '-' }, { l: '+' }, { l: '*' },
  { l: '&' }, { l: '|' }, { l: '!' }, { l: '?' }, { l: ';' }, { l: '$' }, { l: '%' }, { l: '@' }, { l: '~' }, { l: '`' }, { sep: 1 },
  { l: '←', a: 'left' }, { l: '→', a: 'right' }, { l: '↑', a: 'up' }, { l: '↓', a: 'down' }
];

const Ed = {
  cm: null, ta: null, docs: new Map(), tabs: [], active: null,

  modeFor(path) {
    switch (Path.ext(path)) {
      case 'py': return 'python';
      case 'js': case 'mjs': case 'ts': case 'jsx': return 'javascript';
      case 'json': return { name: 'javascript', json: true };
      case 'html': case 'htm': case 'xml': case 'svg': return 'htmlmixed';
      case 'css': return 'css';
      case 'md': return 'markdown';
      default: return null;
    }
  },

  async init() {
    const host = $('#editor');
    try {
      await loadAny(['vendor/cm/codemirror.min.css', CM_BASE + 'codemirror.min.css'], loadCSS);
      for (const f of CM_FILES) await loadAny(['vendor/cm/' + f, CM_BASE + f]);
      const tab = cm => {
        if (cm.somethingSelected()) return cm.indentSelection('add');
        const n = cm.getOption('tabSize'), col = cm.getCursor().ch;
        cm.replaceSelection(' '.repeat(n - (col % n)));
      };
      this.cm = CodeMirror(host, {
        value: '', theme: 'pypad', lineNumbers: Prefs.get('lineNumbers'), lineWrapping: Prefs.get('wrap'),
        indentUnit: Prefs.get('tabSize'), tabSize: Prefs.get('tabSize'), indentWithTabs: false, smartIndent: true,
        autoCloseBrackets: true, matchBrackets: true, styleActiveLine: true, viewportMargin: 30,
        inputStyle: IS_TOUCH ? 'contenteditable' : 'textarea',
        extraKeys: { Tab: tab, 'Shift-Tab': 'indentLess', 'Cmd-/': 'toggleComment', 'Ctrl-/': 'toggleComment' }
      });
      const inp = this.cm.getInputField();
      ['autocapitalize:off', 'autocorrect:off', 'spellcheck:false', 'autocomplete:off'].forEach(s => { const [k, v] = s.split(':'); inp.setAttribute(k, v); });
      this.cm.on('focus', () => IS_TOUCH && $('#editorPane').classList.add('kb'));
      this.cm.on('blur', () => $('#editorPane').classList.remove('kb'));
    } catch (e) {
      console.warn('CodeMirror unavailable, using plain editor', e);
      this.ta = document.createElement('textarea'); this.ta.className = 'fallback';
      this.ta.setAttribute('autocapitalize', 'off'); this.ta.setAttribute('autocorrect', 'off'); this.ta.spellcheck = false;
      host.appendChild(this.ta);
      this.ta.addEventListener('input', () => this.active && WS.touch(this.active, this.ta.value));
      this.ta.addEventListener('focus', () => IS_TOUCH && $('#editorPane').classList.add('kb'));
      this.ta.addEventListener('blur', () => $('#editorPane').classList.remove('kb'));
      this.ta.addEventListener('keydown', e => {
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
      });
      toast('Offline: using basic editor');
    }
    this.buildXKeys();
    this.applyPrefs();
    Prefs.on(() => this.applyPrefs());
  },

  applyPrefs() {
    document.documentElement.style.setProperty('--code-size', Prefs.get('fontSize') + 'px');
    if (this.cm) {
      this.cm.setOption('tabSize', Prefs.get('tabSize')); this.cm.setOption('indentUnit', Prefs.get('tabSize'));
      this.cm.setOption('lineWrapping', Prefs.get('wrap')); this.cm.setOption('lineNumbers', Prefs.get('lineNumbers'));
      this.cm.refresh();
    }
  },

  buildXKeys() {
    const bar = $('#xkeys');
    bar.innerHTML = XKEYS.map((k, i) => k.sep ? '<div class="sep"></div>' : `<button data-i="${i}">${esc(k.l)}</button>`).join('');
    // pointerdown + preventDefault keeps the keyboard open and focus in the editor
    bar.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); haptic('light');
      this.keyAction(XKEYS[+b.dataset.i]);
    });
  },

  keyAction(k) {
    const cm = this.cm;
    if (!cm) { if (this.ta && k.l) document.execCommand('insertText', false, k.pair ? k.pair : k.l); return; }
    if (k.a) {
      const cmd = { tab: 'defaultTab', untab: 'indentLess', undo: 'undo', redo: 'redo', left: 'goCharLeft', right: 'goCharRight', up: 'goLineUp', down: 'goLineDown' }[k.a];
      if (k.a === 'tab') cm.options.extraKeys.Tab(cm); else cm.execCommand(cmd);
    } else if (k.pair) {
      const sel = cm.getSelection();
      cm.replaceSelection(k.pair[0] + sel + k.pair[1]);
      if (!sel) cm.execCommand('goCharLeft');
    } else cm.replaceSelection(k.l);
    cm.focus();
  },

  docFor(path) {
    let d = this.docs.get(path);
    if (!d) {
      d = new CodeMirror.Doc(WS.files[path] || '', this.modeFor(path));
      d.on('change', () => WS.touch(path, d.getValue()));
      this.docs.set(path, d);
    }
    return d;
  },

  open(path) {
    if (!(path in WS.files)) return;
    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.active = path;
    if (this.cm) { this.cm.swapDoc(this.docFor(path)); this.cm.refresh(); }
    else if (this.ta) this.ta.value = WS.files[path] || '';
    this.renderTabs();
    try { localStorage.setItem('pypad.last', path); } catch (e) {}
  },

  close(path) {
    const i = this.tabs.indexOf(path); if (i < 0) return;
    this.tabs.splice(i, 1); this.docs.delete(path);
    if (this.active === path) {
      this.active = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.open(next); else this.showEmpty();
    }
    this.renderTabs();
  },

  showEmpty() {
    this.active = null;
    if (this.cm) this.cm.swapDoc(new CodeMirror.Doc('', null));
    if (this.ta) this.ta.value = '';
    this.renderTabs();
  },

  /** Keep open tabs consistent after rename from the file tree. */
  remap(map) {
    for (const [a, b] of Object.entries(map)) {
      const i = this.tabs.indexOf(a);
      if (i >= 0) { this.tabs[i] = b; this.docs.delete(a); this.docs.delete(b); }
      if (this.active === a) this.active = b;
    }
    if (this.active) this.open(this.active); else this.renderTabs();
  },
  prune() {
    for (const p of [...this.tabs]) if (!(p in WS.files)) this.close(p);
  },

  value() { return this.cm ? this.cm.getValue() : (this.ta ? this.ta.value : ''); },
  focus() { this.cm ? this.cm.focus() : this.ta && this.ta.focus(); },
  refresh() { this.cm && this.cm.refresh(); },

  renderTabs() {
    const el = $('#tabs');
    el.innerHTML = this.tabs.map(p => `<div class="tab ${p === this.active ? 'on' : ''}" data-p="${esc(p)}">
      <span class="fx ${Path.ext(p)}">${esc((Path.ext(p) || 'txt').slice(0, 4).toUpperCase())}</span>
      <span class="nm">${esc(Path.base(p))}</span><button class="x" data-x="${esc(p)}">${icon('x')}</button></div>`).join('');
    const on = $('.tab.on', el); on && on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#editor').style.visibility = this.active ? 'visible' : 'hidden';
    UI.updateEmpty && UI.updateEmpty();
  }
};

document.addEventListener('click', e => {
  const x = e.target.closest('#tabs .x');
  if (x) { e.stopPropagation(); Ed.close(x.dataset.x); return; }
  const t = e.target.closest('#tabs .tab');
  if (t) Ed.open(t.dataset.p);
});
