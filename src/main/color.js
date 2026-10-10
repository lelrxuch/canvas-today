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
const LIGHTNESS_STEPS = 100;
/**
 * Por tema: fondo del vidrio cuando no hay wallpaper (acrílico de Windows), luminosidad inicial del
 * acento, tinte del panel, texto principal y secundario ([rgb, alfa]) y colores que se ajustan a
 * contraste (--text-3, --red-head). Debe coincidir con styles.css.
 */
const GLASS = {
  dark: {
    bg: [0x2c, 0x2c, 0x30],
    lightness: 0.72,
    tint: [28, 28, 30],
    sheen: 0.08,
    text3: [0x7c, 0x7c, 0x80],
    redHead: [0xff, 0x72, 0x66], // L = 0.70 (RED_MAX_LIGHTNESS)
    text: [
      [[0xf5, 0xf5, 0xf7], 1],
      [[255, 255, 255], 0.72],
    ],
  },
  light: {
    bg: [0xf2, 0xf2, 0xf4],
    lightness: 0.38,
    tint: [255, 255, 255],
    sheen: 0.28,
    text3: [0x8e, 0x8e, 0x93],
    redHead: [0xd7, 0x00, 0x15],
    text: [
      [[0x1d, 0x1d, 0x1f], 1],
      [[0, 0, 0], 0.62],
    ],
  },
};
/** Contraste mínimo del texto principal (WCAG AAA) y secundario (AA) sobre el panel. */
const TEXT_CONTRAST = [7, 4.5];
const TINT_STEPS = 100;
/** Píldoras rojas ("Hace 2 d", encabezado "Atrasadas", botón "Descartar"): texto blanco sobre rojo. */
const LATE_BADGE = [255, 69, 58];
const LATE_BADGE_ALPHA = 0.9;
/** Luminosidad HSL máxima del rojo del resumen en oscuro: más clara ya se ve rosa, no roja. */
const RED_MAX_LIGHTNESS = 0.7;
/** WCAG: texto grande (≥ 18.66px en negrita; el resumen es de 22px y 700) basta con 3:1. */
const LARGE_TEXT_CONTRAST = 3;
/** styles.css: filter saturate(1.7) del wallpaper y --glass (blanco 0.12) de tarjetas y botones. */
const WALL_SATURATE = 1.7;
const CARD_GLASS_ALPHA = 0.12;
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

/** Luminancia relativa WCAG de un color [r, g, b]. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores [r, g, b]. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
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

/** Color promedio [r, g, b] de un bitmap BGRA. */
function averageColor(bgra) {
  const sum = [0, 0, 0];
  for (let i = 0; i < bgra.length; i += 4) {
    sum[0] += bgra[i + 2];
    sum[1] += bgra[i + 1];
    sum[2] += bgra[i];
  }
  const n = bgra.length / 4 || 1;
  return sum.map((c) => Math.round(c / n));
}

/** Filtro CSS saturate(amount) sobre un color (matriz de Filter Effects). */
function saturate([r, g, b], amount) {
  const k = 1 - amount;
  const ch = (wr, wg, wb) => Math.round(Math.min(255, Math.max(0, wr * r + wg * g + wb * b)));
  return [
    ch(0.2126 * k + amount, 0.7152 * k, 0.0722 * k),
    ch(0.2126 * k, 0.7152 * k + amount, 0.0722 * k),
    ch(0.2126 * k, 0.7152 * k, 0.0722 * k + amount),
  ];
}

/** Percentiles de luminancia para los tonos oscuro y claro: ignoran píxeles sueltos. */
const TONE_PERCENTILES = [0.05, 0.95];

/**
 * Tonos del wallpaper contra los que se mide el contraste: el promedio y los percentiles 5 y 95 de
 * luminancia. Solo con el promedio, la zona detrás de la ventana puede quedar más oscura o más
 * clara (en las capturas de demo el pie daba 4.0:1).
 */
