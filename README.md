# Canvas Today

Widget de escritorio para Linux con tus pendientes de Canvas.

## Instalar

```bash
chmod +x Canvas-Today-1.0.0.AppImage
./Canvas-Today-1.0.0.AppImage
```

Si falla por FUSE en Fedora: `sudo dnf install fuse-libs`.

## Primer uso

1. Se abre Ajustes.
2. Dirección de Canvas: el dominio de la UMG (lo que ves en la barra del navegador al entrar a Canvas, sin `https://`).
3. Token: si ya existe `~/.config/canvas-widget/token`, no hace falta pegar nada.
4. Vence el: fecha de vencimiento del token (7 ene 2027).
5. Guardar.

## Cada 90 días

Genera un token nuevo en Canvas, pégalo en Ajustes → Token y actualiza la fecha. La app avisa 7 días antes.

## Archivos

- `~/.config/canvas-widget/token` — token (permisos 600)
- `~/.config/canvas-widget/config.json` — ajustes
- `~/.config/autostart/canvas-today.desktop` — solo si activas "Iniciar con el sistema"

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
npm run demo   # datos de ejemplo, sin Canvas
npm start
npm run dist   # genera la AppImage en dist/
```
