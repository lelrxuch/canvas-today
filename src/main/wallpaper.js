'use strict';

const { execFile, spawn } = require('node:child_process');
const { nativeImage, nativeTheme, screen } = require('electron');
const { dominantHue, accentFrom } = require('./color');

/*
 * Vidrio simulado: la ventana es transparente y el renderer pinta el fondo de pantalla de GNOME
 * desplazado según la posición de la ventana. De ese fondo también sale el color de acento.
 */

/** Lado del muestreo para calcular el tono dominante (48×48 = 2304 píxeles). */
const SAMPLE_PX = 48;
/** El fondo se manda a media resolución de la pantalla: basta para un desenfoque. */
const WALLPAPER_SCALE = 0.5;
const WALLPAPER_JPEG_QUALITY = 80;

/* ---------- fondo de GNOME ---------- */

/** Ruta del wallpaper actual (variante clara u oscura según el tema), o null. */
function wallpaperPath() {
  const key = nativeTheme.shouldUseDarkColors ? 'picture-uri-dark' : 'picture-uri';
  return new Promise((resolve) => {
    execFile('gsettings', ['get', 'org.gnome.desktop.background', key], (err, out) => {
      if (err) return resolve(null);
      const uri = out.trim().replace(/^'|'$/g, '');
      if (!uri.startsWith('file://')) return resolve(null);
      try {
        resolve(decodeURIComponent(uri.slice('file://'.length)));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Fondo para la pantalla donde está `bounds`: { url } como data URL JPEG más el acento,
 * o { url: null } si no hay wallpaper legible.
 */
async function loadWallpaper(bounds) {
  try {
    const file = await wallpaperPath();
    const img = file ? nativeImage.createFromPath(file) : null;
    if (!img || img.isEmpty()) return { url: null };
    const { width } = screen.getDisplayMatching(bounds).size;
    const jpeg = img.resize({ width: Math.round(width * WALLPAPER_SCALE) }).toJPEG(WALLPAPER_JPEG_QUALITY);
    const sample = img.resize({ width: SAMPLE_PX, height: SAMPLE_PX }).toBitmap();
    return {
      url: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      ...accentFrom(dominantHue(sample), nativeTheme.shouldUseDarkColors),
    };
  } catch {
    return { url: null };
  }
}

/** Llama a `onChange` cuando cambia el wallpaper o el tema. Devuelve una función para dejar de vigilar. */
function watchWallpaper(onChange) {
  nativeTheme.on('updated', onChange);
  const monitor = spawn('gsettings', ['monitor', 'org.gnome.desktop.background']);
  monitor.on('error', () => {
    /* sin gsettings: se queda el fondo actual */
  });
  monitor.stdout.on('data', onChange);
  return () => monitor.kill();
}

module.exports = { loadWallpaper, watchWallpaper };
