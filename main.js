'use strict';
(async function boot() {
  const applyTheme = () => { document.documentElement.dataset.theme = Prefs.get('theme'); };
  applyTheme(); Prefs.on(applyTheme);
  Con.init();
  await WS.load();

  // First launch: create the sample projects
  if (!localStorage.getItem('pypad.seeded') && !Object.keys(WS.files).length) {
    for (const id of SEED_IDS) await instantiateTemplate(TEMPLATES.find(t => t.id === id));
    localStorage.setItem('pypad.seeded', '1');
  }

  await Ed.init();
  UI.init(); Shell.init(); PV.init(); Disc.init(); Cursor.init();
  UI.setRunning(false);

  const last = localStorage.getItem('pypad.last');
  const first = (last && last in WS.files) ? last : (('hello-python/hello.py' in WS.files) ? 'hello-python/hello.py' : Object.keys(WS.files)[0]);
  if (first) Ed.open(first); else Ed.renderTabs();
  UI.renderFiles();
  UI.setView(UI.phone() ? 'code' : 'code');
  Ed.refresh();

  Con.sys('PyPad is ready.');
  Con.info('Press Run on any .py, .js or .html file. Python starts on first use (needs internet once).');
  Con.info('Try the Flask and Discord samples in the sidebar. Type "help" after tapping the >>> button to switch to the shell.');
  if (!NATIVE) Con.warn('Running in a plain browser: files are saved in localStorage only.');
})().catch(e => {
  document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f66;padding:20px;white-space:pre-wrap;position:fixed;inset:0;background:#000;z-index:9999">PyPad failed to start\n\n' + String(e && e.stack || e).replace(/</g, '&lt;') + '</pre>');
});
