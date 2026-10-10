# Canvas Today

Widget de escritorio para Linux con tus pendientes de Canvas: tareas, exámenes, foros y notas,
agrupados por día, con avisos antes del vencimiento. Interfaz en español o inglés según el idioma del sistema.

## Instalar

```bash
chmod +x Canvas-Today-1.0.0.AppImage
./Canvas-Today-1.0.0.AppImage
```

Si falla por FUSE en Fedora: `sudo dnf install fuse-libs`.

## Primer uso

1. Se abre Ajustes.
2. Dirección de Canvas: el dominio de la UMG (lo que ves en la barra del navegador al entrar a Canvas, sin `https://`).
3. Token: pégalo desde Canvas (Cuenta → Configuración → Nuevo token de acceso). Si venías de una versión
   anterior, el token de `~/.config/canvas-widget/token` se migra solo.
4. Vence el: fecha de vencimiento del token (7 ene 2027).
5. Guardar.

## Cada 90 días

Genera un token nuevo en Canvas, pégalo en Ajustes → Token y actualiza la fecha. La app avisa 7 días antes.

## Archivos

En `~/.config/Canvas Today/` (el directorio `userData` de Electron):

- `token.enc` — token cifrado con el llavero del sistema (libsecret/KWallet en Linux, DPAPI en Windows)
- `token` — solo si no hay llavero disponible: texto plano con permisos 600
- `config.json` — ajustes
- `state.json` — avisos ya enviados

Además, `~/.config/autostart/canvas-today.desktop` si activas "Iniciar con el sistema".

La primera vez se migran los archivos de `~/.config/canvas-widget/` (versión 1.0); el token antiguo en texto
plano se borra después de comprobar que la copia nueva se lee bien.

## Atajos

- `Ctrl+R` actualizar
- `Ctrl+,` ajustes
- `Esc` ocultar
- Botón verde: mantener encima

## GNOME

El ícono de bandeja requiere la extensión AppIndicator:
`sudo dnf install gnome-shell-extension-appindicator`, luego cierra sesión y vuelve a entrar.
Sin ella la app funciona igual; para volver a mostrar la ventana, ejecuta la AppImage otra vez.

En Wayland, GNOME no deja que la app elija su posición en pantalla.

## Desarrollo

```bash
npm install
npm start             # app real
npm run demo          # datos de ejemplo, sin Canvas ni token (CANVAS_TODAY_DEMO=1)
npm test              # pruebas de lógica pura con node:test
npm run lint          # ESLint
npm run format        # Prettier (format:check solo revisa)
npm run dist          # genera la AppImage en dist/
```

### Estructura

```
src/
├── main/                 proceso principal
│   ├── index.js          arranque, ventana, IPC y ciclo de actualización
│   ├── canvas-api.js     cliente HTTP, paginación por header Link, normalizeItem
│   ├── config.js         config.json/state.json, validación de Ajustes
│   ├── token-store.js    token con safeStorage o archivo 600, migración
│   ├── wallpaper.js      fondo de GNOME para el vidrio y color de acento
│   ├── notifications.js  avisos de vencimiento y de token
│   ├── tray.js           ícono y menú de bandeja
│   ├── autostart.js      inicio automático (XDG)
│   ├── demo.js           datos del modo demo
│   ├── i18n.js           idioma según app.getLocale()
│   └── errors.js         AppError con código
├── preload.js            puente window.canvas
└── renderer/
    ├── index.html
    ├── renderer.js       DOM y eventos
    ├── agenda.js         agrupación por día, resumen y formato de fechas (puro)
    ├── i18n/es.js, en.js textos de la interfaz
    └── styles.css
test/                     pruebas node:test
```
