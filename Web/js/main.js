'use strict';
(async function boot() {
  const applyTheme = () => { document.documentElement.dataset.theme = Prefs.get('theme'); };
  applyTheme(); Prefs.on(applyTheme);
  Con.init();
  await WS.load();

  if (!localStorage.getItem('pypad.seeded') && !Object.keys(WS.files).length) {
    for (const id of SEED_IDS) {
      const template = TEMPLATES.find(t => t.id === id);
      if (template) await instantiateTemplate(template);
    }
    localStorage.setItem('pypad.seeded', '1');
  }

  await Ed.init();
  UI.init(); Shell.init(); PV.init(); Cursor.init();
  UI.setRunning(false);
  UI.showHome();
  UI.renderFiles();
  UI.setView('code');
  Ed.refresh();

  Con.sys('PyPad workspace is ready.');
  Con.info('Open a project or create a Python file. Python executes in the bundled Pyodide runtime; additional packages can be installed from Packages when online.');
  if (!NATIVE) Con.warn('Browser mode: workspace files are saved in localStorage. The iOS app stores files in its Documents workspace.');
})().catch(e => {
  document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f66;padding:20px;white-space:pre-wrap;position:fixed;inset:0;background:#000;z-index:9999">PyPad failed to start\n\n' + String(e && e.stack || e).replace(/</g, '&lt;') + '</pre>');
});
