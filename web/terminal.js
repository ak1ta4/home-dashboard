(() => {
  // Extras for the "terminal" theme. app.js owns the data (search, favourites, system
  // stats…); this file adds the ASCII ember background, the clock, date and typed greeting,
  // the terminal window's user@host, icon tiles and an editor for the favourites, the status
  // pill, the night-light layer and the settings sheet.
  const DEMO = new URLSearchParams(location.search).has('demo');
  const root = document.documentElement;

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const setText = (id, v) => { const el = $(id); if (el && el.textContent !== String(v)) el.textContent = v; };
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  // Earlier versions (as "universe") kept a background image in IndexedDB; free that space.
  try { indexedDB.deleteDatabase('universe'); } catch {}

  // ---------- Settings ----------
  const SET_KEY = 'terminal-settings';
  const DEFAULTS = { night: 45, field: 75, name: '', h24: true, icons: 'glyph', sys: true };
  let S = { ...DEFAULTS };
  try { S = { ...DEFAULTS, ...JSON.parse(store.get(SET_KEY) || '{}') }; } catch {}
  if (S.icons !== 'glyph' && S.icons !== 'letter') S.icons = 'glyph';
  const save = () => store.set(SET_KEY, JSON.stringify(S));
  // theme.js already applied html.still before the first paint; this is the source of truth after.
  let anim = !root.classList.contains('still');

  const apply = () => {
    root.style.setProperty('--night', (S.night / 100).toFixed(2));
    root.style.setProperty('--field', (S.field / 100).toFixed(2));
    root.classList.toggle('still', !anim);
    $('night-amt').value = S.night; setText('night-out', `${S.night}%`);
    $('field-amt').value = S.field; setText('field-out', `${S.field}%`);
    if (document.activeElement !== $('name')) $('name').value = S.name;
    const on = { h24: S.h24, sys: S.sys, anim };
    $('settings').querySelectorAll('.switch').forEach(sw => sw.setAttribute('aria-checked', !!on[sw.dataset.set]));
    $('settings').querySelectorAll('.segmented').forEach(seg => seg.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.val === S[seg.dataset.set]);
    }));
  };

  // ---------- Background: ASCII embers ----------
  // A domain-warped noise field drawn as characters, drifting upward like smoke over embers.
  // Characters come from a pre-rendered atlas (one sprite per intensity level), ~12 fps.
  const field = $('field'), fx = field.getContext('2d');
  const RAMP = ' .·:;-=+*#%@';
  const TONES = ['#3c3836', '#504945', '#665c54', '#7c6f64', '#928374', '#a89984', '#bdae93', '#d79921', '#fabd2f', '#fe8019', '#fe8019'];
  const LEVELS = RAMP.length - 1;
  const FS = 14;

  const noise = (() => {
    let seed = 1337;
    const r = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
    const P = new Uint8Array(512), V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const h = (x, y) => V[P[(P[x & 255] + y) & 255]];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  })();
  const fbm = (x, y) => (noise(x, y) * 4 + noise(x * 2.03, y * 2.03) * 2 + noise(x * 4.1, y * 4.1)) / 7;

  let atlas = null, cw = 0, ch = 0, cols = 0, rows = 0, dpr = 1, mouse = null;
  const build = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    field.width = Math.round(innerWidth * dpr);
    field.height = Math.round(innerHeight * dpr);
    const font = `400 ${FS * dpr}px "JetBrains Mono", ui-monospace, monospace`;
    fx.font = font;
    cw = Math.ceil(fx.measureText('M').width);
    ch = Math.round(FS * 1.32 * dpr);
    cols = Math.ceil(field.width / cw);
    rows = Math.ceil(field.height / ch);
    atlas = document.createElement('canvas');
    atlas.width = cw * LEVELS; atlas.height = ch;
    const a = atlas.getContext('2d');
    a.font = font; a.textBaseline = 'middle'; a.textAlign = 'center';
    for (let k = 1; k <= LEVELS; k++) {
      a.fillStyle = TONES[k - 1];
      a.fillText(RAMP[k], (k - 1) * cw + cw / 2, ch / 2);
    }
  };
  const draw = t => {
    if (!atlas) return;
    fx.clearRect(0, 0, field.width, field.height);
    if (S.field <= 0) return;
    for (let r = 0; r < rows; r++) {
      const ny = r * 0.11, fy = r / rows;
      const lift = 0.32 + 0.8 * fy * fy;                       // embers glow from below
      for (let c = 0; c < cols; c++) {
        const nx = c * 0.05;
        const q = fbm(nx * 0.9 + t * 0.02, ny * 0.9 + t * 0.09);
        let v = (fbm(nx + q * 1.8 - t * 0.015, ny + q * 1.8 + t * 0.16) - 0.36) * 1.9 * lift;
        if (mouse) {
          const dx = (c - mouse.c) * 0.55, dy = r - mouse.r;
          v += 0.5 * Math.exp(-(dx * dx + dy * dy) / 26);       // a little lantern under the pointer
        }
        if (v <= 0.07) continue;
        const k = Math.min(LEVELS, 1 + Math.floor(v * LEVELS));
        fx.drawImage(atlas, (k - 1) * cw, 0, cw, ch, c * cw, r * ch, cw, ch);
      }
    }
  };
  const STILL_T = 120;
  let last = 0;
  const loop = now => {
    requestAnimationFrame(loop);
    if (!anim || now - last < 83) return;
    last = now;
    draw(now / 1000);
  };
  const redrawStill = () => { if (!anim) draw(STILL_T); };
  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { build(); redrawStill(); }, 150); });
  addEventListener('pointermove', e => { mouse = { c: e.clientX * dpr / cw, r: e.clientY * dpr / ch }; });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) mouse = null; });
  (document.fonts ? document.fonts.load(`${FS}px "JetBrains Mono"`).catch(() => {}) : Promise.resolve())
    .then(() => { build(); redrawStill(); requestAnimationFrame(loop); });

  // ---------- Clock, date, typed greeting ----------
  const DATE_FMT = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const greeting = h => (h < 6 ? 'dulces sueños' : h < 12 ? 'buenos días' : h < 20 ? 'buenas tardes' : 'buenas noches');
  const clock = $('clock'), dateEl = $('today'), greetEl = $('greet');
  let shownTime = '', shownDate = '', typed = null, typeTimer = 0;
  const typeGreet = (text, instant) => {
    if (text === typed) return;
    typed = text;
    clearInterval(typeTimer);
    if (instant || !anim) { greetEl.textContent = text; return; }
    let i = 0;
    greetEl.textContent = '';
    typeTimer = setInterval(() => { greetEl.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typeTimer); }, 55);
  };
  const sep = () => Object.assign(document.createElement('b'), { textContent: ' · ' });
  const tick = instant => {
    const now = DEMO ? new Date(2026, 2, 31, 9, 41) : new Date(); // app.js's demo moment
    const h = now.getHours(), m = now.getMinutes();
    const time = `${S.h24 ? h : h % 12 || 12}:${pad(m)}`;
    if (time !== shownTime) {
      shownTime = time;
      const [hh, mm] = time.split(':');
      clock.replaceChildren(hh, Object.assign(document.createElement('span'), { className: 'colon', textContent: ':' }), mm);
      document.title = time;
    }
    const p = Object.fromEntries(DATE_FMT.formatToParts(now).map(x => [x.type, x.value]));
    const date = `${p.weekday}|${p.day} ${p.month}|${p.year}`;
    if (date !== shownDate) {
      shownDate = date;
      dateEl.replaceChildren(...date.split('|').flatMap((t, i) => (i ? [sep(), t] : [t])));
    }
    typeGreet(S.name ? `${greeting(h)}, ${S.name}` : greeting(h), instant === true);
  };

  // ---------- Terminal title + status pill (host from the agent) ----------
  const sysHost = $('sys-host');
  const renderHost = () => {
    const host = sysHost.textContent.trim();
    const live = !!host && host !== '—';
    setText('term-user', (S.name || 'user').toLowerCase().replace(/\s+/g, '-'));
    setText('term-host', live ? host.toLowerCase() : 'home');
    $('status').hidden = !(live && S.sys);
  };
  new MutationObserver(renderHost).observe(sysHost, { childList: true, characterData: true, subtree: true });

  // ---------- Favourites: icon tiles ----------
  // Each tile shows, in order of preference: the icon you chose in the editor (a Simple Icons
  // glyph, an image or a short text), else the site's brand glyph, else its initial. Glyphs
  // are monochrome SVGs from jsDelivr, cached in localStorage. Colour: yours, else by position.
  const GLYPH_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@15.0.0/icons/';
  const GLYPH_KEY = 'terminal-glyphs';
  const SLUGS = {
    'mail.google.com': 'gmail', 'gmail.com': 'gmail', 'classroom.google.com': 'googleclassroom', 'drive.google.com': 'googledrive',
    'docs.google.com': 'googledocs', 'sheets.google.com': 'googlesheets', 'calendar.google.com': 'googlecalendar',
    'photos.google.com': 'googlephotos', 'maps.google.com': 'googlemaps', 'meet.google.com': 'googlemeet',
    'translate.google.com': 'googletranslate', 'music.youtube.com': 'youtubemusic', 'youtu.be': 'youtube',
    'twitter.com': 'x', 'open.spotify.com': 'spotify', 'chatgpt.com': 'openai', 'chat.openai.com': 'openai',
    'claude.ai': 'claude', 'web.whatsapp.com': 'whatsapp', 'store.steampowered.com': 'steam', 'steamcommunity.com': 'steam',
  };
  const ACCENTS = ['orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'red'];
  const NS = 'http://www.w3.org/2000/svg';
  let glyphs = {};
  try { glyphs = JSON.parse(store.get(GLYPH_KEY) || '{}'); } catch {}
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const slugFor = host => {
    if (SLUGS[host]) return SLUGS[host];
    const parts = host.split('.');
    let i = parts.length - 2;
    if (i > 0 && /^(co|com|org|net|gov|edu|ac)$/.test(parts[i]) && parts[i + 1].length === 2) i--; // example.co.uk
    return (parts[Math.max(0, i)] || '').replace(/[^a-z0-9]/g, '');
  };
  const pending = new Map();
  const glyph = slug => {
    if (!slug) return Promise.resolve('');
    if (slug in glyphs) return Promise.resolve(glyphs[slug]);
    if (!pending.has(slug)) {
      pending.set(slug, fetch(`${GLYPH_CDN}${slug}.svg`)
        .then(r => (r.ok ? r.text() : ''))
        .then(t => (t.match(/<path[^>]*\sd="([^"]+)"/) || [])[1] || '')
        .then(d => { glyphs[slug] = d; store.set(GLYPH_KEY, JSON.stringify(glyphs)); return d; })
        .catch(() => { pending.delete(slug); return ''; })); // offline: try again next time
    }
    return pending.get(slug);
  };
  const isImage = icon => /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(icon);
  // Paint one tile. `mono.dataset.letter` is the fallback text (app.js renders the initial).
  const paint = (mono, icon, url) => {
    const key = `${S.icons}|${icon}|${url}|${mono.dataset.letter}`;
    if (mono.dataset.painted === key) return;
    mono.dataset.painted = key;
    mono.classList.remove('has-glyph', 'has-img');
    mono.textContent = icon.startsWith('txt:') ? icon.slice(4) : mono.dataset.letter;
    const slug = icon.startsWith('si:') ? icon.slice(3) : !icon && S.icons === 'glyph' ? slugFor(hostOf(url)) : '';
    if (isImage(icon)) {
      const img = new Image();
      img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.remove(); mono.classList.remove('has-img'); };
      img.src = icon;
      mono.append(img); mono.classList.add('has-img');
    } else if (slug) {
      glyph(slug).then(d => {
        if (!d || mono.dataset.painted !== key || !mono.isConnected) return;
        const svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
        path.setAttribute('d', d);
        svg.append(path);
        mono.append(svg); mono.classList.add('has-glyph');
      });
    }
  };
  const colorFor = (color, i) => `var(--${ACCENTS.includes(color) ? color : ACCENTS[i % ACCENTS.length]})`;
  const PENCIL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.8l2.7 2.7L6 12.7H3.3V10zM9 4.3l2.7 2.7"/></svg>';
  const decorate = () => {
    document.querySelectorAll('#bm-list li[data-id]').forEach((li, i) => {
      const bm = li.querySelector('.bm'), mono = bm && bm.querySelector('.mono');
      if (!mono) return;
      li.style.setProperty('--c', colorFor(bm.dataset.color, i));
      if (!mono.dataset.letter) mono.dataset.letter = mono.textContent;
      paint(mono, bm.dataset.icon || '', bm.dataset.url);
      if (!li.querySelector('.ed-btn')) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ed-btn'; b.innerHTML = PENCIL;
        b.setAttribute('aria-label', `Editar ${bm.textContent.trim()}`);
        b.addEventListener('click', () => openEditor(li.dataset.id, i));
        li.append(b);
      }
    });
  };
  new MutationObserver(decorate).observe($('bm-list'), { childList: true });

  // ---------- Favourite editor ----------
  const editor = $('editor'), edTile = $('ed-tile');
  const ed = { id: null, index: 0, kind: 'auto', color: 'auto', img: '' };
  const graphemes = (s, n) => {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter().segment(s)].slice(0, n).map(x => x.segment).join('');
    return Array.from(s).slice(0, n).join('');
  };
  // The icon string the agent accepts (see ICON_RE in server.py), or '' for "auto".
  const edIcon = () => {
    if (ed.kind === 'si') { const s = $('ed-slug').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64); return s ? `si:${s}` : ''; }
    if (ed.kind === 'txt') { const t = graphemes($('ed-txt').value.replace(/[\r\n]/g, '').trim(), 2); return t ? `txt:${t}` : ''; }
    if (ed.kind === 'img') return ed.img;
    return '';
  };
  const renderEditor = () => {
    $('ed-kind').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.val === ed.kind));
    $('ed-color').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.val === ed.color));
    editor.querySelectorAll('.ed-opt').forEach(r => { r.hidden = r.dataset.kind !== ed.kind; });
    $('ed-img').placeholder = ed.img.startsWith('data:') ? 'imagen subida ✓  (o pega una url)' : 'https://… url de la imagen';
    $('ed-bm').style.setProperty('--c', colorFor(ed.color === 'auto' ? '' : ed.color, ed.index));
    edTile.dataset.letter = $('ed-name').value.trim().charAt(0) || '•';
    paint(edTile, edIcon(), $('ed-url').value.trim());
  };
  const openEditor = (id, index) => {
    const b = window.homeBookmarks && window.homeBookmarks.get(id);
    if (!b) return;
    const icon = b.icon || '';
    Object.assign(ed, {
      id, index, color: b.color || 'auto', img: isImage(icon) ? icon : '',
      kind: icon.startsWith('si:') ? 'si' : icon.startsWith('txt:') ? 'txt' : isImage(icon) ? 'img' : 'auto',
    });
    $('ed-name').value = b.name || '';
    $('ed-url').value = b.url;
    $('ed-slug').value = ed.kind === 'si' ? icon.slice(3) : '';
    $('ed-txt').value = ed.kind === 'txt' ? icon.slice(4) : '';
    $('ed-img').value = ed.img && !ed.img.startsWith('data:') ? ed.img : '';
    setText('ed-msg', '');
    editor.hidden = false;
    renderEditor();
    $('ed-name').focus();
  };
  const closeEditor = () => { editor.hidden = true; ed.id = null; };
  // Uploaded pictures are cropped to a square and shrunk to 64 px so data.json stays small.
  const shrink = file => new Promise((resolve, reject) => {
    const img = new Image(), src = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'), side = 64, k = Math.min(img.naturalWidth, img.naturalHeight);
      c.width = c.height = side;
      c.getContext('2d').drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, 0, 0, side, side);
      URL.revokeObjectURL(src);
      let out = c.toDataURL('image/webp', .9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('bad image')); };
    img.src = src;
  });
  $('ed-kind').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ed.kind = b.dataset.val; renderEditor(); } });
  $('ed-color').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ed.color = b.dataset.val; renderEditor(); } });
  ['ed-name', 'ed-url', 'ed-slug', 'ed-txt'].forEach(id => $(id).addEventListener('input', renderEditor));
  $('ed-img').addEventListener('input', e => {
    const v = e.target.value.trim();
    if (/^https?:\/\/\S+$/.test(v)) ed.img = v;
    else if (v || !ed.img.startsWith('data:')) ed.img = '';
    renderEditor();
  });
  $('ed-upload').addEventListener('click', () => $('ed-file').click());
  $('ed-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !/^image\//.test(f.type)) return;
    try { ed.img = await shrink(f); $('ed-img').value = ''; setText('ed-msg', ''); }
    catch { setText('ed-msg', 'no se pudo leer la imagen'); }
    renderEditor();
  });
  $('ed-form').addEventListener('submit', e => {
    e.preventDefault();
    const icon = edIcon();
    if (ed.kind !== 'auto' && !icon) { setText('ed-msg', ed.kind === 'img' ? 'falta la imagen' : 'falta el icono'); return; }
    if (icon.length > 40100) { setText('ed-msg', 'imagen demasiado grande'); return; }
    try {
      window.homeBookmarks.update(ed.id, { name: $('ed-name').value, url: $('ed-url').value, icon, color: ed.color === 'auto' ? '' : ed.color });
      closeEditor();
    } catch { setText('ed-msg', 'url no válida'); }
  });
  $('ed-del').addEventListener('click', () => { window.homeBookmarks.remove(ed.id); closeEditor(); });
  $('ed-cancel').addEventListener('click', closeEditor);
  editor.addEventListener('pointerdown', e => { if (e.target === editor) closeEditor(); });
  // Keep app.js / theme.js shortcuts (1–0, F, U…) out of the dialog.
  editor.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  });

  // ---------- Settings sheet ----------
  const panel = $('settings'), gear = $('gear');
  const openPanel = open => {
    panel.hidden = !open;
    gear.setAttribute('aria-expanded', open);
  };
  gear.addEventListener('click', () => openPanel(panel.hidden));
  document.addEventListener('pointerdown', e => {
    if (!panel.hidden && !panel.contains(e.target) && !gear.contains(e.target)) openPanel(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) { openPanel(false); gear.focus(); }
  }, true);
  $('night-amt').addEventListener('input', e => { S.night = +e.target.value; apply(); save(); });
  $('field-amt').addEventListener('input', e => { S.field = +e.target.value; apply(); save(); redrawStill(); });
  $('name').addEventListener('input', e => {
    S.name = e.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 24);
    save(); tick(true); renderHost();
  });
  panel.querySelectorAll('.switch').forEach(sw => sw.addEventListener('click', () => {
    const k = sw.dataset.set;
    if (k === 'anim') { anim = !anim; store.set('terminal-anim', anim ? '1' : '0'); redrawStill(); }
    else { S[k] = !S[k]; save(); }
    apply(); tick(true); renderHost();
  }));
  panel.querySelectorAll('.segmented').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S[seg.dataset.set] = b.dataset.val; save(); apply();
    if (seg.dataset.set === 'icons') decorate();
  }));

  // ---------- Start ----------
  apply();
  tick();
  renderHost();
  decorate();
  setInterval(tick, 1000);
})();
