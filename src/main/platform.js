'use strict';

const { spawn } = require('node:child_process');
const { app, nativeTheme, systemPreferences } = require('electron');
const { dominantHue, accentFrom } = require('./color');

/*
 * Todo lo que cambia entre Linux y Windows. Las funciones puras reciben la plataforma o los datos
 * como argumento para poder probarlas sin Electron.
 */

const IS_WINDOWS = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
/** Igual al appId de electron-builder: Windows agrupa las notificaciones por este id. */
const APP_USER_MODEL_ID = 'gt.cris.canvastoday';

/**
 * Opciones de BrowserWindow para el vidrio.
 * Windows 11: acrílico del sistema (desenfoque real del escritorio) con sombra nativa.
 * Linux: ventana transparente; el renderer pinta el wallpaper (ver wallpaper.js).
 */
function windowOptions(platform) {
  if (platform === 'win32') {
    return {
      transparent: false,
      backgroundColor: '#00000000',
      backgroundMaterial: 'acrylic',
      hasShadow: true,
    };
  }
  return { transparent: true, backgroundColor: '#00000000', hasShadow: false };
}

/**
 * Acento a partir del color del sistema de Windows ('RRGGBBAA'), con el mismo ajuste de contraste
 * que el wallpaper. Un acento gris o inválido devuelve {} (acento neutro de styles.css).
 */
function systemAccent(hex, dark) {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  if (!m) return {};
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  // Un bitmap BGRA de un píxel: aplica los mismos umbrales de "casi gris" que el wallpaper.
  return accentFrom(dominantHue(Buffer.from([b, g, r, 255])), dark);
}

// En Linux se necesita X11: en Wayland no funcionan "Mantener encima" ni la posición del vidrio.
// appendSwitch('ozone-platform') llega tarde en Electron 44 (la plataforma ya se eligió), así que
// se relanza una vez con el flag. El valor del switch antes de tocarlo es la plataforma efectiva.
// No se usa app.relaunch: su proceso auxiliar vive dentro del montaje de la AppImage, que
// desaparece al salir, y la app nunca vuelve a abrir.
function needsX11Relaunch({ platform, ozone, env }) {
  return (
    platform === 'linux' &&
    ozone !== 'x11' &&
    Boolean(env.DISPLAY) && // sin XWayland no hay X11 al que cambiar
    !env.CANVAS_TODAY_X11_RELAUNCH
  );
}

/** Relanza la app en X11 si hace falta. Devuelve true si lo hizo (el llamador debe salir). */
function relaunchInX11IfNeeded() {
  const ozone = app.commandLine.getSwitchValue('ozone-platform');
  if (!needsX11Relaunch({ platform: process.platform, ozone, env: process.env })) return false;
  spawn(process.env.APPIMAGE || process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], {
    detached: true,
    // fd 3 es el pipe con el que el runtime de la AppImage sabe que la app terminó; si se hereda,
    // la instancia original y su montaje nunca se cierran. 'ignore' no lo reemplaza; 'pipe' sí.
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, CANVAS_TODAY_X11_RELAUNCH: '1' },
  }).unref();
  return true;
}

/** Ajustes de arranque. Windows necesita el AppUserModelId antes de la primera notificación. */
function setup() {
  if (IS_WINDOWS) app.setAppUserModelId(APP_USER_MODEL_ID);
}

/** Fondo y acento para el renderer: { url, accent, accentSoft, accentBorder }. */
async function loadBackdrop(bounds) {
  if (IS_WINDOWS) {
    return {
      url: null,
      ...systemAccent(systemPreferences.getAccentColor(), nativeTheme.shouldUseDarkColors),
    };
  }
  return require('./wallpaper').loadWallpaper(bounds);
}

/** Llama a `onChange` cuando cambia el fondo, el acento o el tema. Devuelve una función para dejar de vigilar. */
function watchBackdrop(onChange) {
  if (IS_WINDOWS) {
    nativeTheme.on('updated', onChange);
    systemPreferences.on('accent-color-changed', onChange);
    return () => {
      nativeTheme.off('updated', onChange);
      systemPreferences.off('accent-color-changed', onChange);
    };
  }
  return require('./wallpaper').watchWallpaper(onChange);
}

module.exports = {
  IS_WINDOWS,
  IS_LINUX,
  windowOptions,
  systemAccent,
  needsX11Relaunch,
  relaunchInX11IfNeeded,
  setup,
  loadBackdrop,
  watchBackdrop,
};
