# Changelog

Todos los cambios importantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

## [1.1.0] - 2026-10-10

### Added

- Lista de pendientes de Canvas (tareas, exámenes, foros y notas) desde el planner, agrupados por día, con
  resumen de atrasadas y pendientes para hoy.
- Tarjetas expandibles con el detalle bajo demanda: descripción, puntos, tipos de entrega, intentos y cierre.
- Descartar pendientes atrasados (los marca como completados en el planner de Canvas), con Deshacer durante 6 s.
- Avisos antes del vencimiento y aviso 7 días antes de que venza el token.
- Ícono de bandeja, inicio automático con el sistema, mantener encima, tema claro/oscuro y opacidad.
- Vidrio simulado con el fondo de pantalla de GNOME y color de acento adaptativo con contraste mínimo 4.5:1.
- Soporte para Windows 11: acrílico nativo, acento del sistema, controles de ventana estilo Fluent e
  instalador NSIS por usuario sin permisos de administrador.
- Interfaz en español e inglés según el idioma del sistema.
- Modo demo con datos de ejemplo (`npm run demo`).
- ESLint, Prettier, pruebas con `node:test`, CI y publicación automática de releases en GitHub Actions.

### Changed

- El código del proceso principal se dividió en módulos (`src/main/`).
- La configuración se guarda en el directorio de datos de la app (`~/.config/Canvas Today/` en Linux,
  `%APPDATA%\Canvas Today\` en Windows); los archivos de `~/.config/canvas-widget/` se migran solos.
- En Linux la app se relanza en X11 si arranca en Wayland, sin depender del archivo `.desktop`.

### Fixed

- La app se cierra con SIGTERM/SIGINT sin dejar procesos ni montajes de AppImage.
- Recuadro gris alrededor del panel causado por una sombra recortada por la ventana.

### Security

- El token se guarda cifrado con el llavero del sistema (`safeStorage`); sin llavero, en un archivo con
  permisos 600. El token antiguo en texto plano se borra tras migrarlo.
- El token solo se envía al dominio de Canvas configurado, también al seguir la paginación.

[Unreleased]: https://github.com/lelrxuch/canvas-today/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/lelrxuch/canvas-today/releases/tag/v1.1.0
