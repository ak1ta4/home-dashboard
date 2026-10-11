"""Home / System 01 — local agent.

Serves the dashboard from ./web and exposes real machine stats on
http://127.0.0.1:47800/api/stats. Only listens on loopback.

Run:  pythonw server.py   (no console window)
"""
import asyncio
import ctypes
import json
import os
import platform
import re
import socket
import subprocess
import threading
import time
import winreg
from ctypes import wintypes
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

import psutil

PORT = int(os.environ.get("HOME_PORT", "47800"))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
EXT_SCHEMES = ("moz-extension://", "chrome-extension://")


def web_origins():
    """Extra https origins allowed to call the agent (config.json "origins"),
    e.g. the GitHub Pages copy of the dashboard."""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return {o.rstrip("/") for o in json.load(f).get("origins", [])
                    if isinstance(o, str) and o.startswith("https://")}
    except (OSError, ValueError, AttributeError):
        return set()
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
MAX_BODY = 512 * 1024


def load_config():
    """Local, git-ignored settings (see config.example.json). Only the weather block is exposed."""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            w = json.load(f).get("weather") or {}
        return {"weather": {
            "city": str(w["city"])[:60], "region": str(w.get("region", ""))[:60],
            "lat": float(w["lat"]), "lon": float(w["lon"]),
        }}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


_suggest_cache = {}


def google_suggest(q):
    """Google's public autocomplete endpoint. The page can't call it directly (no CORS)."""
    if q in _suggest_cache:
        return _suggest_cache[q]
    url = "https://suggestqueries.google.com/complete/search?" + urlencode(
        {"client": "firefox", "hl": "es", "ie": "utf-8", "oe": "utf-8", "q": q})
    try:
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=2) as r:
            out = [s for s in json.loads(r.read().decode("utf-8", "replace"))[1] if isinstance(s, str)][:8]
    except Exception:
        return []
    if len(_suggest_cache) > 300:
        _suggest_cache.clear()
    _suggest_cache[q] = out
    return out

GB = 1024 ** 3
state = {}
lock = threading.Lock()
data_lock = threading.Lock()


def load_data():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def clean_data(d):
    """Keep only the expected shape so a bad client can't write arbitrary blobs."""
    if not isinstance(d, dict):
        raise ValueError("bad payload")
    s = lambda v, n: str(v)[:n] if v is not None else ""
    marks = [
        {"id": s(b.get("id"), 40), "name": s(b.get("name"), 80), "url": s(b.get("url"), 2000)}
        for b in d.get("bookmarks", [])[:200]
        if isinstance(b, dict) and str(b.get("url", "")).startswith(("http://", "https://"))
    ]
    todos = [
        {"id": s(t.get("id"), 40), "text": s(t.get("text"), 500), "done": bool(t.get("done")),
         "created": int(t.get("created") or 0)}
        for t in d.get("todos", [])[:500]
        if isinstance(t, dict) and str(t.get("text", "")).strip()
    ]
    return {"bookmarks": marks, "todos": todos}


def save_data(d):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)


def cpu_name():
    try:
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        return winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
    except OSError:
        return platform.processor()


