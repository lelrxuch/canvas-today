'use strict';

/* Color de acento: tono dominante de un bitmap y ajuste de contraste sobre el vidrio. Sin Electron. */

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

module.exports = { rgbToHsl, hslToRgb, contrast, dominantHue, accentFrom };
