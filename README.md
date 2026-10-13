# Home / System 01

Página de inicio / nueva pestaña para Windows, a pantalla completa y en modo oscuro, con estética **dot‑matrix monocroma** (inspirada en el lenguaje visual de Nothing). Muestra datos **reales** de tu PC gracias a un pequeño agente local en Python.

![Dashboard en el navegador (datos de demostración)](docs/dashboard.png)

**Demo en vivo:** <https://ak1ta4.github.io/home-dashboard/?demo> (datos ficticios, no necesita el agente).

<details>
<summary>Versión wallpaper para Wallpaper Engine</summary>

![Wallpaper (datos de demostración)](docs/wallpaper.png)

</details>

## Tema «terminal»

Segundo aspecto para el mismo dashboard (`web/terminal.html`): una mezcla de lo acogedor de macOS con un escritorio Linux tuneado — cristal esmerilado, paleta gruvbox y JetBrains Mono.

- Fondo generativo, sin imágenes: un campo de caracteres ASCII que sube despacio como humo sobre brasas (ruido con *domain warping* dibujado en un canvas a ~12 fps, desde un atlas de glifos), más cálido abajo y con un poco de luz bajo el ratón.
- Reloj en mono fina (sin segundos, 24 h o 12 h), la fecha en minúsculas y un saludo que se escribe solo con cursor de terminal: «buenos días», «buenas tardes», «buenas noches» o «dulces sueños», con tu nombre si lo pones.
- Una ventana de terminal con los semáforos de macOS y `usuario@equipo: ~` en la barra: el prompt `❯` es el buscador (el mismo autocompletado de siempre) y debajo, como un `ls ~/favoritos`, tus favoritos. Cada uno lleva el glifo de su marca ([Simple Icons](https://simpleicons.org)) o su inicial, teñido con un color gruvbox. Atajos `1`–`0` (los números no se muestran), arrastrar para reordenar, `+` en la barra para añadir y, al pasar el ratón, ✎ para editar y × para borrar.
- Editor de favoritos: nombre, URL, icono (automático, un glifo de Simple Icons por su nombre, una imagen por URL o subida —se recorta a 64 px— o un texto / emoji de hasta dos caracteres) y color. Se guarda en `data.json` como el resto de favoritos.
- Abajo, una barra de sistema tipo neofetch (equipo, uptime, IP y procesos, del agente; se oculta sin agente).
- Luz nocturna: una capa cálida (multiplicada) sobre toda la página, como el filtro de luz nocturna del sistema.
- Ajustes (arriba a la izquierda): intensidad de la luz nocturna y de las brasas, tu nombre, formato de 24 h, iconos glifo / inicial, barra de sistema y animaciones. `F` sigue poniendo pantalla completa.

Los glifos se descargan de jsDelivr (`simple-icons`) la primera vez y se guardan en el navegador; con «inicial» no se hace ninguna petición. Fuente: JetBrains Mono (Google Fonts, OFL).

Pulsa `U` (fuera de un campo de texto) para cambiar entre «nothing» y «terminal»; la elección se recuerda y `index.html` redirige al tema elegido (abrir `terminal.html` directamente también cuenta como elección). También vale `?theme=terminal` o `?theme=nothing` en la URL; en Wallpaper Engine, que tiene su propio almacenamiento, cambia en `wallpaper/index.html` la dirección a `/?mode=wallpaper&theme=terminal`. Wallpaper Engine guarda sus ajustes aparte de los del navegador.

## Qué incluye

| Tarjeta | Fuente |
|---|---|
| Buscador de Google con autocompletado: sugerencias de Google, tus marcadores y búsquedas recientes; texto fantasma que se acepta con `Tab` / `→` | Google Suggest vía el agente |
| Reloj dot‑matrix, día, fecha y semana | navegador |
| CPU (anillo), memoria, discos | `psutil` |
| GPU: uso igual que el Administrador de tareas, temperatura, VRAM | contadores PDH de Windows + `nvidia-smi` |
| Red: bajada / subida en vivo con sparkline | `psutil` |
| Sistema: host, uptime, IP local, procesos | `psutil` |
| Now playing con anterior / pausa / siguiente | controles multimedia de Windows (SMTC); si Spotify no publica ahí, se lee el título de su ventana y se controla con las teclas multimedia |
| Clima (por defecto Madrid, configurable) | [Open‑Meteo](https://open-meteo.com) (sin API key) |
| Tareas: añadir, completar, editar (botón de lápiz o doble clic), limpiar hechas | `data.json` vía el agente |
| Marcadores numerados con atajos `1`–`9` y `0` (10.º), reordenables arrastrando (o con `Alt+↑/↓`) | `data.json` vía el agente |

Atajos (fuera de un campo de texto): `/` buscar · `T` nueva tarea · `1`–`9`, `0` abrir marcador · `F` pantalla completa · `U` cambiar de tema · `Esc` salir del campo.

En el buscador: si lo que escribes coincide con el principio del nombre o dominio de un marcador (p. ej. `ani` → anilist), se autocompleta y `Enter` lo abre; `Esc` y luego `Enter` busca en Google. `↑` `↓` recorrer sugerencias · `Enter` abrir · `Ctrl+Enter` en otra pestaña · `Tab` aceptar el autocompletado · `Shift+Supr` borrar una búsqueda reciente · `Esc` cerrar.

El botón de pantalla completa usa la Fullscreen API: a diferencia de F11, el navegador no muestra la barra de direcciones al acercar el ratón arriba.

## Requisitos

- Windows 10/11
- Python 3.10+
- GPU NVIDIA opcional (para temperatura y VRAM; el % de uso funciona con cualquier GPU)

## Instalación

```powershell
git clone https://github.com/ak1ta4/home-dashboard.git
cd home-dashboard
python -m pip install --target .deps -r requirements.txt
python server.py
```

Abre <http://127.0.0.1:47800>.

Las dependencias se instalan en `.deps/` dentro del proyecto (el agente las carga de ahí). Así las encuentra también cuando Windows lo arranca al iniciar sesión: un `pip install --user` hecho desde una app empaquetada (MSIX) puede acabar en una copia privada de `%APPDATA%` que la tarea programada no ve. `install-autostart.ps1` las instala si faltan.

### Arrancar con Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

Registra una tarea programada de Windows, `Home Agent`, que lanza `pythonw server.py` sin ventana al iniciar sesión (con 15 s de margen, sin límite de duración y con reintentos), y arranca el agente si no estaba ya en marcha. No necesita permisos de administrador y localiza `pythonw.exe` aunque Python no esté en el `PATH` (lo busca en el registro de Windows). Si existe el acceso directo de versiones anteriores en `shell:startup`, lo elimina. Lanzado con `pythonw`, el agente se ejecuta bajo un pequeño vigilante que lo relanza si se cierra, y reintenta si el puerto está ocupado o reservado por Windows; arranques y fallos quedan en `%TEMP%\home_agent.log`. Para quitarlo: `Unregister-ScheduledTask -TaskName 'Home Agent' -Confirm:$false`.

### Usarlo en el navegador

- **Página de inicio** (cualquier navegador): pon `http://127.0.0.1:47800` como página de inicio.
- **Nueva pestaña**: la carpeta `web/` es también una extensión (Manifest V3) que sustituye la nueva pestaña.
  - Chrome / Edge / Brave: `chrome://extensions` → modo desarrollador → *Cargar descomprimida* → selecciona `web/`.
  - Firefox: solo instala de forma permanente extensiones firmadas. Puedes firmarla gratis como *unlisted* en [addons.mozilla.org](https://addons.mozilla.org/developers/) (o con `web-ext sign`), o cargarla temporalmente desde `about:debugging`.

### Versión web (GitHub Pages)

`web/` se publica automáticamente en **https://ak1ta4.github.io/home-dashboard/** con cada push (workflow `.github/workflows/pages.yml`).

Añade `?demo` a la URL para ver el dashboard con datos ficticios (es lo que muestran las capturas). Sin el agente funcionan el reloj, el clima, el buscador con sugerencias de Google (vía JSONP), y las tareas y marcadores (guardados solo en ese navegador). Las tarjetas de sistema muestran `Agent offline`.

Si abres esa URL en el PC donde corre el agente y su origen está en `origins` de `config.json`, la versión web también muestra tus datos reales (Chrome puede pedir permiso para acceder a la red local).

### Wallpaper (Wallpaper Engine)

`wallpaper/` es un wallpaper *web* para [Wallpaper Engine](https://www.wallpaperengine.io/). Cuando el agente responde, navega al dashboard en modo `?mode=wallpaper` (sin iframe: el CEF de Wallpaper Engine se cuelga con un marco de otro origen), sin buscador ni marcadores. Las barras de *Now playing* se mueven con el **audio real** del sistema.

Las tareas se escriben en la propia tarjeta. Wallpaper Engine no pasa el teclado a los wallpapers, así que, al enfocar el campo, la página pide al agente que capture las pulsaciones con un *hook* de teclado de Windows y se las envíe (acentos, AltGr, flechas, Ctrl+V…). La captura solo arranca si el escritorio está en primer plano y termina al cambiar de ventana, con Esc, Win, Alt+Tab, al salir del campo o tras 2 min sin teclear; mientras dura, las teclas no llegan a otros programas y no se guardan. `%TEMP%\home_keys.log` registra cuándo empieza y termina la captura y cuántas teclas recibió, nunca cuáles.

Para instalarlo, copia la carpeta `wallpaper/` dentro de `wallpaper_engine\projects\myprojects\` (en tu biblioteca de Steam), o en Wallpaper Engine usa *Crear wallpaper* → selecciona `wallpaper/index.html`. Necesita el agente en marcha; si no responde, muestra `Agent offline` y lo reintenta cada 5 s.

## Configuración

- **Ubicación del clima y orígenes permitidos**: copia `config.example.json` a `config.json` y pon tu ciudad, región y coordenadas, y en `origins` la URL de tu GitHub Pages. `config.json` está en `.gitignore`, así que tu ubicación no se sube. Sin ese archivo se usa Madrid.
- **Puerto**: variable de entorno `HOME_PORT` (por defecto `47800`). Si lo cambias, actualiza también `API` en `web/app.js` para la versión extensión.

## Seguridad

- El agente solo escucha en `127.0.0.1` y rechaza peticiones con otra cabecera `Host` (protección contra DNS rebinding).
- Las escrituras (`PUT /api/data`, `POST /api/media/*`) exigen la cabecera `X-Home: 1`, lo que fuerza un preflight CORS que solo se acepta para orígenes `moz-extension://` y `chrome-extension://`. Otras webs no pueden leer tus datos ni controlar tu música.
- Los marcadores solo aceptan URLs `http(s)`. Su icono opcional se valida en el agente: un nombre de Simple Icons, un texto corto, una URL `http(s)` o una imagen PNG / JPEG / WebP / GIF incrustada de hasta ~30 KB (no se aceptan SVG); el color, uno de los siete de gruvbox.
- La captura de teclado del wallpaper (`/api/keys`) solo la puede pedir la página servida por el propio agente (mismo origen + `X-Home`) y solo mientras el escritorio está delante.
- `data.json` (tus tareas y marcadores) y `config.json` (tu ubicación) están en `.gitignore`. Las búsquedas recientes solo se guardan en el `localStorage` del navegador.
- Mientras escribes en el buscador, el texto se envía a Google para obtener sugerencias (igual que hace la barra del navegador).

## Estructura

```
server.py              agente local: estáticos + /api/stats, /api/data, /api/media/*,
                       /api/suggest, /api/config
config.example.json    plantilla de config.json (ubicación del clima)
install-autostart.ps1  acceso directo en el Inicio de Windows
wallpaper/              wallpaper web para Wallpaper Engine (index.html + project.json)
requirements.txt
web/
  app.js                                    lógica común a los dos temas
  index.html  nothing.css                   tema «nothing» (página de entrada)
  terminal.html  terminal.css  terminal.js  tema «terminal»
  theme.js                                  cambio de tema (tecla U, ?theme=)
  manifest.json                             para usar web/ como extensión de nueva pestaña
```

---

Proyecto personal sin afiliación con Nothing Technology Ltd. Fuentes: Doto, Space Grotesk y Space Mono (Google Fonts, OFL).