def primary_iface():
    """Interface that holds the default route's local IP."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("1.1.1.1", 80))
            ip = s.getsockname()[0]
    except OSError:
        return None, None, 0
    stats = psutil.net_if_stats()
    for name, addrs in psutil.net_if_addrs().items():
        if any(a.address == ip for a in addrs):
            st = stats.get(name)
            return name, ip, (st.speed if st else 0)
    return None, ip, 0


class GpuLoad:
    """GPU % exactly like Task Manager: per-engine utilization summed over
    processes (PDH "GPU Engine" counters), then the busiest engine wins.
    nvidia-smi's utilization.gpu is a different, coarser metric."""

    PDH_FMT_DOUBLE = 0x200
    PDH_MORE_DATA = 0x800007D2
    INST = re.compile(r"luid_(\w+?_\w+?)_phys_(\d+)_eng_(\d+)_engtype_(\w+)", re.I)

    class _Value(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("long", ctypes.c_long), ("double", ctypes.c_double),
                        ("large", ctypes.c_longlong), ("ptr", ctypes.c_void_p)]
        _fields_ = [("CStatus", wintypes.DWORD), ("u", _U)]

    class _Item(ctypes.Structure):
        pass

    _Item._fields_ = [("szName", wintypes.LPWSTR), ("FmtValue", _Value)]

    def __init__(self):
        self.pdh = ctypes.WinDLL("pdh")
        self.query = ctypes.c_void_p()
        self.counter = ctypes.c_void_p()
        if self.pdh.PdhOpenQueryW(None, 0, ctypes.byref(self.query)):
            raise OSError("PdhOpenQuery failed")
        if self.pdh.PdhAddEnglishCounterW(self.query, r"\GPU Engine(*)\Utilization Percentage", 0,
                                          ctypes.byref(self.counter)):
            raise OSError("GPU Engine counters unavailable")
        self.pdh.PdhCollectQueryData(self.query)  # rate counter: first sample primes it

    def read(self):
        if self.pdh.PdhCollectQueryData(self.query):
            return None
        size, count = wintypes.DWORD(0), wintypes.DWORD(0)
        rc = self.pdh.PdhGetFormattedCounterArrayW(self.counter, self.PDH_FMT_DOUBLE,
                                                   ctypes.byref(size), ctypes.byref(count), None)
        if rc & 0xFFFFFFFF != self.PDH_MORE_DATA:
            return None
        buf = (ctypes.c_byte * size.value)()
        if self.pdh.PdhGetFormattedCounterArrayW(self.counter, self.PDH_FMT_DOUBLE, ctypes.byref(size),
                                                 ctypes.byref(count), buf):
            return None
        items = ctypes.cast(buf, ctypes.POINTER(self._Item))
        engines = {}
        for i in range(count.value):
            it = items[i]
            if it.FmtValue.CStatus not in (0, 1):  # VALID / NEW data only
                continue
            m = self.INST.search(it.szName or "")
            if m:
                key = m.groups()
                engines[key] = engines.get(key, 0.0) + it.FmtValue.u.double
        if not engines:
            return 0.0, None
        (_, _, _, kind), top = max(engines.items(), key=lambda kv: kv[1])
        return min(100.0, top), kind.upper()


def gpu():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3, creationflags=NO_WINDOW,
        ).stdout.strip().splitlines()[0]
        name, util, temp, used, total = [x.strip() for x in out.split(",")]
        return {"name": name.replace("NVIDIA GeForce ", ""), "util": int(util), "temp": int(temp),
                "vramUsed": int(used) / 1024, "vramTotal": int(total) / 1024}
    except Exception:
        return None


STATIC = {
    "host": socket.gethostname(),
    "os": f"Windows {platform.release()}",
    "build": platform.version().split(".")[-1],
    "cpuName": cpu_name(),
    "threads": psutil.cpu_count(),
}


