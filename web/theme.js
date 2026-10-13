(() => {
  // Two looks share one app.js: index.html ("nothing") and terminal.html ("terminal").
  // The choice lives in localStorage; ?theme=terminal|nothing sets it from a URL
  // (handy for Wallpaper Engine, which has its own storage and no keyboard).
  // Loaded in <head> so the redirect happens before the wrong page paints.
  // Only the entry page (index.html) follows the saved choice; opening terminal.html
  // directly is itself a choice, so it stays there and remembers it.
  const KEY = 'home-theme';
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  // The terminal theme used to be called "universe": carry its saved choice and settings over.
  if (get(KEY) === 'universe') set(KEY, 'terminal');
  for (const k of ['settings', 'anim', 'glyphs']) {
    const old = get(`universe-${k}`);
    if (old === null) continue;
    if (get(`terminal-${k}`) === null) set(`terminal-${k}`, old);
    set(`universe-${k}`, null);
  }

  const here = /terminal\.html$/i.test(location.pathname) ? 'terminal' : 'nothing';
  const page = t => (t === 'terminal' ? 'terminal.html' : 'index.html') + location.search + location.hash;
  let pref = get(KEY);
  const asked = new URLSearchParams(location.search).get('theme');
  if (asked === 'terminal' || asked === 'nothing') pref = asked;
  else if (here === 'terminal') pref = 'terminal';
  if (pref === 'terminal' || pref === 'nothing') {
    set(KEY, pref);
    if (pref !== here) { location.replace(page(pref)); return; }
  }

  // terminal: animations off (html.still) unless turned on, or by default with reduced motion.
  if (here === 'terminal') {
    const anim = get('terminal-anim');
    if (anim === '0' || (anim === null && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      document.documentElement.classList.add('still');
    }
  }

  const swap = () => {
    const next = here === 'terminal' ? 'nothing' : 'terminal';
    set(KEY, next);
    const u = new URL(page(next), location.href);
    u.searchParams.delete('theme');
    location.href = u.href;
  };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.isContentEditable)) return;
    if (e.key === 'u' || e.key === 'U') { e.preventDefault(); swap(); }
  });
  window.homeTheme = { here, swap };
})();
