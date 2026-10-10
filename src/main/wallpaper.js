'use strict';

const { execFile, spawn } = require('node:child_process');
const { nativeImage, nativeTheme, screen } = require('electron');

/*
 * Vidrio simulado: la ventana es transparente y el renderer pinta el fondo de pantalla de GNOME
 * desplazado según la posición de la ventana. De ese fondo también sale el color de acento.
 */

/** Lado del muestreo para calcular el tono dominante (48×48 = 2304 píxeles). */
const SAMPLE_PX = 48;
const HUE_BUCKETS = 24;
const HUE_BUCKET_DEG = 360 / HUE_BUCKETS;
/** Píxeles que cuentan: suficientemente saturados y ni casi negros ni casi blancos. */
const MIN_SATURATION = 0.2;
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.92;
/** Si menos de esta fracción de píxeles tiene color, el fondo se considera gris. */
const MIN_COLORFUL_FRACTION = 0.08;

/** Rojos (0–25° y 335–360°) se cambian a naranja para no confundirse con "atrasada". */
const RED_HUE_LOW = 25;
const RED_HUE_HIGH = 335;
const RED_REPLACEMENT_HUE = 32;
const ACCENT_SATURATION = [0.45, 0.8];
/** Contraste mínimo WCAG AA para texto normal. */
const MIN_CONTRAST = 4.5;
const LIGHTNESS_STEP = 0.01;
/** Fondo aproximado del vidrio y luminosidad inicial del acento, por tema. */
const GLASS = {
  dark: { bg: [0x2c, 0x2c, 0x30], lightness: 0.72 },
  light: { bg: [0xf2, 0xf2, 0xf4], lightness: 0.38 },
};
const ACCENT_SOFT_ALPHA = 0.18;
const ACCENT_BORDER_ALPHA = 0.45;

/** El fondo se manda a media resolución de la pantalla: basta para un desenfoque. */
const WALLPAPER_SCALE = 0.5;
const WALLPAPER_JPEG_QUALITY = 80;

/* ---------- color ---------- */

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Razón de contraste WCAG entre dos colores [r, g, b]. */
function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.map((c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Tono más pesado de un bitmap BGRA (cubetas de 15° ponderadas por saturación) y su saturación
 * media. Devuelve null si el fondo es casi gris.
 */
function dominantHue(bgra) {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ w: 0, hw: 0, n: 0 }));
  let passed = 0;
  for (let i = 0; i < bgra.length; i += 4) {
    const [h, s, l] = rgbToHsl(bgra[i + 2], bgra[i + 1], bgra[i]);
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
    passed++;
    const b = buckets[Math.floor(h / HUE_BUCKET_DEG) % HUE_BUCKETS];
    b.w += s;
    b.hw += h * s;
    b.n++;
  }
  if (passed < MIN_COLORFUL_FRACTION * (bgra.length / 4)) return null;
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  return { h: best.hw / best.w, s: best.w / best.n };
}

/**
 * Acento legible sobre el vidrio (≥ 4.5:1) a partir del tono dominante, en formato CSS.
 * Sin tono dominante devuelve {} y el renderer usa el acento neutro de styles.css.
 */
function accentFrom(dom, dark) {
  if (!dom) return {};
  const h = dom.h < RED_HUE_LOW || dom.h > RED_HUE_HIGH ? RED_REPLACEMENT_HUE : dom.h;
  const [minS, maxS] = ACCENT_SATURATION;
  const s = Math.min(maxS, Math.max(minS, dom.s));
  const glass = dark ? GLASS.dark : GLASS.light;
  let l = glass.lightness;
  let rgb = hslToRgb(h, s, l);
  while (contrast(rgb, glass.bg) < MIN_CONTRAST && l > 0 && l < 1) {
    l = dark ? Math.min(1, l + LIGHTNESS_STEP) : Math.max(0, l - LIGHTNESS_STEP);
    rgb = hslToRgb(h, s, l);
  }
  const c = rgb.join(', ');
  return {
    accent: `rgb(${c})`,
    accentSoft: `rgba(${c}, ${ACCENT_SOFT_ALPHA})`,
    accentBorder: `rgba(${c}, ${ACCENT_BORDER_ALPHA})`,
  };
}

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

module.exports = {
  rgbToHsl,
  hslToRgb,
  contrast,
  dominantHue,
  accentFrom,
  loadWallpaper,
  watchWallpaper,
};