def sample_loop():
    psutil.cpu_percent(interval=None)
    last = psutil.net_io_counters()
    last_t = time.time()
    tick = 0
    gpu_info = gpu()
    try:
        gpu_load = GpuLoad()
    except OSError:
        gpu_load = None  # fall back to nvidia-smi's utilization
    iface = primary_iface()
    while True:
        time.sleep(1)
        now = time.time()
        net = psutil.net_io_counters()
        dt = max(now - last_t, 1e-6)
        down = (net.bytes_recv - last.bytes_recv) / dt
        up = (net.bytes_sent - last.bytes_sent) / dt
        last, last_t = net, now

        if tick % 3 == 0:
            gpu_info = gpu()
        if tick % 15 == 0:
            iface = primary_iface()
        tick += 1

        if gpu_info and gpu_load:
            r = gpu_load.read()
            if r:
                gpu_info = {**gpu_info, "util": round(r[0]), "engine": r[1]}

        vm = psutil.virtual_memory()
        disks = []
        for p in psutil.disk_partitions():
            if "cdrom" in p.opts or not p.fstype:
                continue
            try:
                u = psutil.disk_usage(p.mountpoint)
            except OSError:
                continue
            disks.append({"name": p.device.rstrip("\\"), "used": u.used / GB, "total": u.total / GB})

        with lock:
            state.update({
                **STATIC,
                "cpu": psutil.cpu_percent(interval=None),
                "memUsed": vm.used / GB,
                "memTotal": vm.total / GB,
                "disks": disks,
                "down": down,
                "up": up,
                "uptime": int(now - psutil.boot_time()),
                "procs": len(psutil.pids()),
                "iface": iface[0], "ip": iface[1], "linkMbps": iface[2],
                "gpu": gpu_info,
                "ts": now,
            })


# ---------- Media (Windows global media session) ----------
media_loop = asyncio.new_event_loop()


_mgr = None
PLAYING = 4  # GlobalSystemMediaTransportControlsSessionPlaybackStatus.PLAYING


async def _sessions():
    """Current session first, then the rest. The manager is cached."""
    global _mgr
    if _mgr is None:
        from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as M
        _mgr = await M.request_async()
    cur = _mgr.get_current_session()
    rest = [s for s in _mgr.get_sessions()
            if not cur or s.source_app_user_model_id != cur.source_app_user_model_id]
    return ([cur] if cur else []) + rest


def _app_name(aumid):
    name = (aumid or "").split("!")[-1].replace(".exe", "")
    if re.fullmatch(r"[0-9A-F]{16}", name):  # Firefox registers under a hash AUMID
        return "Firefox"
    return {"msedge": "Edge", "chrome": "Chrome"}.get(name.lower(), name)


async def _session_info(s):
    props = await s.try_get_media_properties_async()
    tl = s.get_timeline_properties()
    playing = int(s.get_playback_info().playback_status) == PLAYING
    pos = tl.position.total_seconds() if tl.position else 0
    dur = tl.end_time.total_seconds() if tl.end_time else 0
    upd = tl.last_updated_time
    if playing and upd and upd.year > 1601:
        pos += (datetime.now(timezone.utc) - upd).total_seconds()
    return {
        "title": props.title or "", "artist": props.artist or "", "album": props.album_title or "",
        "app": _app_name(s.source_app_user_model_id), "playing": playing,
        "pos": max(0, min(pos, dur)) if dur else 0, "dur": dur, "source": "smtc",
    }


# --- Spotify fallback: when Spotify doesn't publish to Windows media controls,
# its main window title is "Artist - Song" while playing and "Spotify …" when paused.
user32 = ctypes.WinDLL("user32")
_EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
_spotify = {"pids": set(), "pids_at": 0.0, "last": None}


