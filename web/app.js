(() => {
  // Served by the local agent → same origin. Loaded as a browser extension → talk to the agent directly.
  const API = location.protocol.startsWith('http') ? '' : 'http://127.0.0.1:47800';
  // Default location; override locally in config.json (served by the agent, git-ignored).
  let WX = { city: 'Madrid', region: 'Spain', lat: 40.4168, lon: -3.7038 };

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const setText = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };

  const fillSegs = (el, ratio) => {
    const n = +el.dataset.n;
    if (el.children.length !== n) el.innerHTML = '<i></i>'.repeat(n);
    const on = Math.round(Math.max(0, Math.min(1, ratio)) * n);
    [...el.children].forEach((s, i) => s.classList.toggle('on', i < on));
  };

  // ---------- Search ----------
  const form = $('search'), q = $('q');
  const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;
  const isUrlish = v => !/\s/.test(v) && URL_RE.test(v);
  const toUrl = v => /^https?:\/\//i.test(v) ? v : 'https://' + v;
  const googleUrl = v => 'https://www.google.com/search?q=' + encodeURIComponent(v);

  // Recent searches stay in this browser only (localStorage).
  const RECENT_KEY = 'home-recent';
  const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
  const writeRecent = r => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 50))); } catch {} };
  const remember = v => writeRecent([v, ...readRecent().filter(x => x.toLowerCase() !== v.toLowerCase())]);
  const forget = v => writeRecent(readRecent().filter(x => x !== v));

  form.addEventListener('submit', e => {
    const v = q.value.trim();
    closeSugg();
    if (!v) { e.preventDefault(); return; }
    // Looks like a URL → go there directly instead of searching.
    if (isUrlish(v)) { e.preventDefault(); location.href = toUrl(v); return; }
    remember(v);
  });

  // ---------- Autocomplete ----------
  const sugg = $('sugg');
  const remoteCache = new Map();
  let items = [], sel = -1, typed = '', reqId = 0, timer = 0;
  const ICONS = {
    google: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>',
    recent: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
    url: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  };
  const KIND = { google: 'Google', recent: 'Recent', bookmark: 'Bookmark', url: 'Go to' };

  const localMatches = v => {
    const lv = v.toLowerCase(), out = [];
    if (isUrlish(v)) out.push({ kind: 'url', text: v, url: toUrl(v) });
    data.bookmarks.filter(b => {
      const name = (b.name || '').toLowerCase(), host = hostOf(b.url);
      return name.split(/\s+/).some(w => w.startsWith(lv)) || host.startsWith(lv) || host.includes('.' + lv);
    }).slice(0, 3).forEach(b => out.push({ kind: 'bookmark', text: b.name || hostOf(b.url), sub: hostOf(b.url), url: b.url }));
    readRecent().filter(r => r.toLowerCase().startsWith(lv) && r.toLowerCase() !== lv)
      .slice(0, 2).forEach(r => out.push({ kind: 'recent', text: r }));
    return out;
  };
  const merge = (v, remote) => {
    const local = localMatches(v);
    const seen = new Set([v.toLowerCase(), ...local.map(i => i.text.toLowerCase())]);
    const g = remote.filter(s => !seen.has(s.toLowerCase())).map(text => ({ kind: 'google', text }));
    return [...local, ...g].slice(0, 8);
  };

  const ghostRest = () => {
    if (sel !== -1 || !typed.trim() || q.selectionStart !== q.value.length) return '';
    const lt = typed.toLowerCase();
    const it = items.find(i => (i.kind === 'google' || i.kind === 'recent')
      && i.text.toLowerCase().startsWith(lt) && i.text.length > typed.length);
    return it ? it.text.slice(typed.length) : '';
  };
  const renderGhost = () => {
    const rest = q.scrollWidth > q.clientWidth ? '' : ghostRest();
    $('ghost-typed').textContent = rest ? q.value : '';
    $('ghost-rest').textContent = rest;
  };
  const mark = () => {
    [...sugg.children].forEach((li, i) => li.setAttribute('aria-selected', i === sel));
    if (sel >= 0) q.setAttribute('aria-activedescendant', 'sugg-' + sel);
    else q.removeAttribute('aria-activedescendant');
  };
  const renderSugg = () => {
    sugg.textContent = '';
    const lv = typed.toLowerCase();
    items.forEach((it, i) => {
      const li = el('li');
      li.id = 'sugg-' + i;
      li.setAttribute('role', 'option');
      const ico = el('span', it.kind === 'bookmark' ? 's-ico mono' : 's-ico');
      if (it.kind === 'bookmark') ico.textContent = it.text.charAt(0);
      else ico.innerHTML = ICONS[it.kind];
      const txt = el('span', 's-text');
      if (it.kind !== 'bookmark' && lv && it.text.toLowerCase().startsWith(lv)) {
        txt.append(el('span', 'typed', it.text.slice(0, typed.length)), it.text.slice(typed.length));
      } else txt.textContent = it.text;
      if (it.sub) txt.append(el('span', 's-sub', it.sub));
      li.append(ico, txt, el('span', 's-kind', KIND[it.kind]));
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(it, e.ctrlKey || e.shiftKey || e.button === 1); });
      li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); renderGhost(); } });
      sugg.append(li);
    });
    sugg.hidden = !items.length;
    q.setAttribute('aria-expanded', items.length > 0);
    mark(); renderGhost();
  };
  function closeSugg() {
    clearTimeout(timer); reqId++;
    items = []; sel = -1;
    renderSugg();
  }

  const fetchRemote = async v => {
    if (remoteCache.has(v)) return remoteCache.get(v);
    try {
      const r = await fetch(`${API}/api/suggest?q=${encodeURIComponent(v)}`, { cache: 'no-store' });
      const j = r.ok ? await r.json() : [];
      if (Array.isArray(j)) { remoteCache.set(v, j); return j; }
    } catch {}
    return [];
  };
  const update = () => {
    typed = q.value; sel = -1;
    const v = typed.trim();
    if (!v) { closeSugg(); return; }
    items = merge(v, remoteCache.get(v) || []); // local results show instantly
    renderSugg();
    clearTimeout(timer);
    const id = ++reqId;
    timer = setTimeout(async () => {
      const remote = await fetchRemote(v);
      if (id !== reqId) return; // a newer keystroke won
      items = merge(v, remote);
      renderSugg();
    }, 120);
  };
  const choose = (it, newTab) => {
    closeSugg();
    if (it.url) { if (newTab) window.open(it.url, '_blank', 'noopener'); else location.href = it.url; return; }
    q.value = it.text;
    if (newTab) { remember(it.text); window.open(googleUrl(it.text), '_blank', 'noopener'); }
    else form.requestSubmit();
  };

  q.addEventListener('input', update);
  q.addEventListener('focus', () => { if (q.value.trim()) update(); });
  q.addEventListener('blur', closeSugg);
  q.addEventListener('keyup', e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') renderGhost(); });
  q.addEventListener('click', renderGhost);
  q.addEventListener('keydown', e => {
    const open = items.length > 0;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
      e.preventDefault();
      const n = items.length;
      sel = e.key === 'ArrowDown' ? (sel + 1 >= n ? -1 : sel + 1) : (sel - 1 < -1 ? n - 1 : sel - 1);
      q.value = sel === -1 || items[sel].kind === 'bookmark' ? typed : items[sel].text;
      mark(); renderGhost();
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      choose(items[sel], e.ctrlKey || e.shiftKey);
    } else if (e.key === 'Tab' || (e.key === 'ArrowRight' && q.selectionStart === q.value.length)) {
      const rest = ghostRest();
      if (rest) { e.preventDefault(); q.value += rest; update(); }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation();
      q.value = typed;
      closeSugg();
    } else if (e.key === 'Delete' && e.shiftKey && sel >= 0 && items[sel].kind === 'recent') {
      e.preventDefault();
      forget(items[sel].text);
      items.splice(sel, 1); sel = -1; q.value = typed;
      renderSugg();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    const typing = a && a.tagName === 'INPUT';
    if (e.key === 'Escape' && typing) { if (a === q) q.value = ''; a.blur(); return; }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); q.focus(); }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); $('todo-input').focus(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
    else if (/^[0-9]$/.test(e.key)) {
      const b = data.bookmarks[e.key === '0' ? 9 : +e.key - 1]; // 1–9, 0 = 10th
      if (b) location.href = b.url;
    }
  });

  // ---------- Fullscreen ----------
  // Element fullscreen (Fullscreen API), unlike F11, never reveals the browser's
  // toolbar / URL bar when the pointer reaches the screen edge.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  const renderFullscreen = () => {
    const on = !!document.fullscreenElement;
    $('ico-fs-on').hidden = on;
    $('ico-fs-off').hidden = !on;
    $('fs').setAttribute('aria-pressed', on);
    $('fs').setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
  };
  $('fs').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', renderFullscreen);

  // ---------- Clock ----------
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const isoWeek = d => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  };
  const clock = () => {
    const d = new Date();
    setText('hh', pad(d.getHours()));
    setText('mm', pad(d.getMinutes()));
    setText('day', DAYS[d.getDay()]);
    setText('date', `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`);
    setText('week', `WK ${pad(isoWeek(d))}`);
    $('rec').classList.toggle('off', d.getSeconds() % 2 === 1);
  };

  // ---------- Weather (Open-Meteo, no key) ----------
  const WMO = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Storm · hail', 99: 'Storm · hail',
  };
  let wxOk = false;
  const loadConfig = async () => {
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(`${API}/api/config`, { cache: 'no-store', signal: ctl.signal });
      const c = r.ok ? await r.json() : {};
      if (c.weather) WX = c.weather;
    } catch {}
    setText('wx-city', WX.city);
    setText('wx-region', WX.region || '');
  };
  const weather = async () => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${WX.lat}&longitude=${WX.lon}`
        + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min'
        + '&timezone=auto&forecast_days=1';
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      setText('wx-temp', `${Math.round(j.current.temperature_2m)}°`);
      setText('wx-desc', `${WMO[j.current.weather_code] ?? '—'} · H ${Math.round(j.daily.temperature_2m_max[0])}° L ${Math.round(j.daily.temperature_2m_min[0])}°`);
      wxOk = true;
    } catch {
      wxOk = false;
      setText('wx-desc', '[Error: no data]');
    }
    renderNetTag();
  };

  // ---------- Formatters ----------
  const rate = bps => {
    const kb = bps / 1024;
    if (kb < 1000) return [kb < 10 ? kb.toFixed(1) : Math.round(kb), 'KB/S'];
    const mb = kb / 1024;
    return [mb < 100 ? mb.toFixed(1) : Math.round(mb), 'MB/S'];
  };
  const dur = s => {
    s = Math.max(0, Math.floor(s));
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const uptime = s => {
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? `${d}D ${h}H ${pad(m)}M` : `${h}H ${pad(m)}M`;
  };
  const size = gb => gb >= 1000 ? `${(gb / 1024).toFixed(1)} TB` : `${Math.round(gb)} GB`;
  const shortCpu = n => (n || '').replace(/\((R|TM)\)/gi, '').replace(/\b(Processor|CPU|with Radeon.*|\d+-Core)\b/gi, '')
    .replace(/@.*$/, '').replace(/\s+/g, ' ').trim();

  // ---------- Network sparkline ----------
  const NET_N = 40;
  let netHist = Array(NET_N).fill(0);
  const renderSpark = () => {
    const max = Math.max(64 * 1024, ...netHist) * 1.15;
    const pts = netHist.map((v, i) => `${(i / (NET_N - 1) * 100).toFixed(2)},${(40 - v / max * 40).toFixed(2)}`).join(' ');
    $('spark').setAttribute('points', pts);
  };

  // ---------- Now playing ----------
  const BARS = 48;
  const wave = $('wave');
  wave.innerHTML = '<i></i>'.repeat(BARS);
  let waveH = Array.from({ length: BARS }, () => .2 + Math.random() * .8);
  let media = null, mediaAt = 0;
  const renderWave = playing => {
    if (playing) waveH = waveH.slice(1).concat(.15 + Math.random() * .85);
    [...wave.children].forEach((b, i) => { b.style.height = (playing ? waveH[i] * 100 : 6) + '%'; });
    wave.classList.toggle('idle', !playing);
  };
  const renderMedia = () => {
    const m = media;
    const has = !!(m && m.title);
    document.querySelectorAll('[data-media]').forEach(b => { b.disabled = !has; });
    $('np-title').classList.toggle('empty', !has);
    setText('np-title', has ? m.title : 'Nothing playing');
    setText('np-artist', has ? [m.artist, m.album].filter(Boolean).join(' · ') || '—' : '—');
    setText('np-label', has ? `${m.playing ? 'Now playing' : 'Paused'}${m.app ? ' · ' + m.app : ''}` : 'Now playing');
    $('ico-play').hidden = has && m.playing;
    $('ico-pause').hidden = !(has && m.playing);
    if (has && m.dur > 0) {
      const pos = Math.min(m.dur, m.pos + (m.playing ? (Date.now() - mediaAt) / 1000 : 0));
      setText('np-pos', dur(pos));
      setText('np-dur', dur(m.dur));
      $('np-bar').style.width = (pos / m.dur * 100).toFixed(2) + '%';
    } else {
      setText('np-pos', '--:--'); setText('np-dur', '--:--');
      $('np-bar').style.width = '0';
    }
  };
  document.querySelectorAll('[data-media]').forEach(b => b.addEventListener('click', async () => {
    try {
      await fetch(`${API}/api/media/${b.dataset.media}`, { method: 'POST', headers: { 'X-Home': '1' } });
      setTimeout(poll, 250);
    } catch {}
  }));

  // ---------- Stats ----------
  let agentOk = false;
  const renderNetTag = () => {
    const online = navigator.onLine && (wxOk || agentOk);
    const t = $('tag-net');
    t.textContent = online ? 'Online' : 'Offline';
    t.className = 'tag ' + (online ? 'ok' : 'err');
  };
  const renderAgentTag = () => {
    const t = $('tag-agent');
    t.textContent = agentOk ? 'Agent live' : 'Agent offline';
    t.className = 'tag ' + (agentOk ? '' : 'warn');
  };

  let stoBuilt = '';
  const renderStats = s => {
    // CPU
    const cpu = Math.round(s.cpu);
    setText('cpu', cpu);
    $('cpu-arc').setAttribute('stroke-dashoffset', (276.46 * (1 - cpu / 100)).toFixed(2));
    setText('cpu-name', `${shortCpu(s.cpuName)} · ${s.threads}T`);

    // Memory
    setText('mem', s.memUsed.toFixed(1));
    setText('mem-total', `/ ${Math.round(s.memTotal)} GB used`);
    fillSegs($('mem-segs'), s.memUsed / s.memTotal);

    // Network
    const [dv, du] = rate(s.down), [uv, uu] = rate(s.up);
    setText('net', dv); setText('net-unit', du);
    setText('net-up', `↑ ${uv} ${uu}`);
    setText('net-iface', s.iface || '—');
    netHist = netHist.slice(1).concat(s.down);
    renderSpark();

    // System
    setText('sys-host', s.host);
    setText('sys-up', uptime(s.uptime));
    setText('sys-ip', s.ip || '—');
    setText('sys-procs', s.procs);

    // Storage
    const disks = s.disks || [];
    const key = disks.map(d => d.name).join();
    const box = $('sto-rows');
    if (key !== stoBuilt) {
      box.innerHTML = disks.map(d => `<div class="sto-row"><div class="head"><span class="label">${d.name}</span><span class="v"></span></div><div class="segs" data-n="40"></div></div>`).join('');
      stoBuilt = key;
    }
    setText('sto-label', `Storage · ${size(disks.reduce((a, d) => a + d.total, 0))}`);
    [...box.children].forEach((row, i) => {
      const d = disks[i], r = d.used / d.total;
      const cls = r > .92 ? 'red' : r > .8 ? 'amber' : '';
      const v = row.querySelector('.v'), segs = row.querySelector('.segs');
      v.textContent = `${size(d.used)} / ${size(d.total)}`;
      v.className = 'v ' + cls;
      segs.className = 'segs ' + cls;
      fillSegs(segs, r);
    });

    // Status
    setText('tag-os', `${s.os} · ${s.build}`);
    const mbps = s.linkMbps;
    setText('tag-link', mbps ? `${/wi-?fi|wlan|inal/i.test(s.iface || '') ? 'WLAN' : 'ETH'} ${mbps >= 1000 ? (mbps / 1000).toFixed(1).replace('.0', '') + 'G' : mbps + 'M'}` : 'No link');

    // GPU
    const g = s.gpu;
    if (g) {
      setText('gpu-label', `GPU · ${g.name}`);
      setText('gpu', g.util);
      setText('gpu-eng', g.engine ? `${g.engine} · ` : '');
      fillSegs($('gpu-segs'), g.util / 100);
      const t = $('gpu-temp');
      t.textContent = `${g.temp}°C`;
      t.className = g.temp >= 85 ? 'crit' : g.temp >= 75 ? 'hot' : '';
      setText('gpu-vram', `${g.vramUsed.toFixed(1)} / ${Math.round(g.vramTotal)} GB VRAM`);
    }

    // Media
    media = s.media; mediaAt = Date.now();
    renderMedia();
  };

  const poll = async () => {
    try {
      const r = await fetch(`${API}/api/stats`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      agentOk = true;
      if (s.ts) renderStats(s);
      if (pendingSync && !saveTimer) pushRemote(); // edits made while the agent was down
    } catch {
      agentOk = false;
      setText('cpu-name', '[Agent offline]');
    }
    renderAgentTag();
    renderNetTag();
  };

  // ---------- Bookmarks + tasks (persisted by the agent in data.json, cached in localStorage) ----------
  const LS_KEY = 'home-data';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const DEFAULT_MARKS = [
    ['YouTube', 'https://www.youtube.com/'], ['Gmail', 'https://mail.google.com/'], ['GitHub', 'https://github.com/'],
    ['Claude', 'https://claude.ai/'], ['X', 'https://x.com/'], ['Reddit', 'https://www.reddit.com/'],
  ].map(([name, url]) => ({ id: uid(), name, url }));

  let data = { bookmarks: [], todos: [] };
  let pendingSync = false, saveTimer = 0;

  const valid = d => d && Array.isArray(d.bookmarks) && Array.isArray(d.todos);
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
  const writeLocal = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {} };

  const pushRemote = async () => {
    saveTimer = 0;
    try {
      const r = await fetch(`${API}/api/data`, {
        method: 'PUT', headers: { 'X-Home': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      pendingSync = !r.ok;
    } catch { pendingSync = true; }
  };
  const save = () => {
    writeLocal();
    pendingSync = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushRemote, 250);
  };
  const loadData = async () => {
    let remote = null;
    try {
      const r = await fetch(`${API}/api/data`, { cache: 'no-store' });
      if (r.ok) remote = await r.json();
    } catch {}
    if (valid(remote)) {
      data = remote;
      writeLocal();
    } else {
      const local = readLocal();
      data = valid(local) ? local : { bookmarks: DEFAULT_MARKS, todos: [] };
      if (remote) save(); // agent reachable but no data.json yet → seed it
    }
    renderTodos(); renderMarks();
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const ICON_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const delBtn = (cls, label) => {
    const x = el('button', cls);
    x.innerHTML = ICON_X;
    x.setAttribute('aria-label', label);
    x.dataset.act = 'del';
    return x;
  };

  // Tasks
  const renderTodos = () => {
    const list = $('todo-list');
    list.textContent = '';
    for (const t of data.todos) {
      const li = el('li', t.done ? 'done' : '');
      li.dataset.id = t.id;
      const chk = el('button', 'chk');
      chk.innerHTML = ICON_CHECK;
      chk.setAttribute('role', 'checkbox');
      chk.setAttribute('aria-checked', t.done);
      chk.setAttribute('aria-label', t.text);
      chk.dataset.act = 'toggle';
      const txt = el('span', 'task-text', t.text);
      li.append(chk, txt, delBtn('x', 'Borrar tarea'));
      list.append(li);
    }
    const total = data.todos.length, done = data.todos.filter(t => t.done).length;
    setText('todo-count', `${done}/${total}`);
    fillSegs($('todo-segs'), total ? done / total : 0);
    $('todo-clear').hidden = !done;
    $('todo-empty').hidden = total > 0;
  };
  const findTodo = node => data.todos.find(t => t.id === node.closest('li').dataset.id);

  $('todo-form').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('todo-input'), v = inp.value.trim();
    if (!v) return;
    data.todos.unshift({ id: uid(), text: v, done: false, created: Date.now() });
    inp.value = '';
    save(); renderTodos();
  });
  $('todo-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = findTodo(b);
    if (!t) return;
    if (b.dataset.act === 'toggle') t.done = !t.done;
    else data.todos = data.todos.filter(x => x !== t);
    save(); renderTodos();
  });
  $('todo-list').addEventListener('dblclick', e => {
    const span = e.target.closest('.task-text');
    if (!span) return;
    const t = findTodo(span);
    const inp = el('input', 'task-edit');
    inp.value = t.text;
    inp.maxLength = 500;
    inp.setAttribute('aria-label', 'Editar tarea');
    span.replaceWith(inp);
    inp.focus(); inp.select();
    let closed = false;
    const finish = commit => {
      if (closed) return;
      closed = true;
      const v = inp.value.trim();
      if (commit && v && v !== t.text) { t.text = v; save(); }
      renderTodos();
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
  });
  $('todo-clear').addEventListener('click', () => {
    data.todos = data.todos.filter(t => !t.done);
    save(); renderTodos();
  });

  // Bookmarks
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const normUrl = v => {
    v = v.trim();
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    const u = new URL(v); // throws on garbage
    if (!/^https?:$/.test(u.protocol) || !(u.hostname.includes('.') || u.hostname === 'localhost')) throw new Error('bad url');
    return u.href;
  };
  const nameFrom = url => {
    const parts = hostOf(url).split('.');
    const base = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  };
  const renderMarks = () => {
    const list = $('bm-list');
    list.textContent = '';
    data.bookmarks.forEach((b, i) => {
      if (!/^https?:\/\//i.test(b.url)) return;
      const li = el('li');
      li.dataset.id = b.id;
      // Not an <a href>: links make the browser pop its URL status bar on hover.
      const a = el('div', 'bm');
      a.setAttribute('role', 'link');
      a.tabIndex = 0;
      a.dataset.url = b.url;
      const name = b.name || hostOf(b.url);
      const txt = el('span', 'bm-text');
      txt.append(el('span', 'bm-name', name), el('span', 'bm-host', hostOf(b.url)));
      a.append(el('span', 'mono', name.trim().charAt(0) || '•'), txt);
      const grip = el('span', 'grip');
      grip.setAttribute('aria-hidden', 'true');
      li.append(a, el('span', 'key', String(i + 1)), grip, delBtn('x bm-x', `Borrar ${name}`));
      list.append(li);
    });
    setText('bm-count', data.bookmarks.length);
    $('bm-empty').hidden = data.bookmarks.length > 0;
  };

  const bmForm = $('bm-form'), bmAdd = $('bm-add');
  const toggleBmForm = open => {
    bmForm.hidden = !open;
    bmAdd.setAttribute('aria-expanded', open);
    setText('bm-msg', '');
    if (open) $('bm-url').focus(); else bmForm.reset();
  };
  bmAdd.addEventListener('click', () => toggleBmForm(bmForm.hidden));
  $('bm-cancel').addEventListener('click', () => toggleBmForm(false));
  bmForm.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); toggleBmForm(false); } });
  bmForm.addEventListener('submit', e => {
    e.preventDefault();
    let url;
    try { url = normUrl($('bm-url').value); } catch { setText('bm-msg', '[Invalid URL]'); return; }
    data.bookmarks.push({ id: uid(), name: $('bm-name').value.trim() || nameFrom(url), url });
    save(); renderMarks();
    toggleBmForm(false);
  });
  const openMark = (url, newTab) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (newTab) window.open(url, '_blank', 'noopener');
    else location.href = url;
  };
  $('bm-list').addEventListener('auxclick', e => {
    const m = e.target.closest('.bm');
    if (m && e.button === 1) { e.preventDefault(); openMark(m.dataset.url, true); }
  });
  // Reorder: Alt+↑/↓ on a focused bookmark.
  const moveMark = (id, delta) => {
    const i = data.bookmarks.findIndex(b => b.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= data.bookmarks.length) return;
    const list = data.bookmarks.slice();
    [list[i], list[j]] = [list[j], list[i]];
    data.bookmarks = list;
    save(); renderMarks();
    $('bm-list').querySelector(`li[data-id="${id}"] .bm`)?.focus();
  };
  $('bm-list').addEventListener('keydown', e => {
    const m = e.target.closest('.bm');
    if (!m) return;
    if (e.key === 'Enter') openMark(m.dataset.url, e.ctrlKey || e.metaKey);
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveMark(m.closest('li').dataset.id, e.key === 'ArrowUp' ? -1 : 1);
    }
  });

  // Reorder: drag with the mouse. A 6px threshold keeps plain clicks as clicks;
  // an orange marker shows where the bookmark will land.
  const bmList = $('bm-list');
  let drag = null, suppressClick = false;
  const endDrag = commit => {
    const d = drag;
    drag = null;
    if (!d || !d.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    bmList.classList.remove('is-dragging');
    d.li.classList.remove('dragging');
    if (commit && d.marker.parentNode) {
      bmList.insertBefore(d.li, d.marker);
      const order = [...bmList.querySelectorAll('li[data-id]')].map(li => li.dataset.id);
      const byId = new Map(data.bookmarks.map(b => [b.id, b]));
      const next = order.map(id => byId.get(id)).filter(Boolean);
      if (next.length === data.bookmarks.length && next.some((b, i) => b !== data.bookmarks[i])) {
        data.bookmarks = next;
        save();
      }
    }
    d.marker.remove();
    renderMarks();
  };
  bmList.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('[data-act="del"]')) return;
    const li = e.target.closest('li[data-id]');
    if (li) drag = { li, startY: e.clientY, pointerId: e.pointerId, active: false };
  });
  bmList.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 6) return;
      drag.active = true;
      drag.marker = el('li', 'drop-marker');
      drag.marker.setAttribute('aria-hidden', 'true');
      bmList.setPointerCapture(drag.pointerId);
      bmList.classList.add('is-dragging');
      drag.li.classList.add('dragging');
    }
    e.preventDefault();
    const box = bmList.getBoundingClientRect();
    if (e.clientY < box.top + 28) bmList.scrollTop -= 8;
    else if (e.clientY > box.bottom - 28) bmList.scrollTop += 8;
    const before = [...bmList.querySelectorAll('li[data-id]')].find(li => {
      const r = li.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (before) { if (drag.marker.nextSibling !== before) bmList.insertBefore(drag.marker, before); }
    else if (bmList.lastChild !== drag.marker) bmList.append(drag.marker);
  });
  bmList.addEventListener('pointerup', () => endDrag(true));
  bmList.addEventListener('pointercancel', () => endDrag(false));
  document.addEventListener('keydown', e => { if (drag && drag.active && e.key === 'Escape') endDrag(false); }, true);

  bmList.addEventListener('click', e => {
    if (suppressClick) return;
    const m = e.target.closest('.bm');
    if (m) { openMark(m.dataset.url, e.ctrlKey || e.metaKey || e.shiftKey); return; }
    const b = e.target.closest('[data-act="del"]');
    if (!b) return;
    const id = b.closest('li').dataset.id;
    data.bookmarks = data.bookmarks.filter(x => x.id !== id);
    save(); renderMarks();
  });

  // Another tab (or the extension) may have changed things → refresh when we come back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !pendingSync && !document.querySelector('.task-edit')) loadData();
  });

  // ---------- Loops ----------
  loadData();
  q.focus(); // after everything above exists (focus may trigger autocomplete)

  // Switching tabs / windows: leaving releases the search box (no caret left
  // blinking, no highlighted card); coming back puts the caret straight in it —
  // unless you were in another field (task, bookmark form), which keeps focus.
  let restoreSearch = true;
  const leave = () => {
    if (document.activeElement === q) { restoreSearch = true; q.blur(); }
    else restoreSearch = !document.activeElement || document.activeElement === document.body;
  };
  const enter = () => {
    if (document.visibilityState !== 'visible' || !restoreSearch) return;
    const a = document.activeElement;
    if (!a || a === document.body) q.focus({ preventScroll: true });
  };
  addEventListener('blur', leave);
  addEventListener('focus', enter);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? enter() : leave()));
  clock(); loadConfig().then(weather); poll(); renderSpark(); renderMedia(); renderWave(false);
  setInterval(clock, 1000);
  setInterval(poll, 1000);
  setInterval(() => { renderMedia(); }, 250);
  setInterval(() => renderWave(!!(media && media.playing)), 140);
  setInterval(weather, 15 * 60 * 1000);
  addEventListener('online', weather);
  addEventListener('offline', renderNetTag);
})();
