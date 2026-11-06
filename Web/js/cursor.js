'use strict';
/* Custom cursor for mouse / trackpad / Bluetooth pointers.
   Drawn in the DOM (iPadOS ignores CSS cursors), the native layer hides the system pointer
   over the IDE when "Hide the system pointer" is on. */
const Cursor = {
  ring: null, dot: null, x: -100, y: -100, rx: -100, ry: -100, seen: false, mouse: false,
  LINK: 'a,button,[role=button],.row,.tab,.chip,.tpl,select,summary,label,.menu-item,.seg button,.sw,input[type=range],input[type=checkbox],.ib,.run,#xkeys button,#gutter',
  TEXT: 'textarea,input:not([type=range]):not([type=checkbox]),.CodeMirror-lines,#termOut,#dcMsgs .tx',

  init() {
    const mk = (id, html) => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
    this.ring = mk('pp-ring', '<i></i>');
    this.dot = mk('pp-dot', '<i></i><svg viewBox="0 0 24 24"><path d="M3 2l17 8.5-7.2 2.2L10.5 20z" fill="var(--cur)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span class="cx"></span>');
    document.addEventListener('pointermove', e => this.move(e), { passive: true, capture: true });
    document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') this.setMouse(false); else { this.setMouse(true); this.ring.classList.add('down'); } }, true);
    document.addEventListener('pointerup', () => this.ring.classList.remove('down'), true);
    document.addEventListener('pointercancel', () => this.ring.classList.remove('down'), true);
    document.documentElement.addEventListener('mouseleave', () => document.body.classList.add('cur-hide'));
    document.documentElement.addEventListener('mouseenter', () => document.body.classList.remove('cur-hide'));
    Prefs.on(() => this.apply());
    this.apply();
    const loop = () => {
      const s = Prefs.data.cursor.smooth;
      this.rx += (this.x - this.rx) * s; this.ry += (this.y - this.ry) * s;
      this.ring.style.transform = 'translate3d(' + this.rx.toFixed(1) + 'px,' + this.ry.toFixed(1) + 'px,0)';
      this.dot.style.transform = 'translate3d(' + this.x.toFixed(1) + 'px,' + this.y.toFixed(1) + 'px,0)';
      requestAnimationFrame(loop);
    };
    loop();
  },

  setMouse(on) {
    if (on === this.mouse) return;
    this.mouse = on;
    document.body.classList.toggle('has-mouse', on);
  },

  place(x, y) {
    this.x = x; this.y = y;
    if (!this.seen) { this.rx = x; this.ry = y; this.seen = true; }
  },

  move(e) {
    if (e.pointerType === 'touch') { this.setMouse(false); return; }
    if (e.pointerType === 'pen') return;
    this.setMouse(true);
    this.place(e.clientX, e.clientY);
    const t = e.target && e.target.closest ? e.target : null;
    const c = this.ring.classList;
    const text = t && t.closest(this.TEXT), link = !text && t && t.closest(this.LINK);
    c.toggle('text', !!text); c.toggle('link', !!link);
  },

  /** Pointer events that happened inside the preview iframe (forwarded by consoleBoot). */
  fromFrame(d, rect) {
    if (d.kind === 'down') { this.ring.classList.add('down'); return; }
    if (d.kind === 'up') { this.ring.classList.remove('down'); return; }
    this.setMouse(true);
    this.place(rect.left + d.x, rect.top + d.y);
    this.ring.classList.remove('text', 'link');
  },

  apply() {
    const C = Prefs.data.cursor, b = document.body;
    b.classList.toggle('cur-on', !!C.enabled);
    b.classList.toggle('cur-sys-hidden', !!(C.enabled && C.hideSystem));
    ['ring', 'dot', 'arrow', 'cross'].forEach(s => b.classList.toggle('cur-' + s, C.style === s));
    const root = document.documentElement.style;
    let col = C.color === 'accent' ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() : C.color;
    root.setProperty('--cur', col || '#ffb454');
    root.setProperty('--cs', C.size + 'px');
    const m = /^#?([0-9a-f]{6})$/i.exec(col || '');
    if (m) { const n = parseInt(m[1], 16); root.setProperty('--cur-soft', 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.2)'); }
    native('pointerHidden', { value: !!(C.enabled && C.hideSystem) });
  }
};