def _window_titles(pids):
    titles = []

    def cb(hwnd, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                titles.append(buf.value)
        return True

    user32.EnumWindows(_EnumProc(cb), 0)
    return titles


def _spotify_info():
    now = time.time()
    if now - _spotify["pids_at"] > 5:
        _spotify["pids"] = {p.pid for p in psutil.process_iter(["name"])
                            if (p.info["name"] or "").lower() == "spotify.exe"}
        _spotify["pids_at"] = now
    if not _spotify["pids"]:
        _spotify["last"] = None
        return None
    titles = _window_titles(_spotify["pids"])
    track = next((t for t in titles if " - " in t), None)
    if track:
        artist, title = track.split(" - ", 1)
        _spotify["last"] = (title, artist)
        playing = True
    elif any(t.startswith("Spotify") for t in titles) and _spotify["last"]:
        title, artist = _spotify["last"]
        playing = False
    else:
        return None
    return {"title": title, "artist": artist, "album": "", "app": "Spotify", "playing": playing,
            "pos": 0, "dur": 0, "source": "window"}


async def _media_info():
    infos = []
    for s in await _sessions():
        try:
            infos.append(await _session_info(s))
        except Exception:
            pass
    infos = [i for i in infos if i["title"]]
    if not any(i["app"] == "Spotify" for i in infos):
        sp = _spotify_info()
        if sp:
            infos.append(sp)
    # Prefer whatever is actually playing; otherwise the first (current) one.
    return next((i for i in infos if i["playing"]), infos[0] if infos else None)


VK_MEDIA = {"toggle": 0xB3, "next": 0xB0, "prev": 0xB1}


def _media_key(action):
    vk = VK_MEDIA.get(action)
    if vk is None:
        return False
    user32.keybd_event(vk, 0, 1, 0)      # KEYEVENTF_EXTENDEDKEY
    user32.keybd_event(vk, 0, 1 | 2, 0)  # + KEYEVENTF_KEYUP
    return True


async def _media_action(action):
    with lock:
        shown = state.get("media")
    if shown and shown.get("source") == "window":
        return _media_key(action)  # Spotify without media controls → global media keys
    for s in await _sessions():
        if shown and _app_name(s.source_app_user_model_id) != shown.get("app"):
            continue
        fn = {"toggle": s.try_toggle_play_pause_async, "next": s.try_skip_next_async,
              "prev": s.try_skip_previous_async}.get(action)
        return bool(fn and await fn())
    return _media_key(action)


def media_poll():
    asyncio.set_event_loop(media_loop)

    async def loop():
        while True:
            try:
                info = await _media_info()
            except Exception:
                info = None
            with lock:
                state["media"] = info
            await asyncio.sleep(1)

    media_loop.run_until_complete(loop())


def media_action(action):
    fut = asyncio.run_coroutine_threadsafe(_media_action(action), media_loop)
    try:
        return fut.result(timeout=3)
    except Exception:
        return False


# ---------- HTTP ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, *a):
        pass

    def _host_ok(self):
        return self.headers.get("Host", "") in ALLOWED_HOSTS

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith(EXT_SCHEMES) or origin in web_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "X-Home, Content-Type")
            # Chrome asks before a public site may reach 127.0.0.1 (Private Network Access).
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT")
        self.end_headers()

    def do_GET(self):
        if not self._host_ok():
            return self.send_error(403)
        if self.path.startswith("/api/stats"):
            with lock:
                return self._json(200, dict(state))
        if self.path.startswith("/api/data"):
            with data_lock:
                return self._json(200, load_data())
        if self.path.startswith("/api/config"):
            return self._json(200, load_config())
        if self.path.startswith("/api/suggest"):
            q = parse_qs(urlparse(self.path).query).get("q", [""])[0].strip()[:200]
            return self._json(200, google_suggest(q) if q else [])
        return super().do_GET()

    def do_PUT(self):
        if not self._host_ok() or self.headers.get("X-Home") != "1":
            return self.send_error(403)
        if not self.path.startswith("/api/data"):
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self.send_error(413)
        try:
            d = clean_data(json.loads(self.rfile.read(n)))
        except (ValueError, TypeError, AttributeError):
            return self.send_error(400)
        with data_lock:
            save_data(d)
        return self._json(200, {"ok": True})

    def do_POST(self):
        # Custom header forces a CORS preflight, so random websites can't drive this.
        if not self._host_ok() or self.headers.get("X-Home") != "1":
            return self.send_error(403)
        if self.path.startswith("/api/media/"):
            ok = media_action(self.path.rsplit("/", 1)[-1])
            return self._json(200, {"ok": ok})
        self.send_error(404)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    threading.Thread(target=sample_loop, daemon=True).start()
    threading.Thread(target=media_poll, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