function wallTones(bgra) {
  const px = [];
  for (let i = 0; i < bgra.length; i += 4) px.push([bgra[i + 2], bgra[i + 1], bgra[i]]);
  if (!px.length) return [];
  px.sort((a, b) => luminance(a) - luminance(b));
  return [averageColor(bgra), ...TONE_PERCENTILES.map((p) => px[Math.round(p * (px.length - 1))])];
}

const over = (top, alpha, bottom) => bottom.map((c, i) => Math.round(top[i] * alpha + c * (1 - alpha)));

const WHITE = [255, 255, 255];

/**
 * Fondos reales detrás del texto en el vidrio simulado: el panel (wallpaper desenfocado y
 * saturado + tinte con alfa `alpha`), el panel bajo el pico del brillo diagonal y las tarjetas y
 * botones (panel + --glass).
 */
function glassBackgrounds(wall, dark, alpha) {
  const glass = dark ? GLASS.dark : GLASS.light;
  const panel = over(glass.tint, alpha, saturate(wall, WALL_SATURATE));
  return [panel, over(WHITE, glass.sheen, panel), over(WHITE, CARD_GLASS_ALPHA, panel)];
}

/**
 * Alfa mínimo del tinte para que el texto principal llegue a 7:1 y el secundario a 4.5:1 sobre el
 * panel, medido con el promedio y el tono más difícil (percentil 95 en oscuro, 5 en claro). En
 * oscuro cuenta el pico del brillo diagonal (aclara); en claro, el panel sin brillo. Sin `tones`
 * (Windows o sin wallpaper) se mide sobre el vidrio fijo del tema.
 */
function minTintAlpha(tones, dark) {
  const glass = dark ? GLASS.dark : GLASS.light;
  const walls = tones
    ? [tones[0], dark ? tones[2] : tones[1]].map((w) => saturate(w, WALL_SATURATE))
    : [glass.bg];
  const readable = (alpha) =>
    walls.every((w) => {
      const tinted = over(glass.tint, alpha, w);
      const panel = dark ? over(WHITE, glass.sheen, tinted) : tinted;
      return glass.text.every(([rgb, a], i) => contrast(over(rgb, a, panel), panel) >= TEXT_CONTRAST[i]);
    });
  let step = 0;
  while (step < TINT_STEPS && !readable(step / TINT_STEPS)) step++;
  return step / TINT_STEPS;
}

/** Alfa del tinte para el control de Opacidad: `level` 0 = mínimo legible, 1 = tinte opaco. */
function tintAlpha(tones, dark, level) {
  const min = minTintAlpha(tones, dark);
  return min + Math.min(1, Math.max(0, level)) * (1 - min);
}

/**
 * El mismo tono y saturación que `rgb` con la luminosidad (≤ `maxL`) más cercana a la suya (o a
 * `startL`) que da `score(candidato)` ≥ `min`; si ninguna llega, la de mejor puntaje. Si `rgb` ya
 * cumple, tal cual.
 */
function fitLightness(rgb, score, { startL, maxL = 1, min = MIN_CONTRAST } = {}) {
  const [h, s, l0] = rgbToHsl(...rgb);
  if (startL === undefined && l0 <= maxL && score(rgb) >= min) return rgb;
  const target = startL ?? l0;
  let best = null;
  for (let i = 0; i <= Math.round(maxL * LIGHTNESS_STEPS); i++) {
    const l = i / LIGHTNESS_STEPS;
    const cand = hslToRgb(h, s, l);
    const c = score(cand);
    const rank = c >= min ? [1, -Math.abs(l - target)] : [0, c];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) {
      best = { rgb: cand, rank };
    }
  }
  return best.rgb;
}

const minContrast = (rgb, backgrounds) => Math.min(...backgrounds.map((bg) => contrast(rgb, bg)));

