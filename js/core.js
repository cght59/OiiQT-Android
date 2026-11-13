/* Tiny shared kernel — avoids circular imports between app.js and views. */
const listeners = new Map();
export const bus = {
  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => bus.off(evt, fn); },
  off(evt, fn) { listeners.get(evt)?.delete(fn); },
  emit(evt, payload) { listeners.get(evt)?.forEach(fn => { try { fn(payload); } catch (e) { console.warn(e); } }); }
};

/** Filled in by app.js at boot. Views call these instead of importing app.js. */
export const App = {
  go() {}, renderPage() {}, renderTopbar() {}, renderTabbar() {},
  refresh() {}, applyTheme() {}, openServerEditor() {}, openAddTorrent() {},
  action() {}, setStatusFilter() {}, showTaskDetail() {}
};
