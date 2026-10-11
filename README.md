# Home / System 01

Página de inicio / nueva pestaña para Windows, a pantalla completa y en modo oscuro, con estética **dot‑matrix monocroma** (inspirada en el lenguaje visual de Nothing). Muestra datos **reales** de tu PC gracias a un pequeño agente local en Python.

## Qué incluye

| Tarjeta | Fuente |
|---|---|
| Buscador de Google (o abre directamente una URL) | — |
| Reloj dot‑matrix, día, fecha y semana | navegador |
| CPU (anillo), memoria, discos | `psutil` |
| GPU: uso igual que el Administrador de tareas, temperatura, VRAM | contadores PDH de Windows + `nvidia-smi` |
| Red: bajada / subida en vivo con sparkline | `psutil` |
| Sistema: host, uptime, IP local, procesos | `psutil` |
| Now playing con anterior / pausa / siguiente | controles multimedia de Windows (SMTC); si Spotify no publica ahí, se lee el título de su ventana y se controla con las teclas multimedia |
| Clima (por defecto Madrid) | [Open‑Meteo](https://open-meteo.com) (sin API key) |
| Tareas: añadir, completar, editar con doble clic, limpiar hechas | `data.json` vía el agente |
| Marcadores con atajos `1`–`9` | `data.json` vía el agente |

Atajos (fuera de un campo de texto): `/` buscar · `T` nueva tarea · `1`–`9` abrir marcador · `Esc` salir del campo.

## Requisitos

- Windows 10/11
- Python 3.10+
- GPU NVIDIA opcional (para temperatura y VRAM; el % de uso funciona con cualquier GPU)

## Instalación

```powershell
git clone https://github.com/ak1ta4/home-dashboard.git
cd home-dashboard
python -m pip install --user -r requirements.txt
python server.py
```

Abre <http://127.0.0.1:47800>.

### Arrancar con Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

Crea el acceso directo `Home Agent` en `shell:startup`, que lanza `pythonw server.py` sin ventana. Para quitarlo, borra ese acceso directo.

### Usarlo en el navegador

- **Página de inicio** (cualquier navegador): pon `http://127.0.0.1:47800` como página de inicio.
- **Nueva pestaña**: la carpeta `web/` es también una extensión (Manifest V3) que sustituye la nueva pestaña.
  - Chrome / Edge / Brave: `chrome://extensions` → modo desarrollador → *Cargar descomprimida* → selecciona `web/`.
  - Firefox: solo instala de forma permanente extensiones firmadas. Puedes firmarla gratis como *unlisted* en [addons.mozilla.org](https://addons.mozilla.org/developers/) (o con `web-ext sign`), o cargarla temporalmente desde `about:debugging`.

## Configuración

- **Ubicación del clima**: edita `WX` al principio de `web/app.js` (latitud / longitud) y el nombre de la ciudad en `web/index.html`.
- **Puerto**: variable de entorno `HOME_PORT` (por defecto `47800`). Si lo cambias, actualiza también `API` en `web/app.js` para la versión extensión.

## Seguridad

- El agente solo escucha en `127.0.0.1` y rechaza peticiones con otra cabecera `Host` (protección contra DNS rebinding).
- Las escrituras (`PUT /api/data`, `POST /api/media/*`) exigen la cabecera `X-Home: 1`, lo que fuerza un preflight CORS que solo se acepta para orígenes `moz-extension://` y `chrome-extension://`. Otras webs no pueden leer tus datos ni controlar tu música.
- Los marcadores solo aceptan URLs `http(s)`.
- `data.json` (tus tareas y marcadores) está en `.gitignore`.

## Estructura

```
server.py              agente local: estáticos + /api/stats, /api/data, /api/media/*
install-autostart.ps1  acceso directo en el Inicio de Windows
requirements.txt
web/
  index.html  style.css  app.js
  manifest.json        para usar web/ como extensión de nueva pestaña
```

---

Proyecto personal sin afiliación con Nothing Technology Ltd. Fuentes: Doto, Space Grotesk y Space Mono (Google Fonts, OFL).