/**
 * Colores con luminosidad ajustada al contraste, sin cambiar el tono. `layers` son los
 * [panel, brillo, tarjeta] de glassBackgrounds para cada tono del wallpaper.
 * - --text-3: ≥ 4.5:1 sobre todos.
 * - --red-head (resumen "N atrasadas", texto grande): ≥ 3:1 sobre panel y brillo; en oscuro con
 *   L ≤ RED_MAX_LIGHTNESS para que se siga viendo rojo.
 * - --late-bg (píldoras rojas con texto blanco: "Hace 2 d", encabezado "Atrasadas", "Descartar"):
 *   blanco ≥ 4.5:1 sobre el rojo translúcido encima de cualquier capa.
 */
function textStyle(dark, layers) {
  const glass = dark ? GLASS.dark : GLASS.light;
  const all = layers.flat();
  const panels = layers.flatMap(([panel, sheen]) => [panel, sheen]);
  const text3 = fitLightness(glass.text3, (c) => minContrast(c, all));
  const redHead = fitLightness(glass.redHead, (c) => minContrast(c, panels), {
    maxL: dark ? RED_MAX_LIGHTNESS : 1,
    min: LARGE_TEXT_CONTRAST,
  });
  const lateBg = fitLightness(LATE_BADGE, (c) =>
    minContrast(
      WHITE,
      all.map((bg) => over(c, LATE_BADGE_ALPHA, bg)),
    ),
  );
  const css = (rgb) => `rgb(${rgb.join(', ')})`;
  return {
    text3: css(text3),
    redHead: css(redHead),
    lateBg: `rgba(${lateBg.join(', ')}, ${LATE_BADGE_ALPHA})`,
  };
}

/**
 * Tinte, acento y colores de texto del vidrio para un wallpaper ya analizado (`dom` de dominantHue
 * y `tones` de wallTones; null sin wallpaper) y el nivel del control de Opacidad, en formato CSS.
 */
function glassStyle(dom, tones, dark, level) {
  const glass = dark ? GLASS.dark : GLASS.light;
  const alpha = tintAlpha(tones, dark, level);
  const layers = (tones || [glass.bg]).map((tone) => glassBackgrounds(tone, dark, alpha));
  return {
    tint: `rgba(${glass.tint.join(', ')}, ${alpha.toFixed(3)})`,
    ...textStyle(dark, layers),
    ...accentFrom(dom, dark, layers.flat()),
  };
}

/**
 * Acento legible (≥ 4.5:1 contra todos los `backgrounds`) a partir del tono dominante, en formato
 * CSS. Elige la luminosidad que cumple más cercana a la inicial del tema; si ninguna cumple, la de
 * mejor contraste. Sin tono dominante devuelve {} y el renderer usa el acento neutro de styles.css.
 */
function accentFrom(dom, dark, backgrounds) {
  if (!dom) return {};
  const h = dom.h < RED_HUE_LOW || dom.h > RED_HUE_HIGH ? RED_REPLACEMENT_HUE : dom.h;
  const [minS, maxS] = ACCENT_SATURATION;
  const s = Math.min(maxS, Math.max(minS, dom.s));
  const glass = dark ? GLASS.dark : GLASS.light;
  const bgs = backgrounds || [glass.bg];
  const rgb = fitLightness(hslToRgb(h, s, glass.lightness), (c) => minContrast(c, bgs), {
    startL: glass.lightness,
  });
  const c = rgb.join(', ');
  return {
    accent: `rgb(${c})`,
    accentSoft: `rgba(${c}, ${ACCENT_SOFT_ALPHA})`,
    accentBorder: `rgba(${c}, ${ACCENT_BORDER_ALPHA})`,
  };
}

module.exports = {
  rgbToHsl,
  hslToRgb,
  contrast,
  dominantHue,
  averageColor,
  wallTones,
  saturate,
  glassBackgrounds,
  minTintAlpha,
  tintAlpha,
  textStyle,
  glassStyle,
  RED_MAX_LIGHTNESS,
  LARGE_TEXT_CONTRAST,
  accentFrom,
};
