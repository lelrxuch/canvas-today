'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/main/color');

const rgbOf = (css) => css.match(/\d+/g).map(Number);
const GLASS_DARK = [0x2c, 0x2c, 0x30];
const GLASS_LIGHT = [0xf2, 0xf2, 0xf4];

/** Bitmap BGRA de `n` píxeles del mismo color. */
function bitmap(n, [r, g, b]) {
  const buf = Buffer.alloc(n * 4);
  for (let i = 0; i < buf.length; i += 4) buf.set([b, g, r, 255], i);
  return buf;
}

test('rgbToHsl y hslToRgb son inversas', () => {
  for (const rgb of [
    [255, 0, 0],
    [0, 128, 255],
    [34, 139, 34],
    [200, 200, 200],
  ]) {
    assert.deepEqual(hslToRgb(...rgbToHsl(...rgb)), rgb);
  }
});

test('contrast sigue la fórmula WCAG', () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrast([90, 90, 90], [90, 90, 90]), 1);
});

test('dominantHue: null en fondos grises, tono del color dominante si no', () => {
  assert.equal(dominantHue(bitmap(100, [128, 128, 128])), null);
  const blue = Buffer.concat([bitmap(70, [20, 60, 220]), bitmap(30, [220, 120, 20])]);
  const dom = dominantHue(blue);
  assert.ok(Math.abs(dom.h - rgbToHsl(20, 60, 220)[0]) < 0.001);
});

test('accentFrom asegura contraste ≥ 4.5 en ambos temas', () => {
  for (const dom of [
    { h: 60, s: 1 },
    { h: 210, s: 0.3 },
    { h: 120, s: 0.9 },
  ]) {
    assert.ok(contrast(rgbOf(accentFrom(dom, true).accent), GLASS_DARK) >= 4.5);
    assert.ok(contrast(rgbOf(accentFrom(dom, false).accent), GLASS_LIGHT) >= 4.5);
  }
});

test('accentFrom cambia el rojo por naranja y entrega variantes translúcidas', () => {
  const a = accentFrom({ h: 350, s: 0.9 }, false);
  const [h] = rgbToHsl(...rgbOf(a.accent));
  assert.ok(Math.abs(h - 32) < 2, `tono ${h}`);
  const rgb = rgbOf(a.accent).join(', ');
  assert.equal(a.accentSoft, `rgba(${rgb}, 0.18)`);
  assert.equal(a.accentBorder, `rgba(${rgb}, 0.45)`);
  assert.deepEqual(accentFrom(null, true), {});
});

test('averageColor promedia un bitmap BGRA y saturate(1) no cambia el color', () => {
  const half = Buffer.concat([bitmap(2, [200, 100, 0]), bitmap(2, [100, 50, 200])]);
  assert.deepEqual(averageColor(half), [150, 75, 100]);
  assert.deepEqual(saturate([150, 75, 100], 1), [150, 75, 100]);
});

/** Muestra de 48×48 en degradado vertical de `from` a `to`. */
function gradient(from, to) {
  const rows = Array.from({ length: 48 }, (_, y) =>
    bitmap(
      48,
      from.map((c, k) => Math.round(c + ((to[k] - c) * y) / 47)),
    ),
  );
  return Buffer.concat(rows);
}

const LEVELS = [0, 0.25, 0.5, 0.75, 1];
// Arena a tostado, como el fondo de las capturas; noche azul; casi blanco; casi negro.
const WALLPAPERS = {
  'claro cálido': gradient([236, 214, 184], [200, 164, 124]),
  noche: gradient([20, 30, 70], [70, 40, 90]),
  blanco: gradient([250, 250, 250], [235, 240, 245]),
  negro: gradient([5, 5, 8], [25, 20, 30]),
};
// Debe coincidir con --text y --text-2 de styles.css.
const TEXT = {
  dark: [
    [[0xf5, 0xf5, 0xf7], 1],
    [[255, 255, 255], 0.72],
  ],
  light: [
    [[0x1d, 0x1d, 0x1f], 1],
    [[0, 0, 0], 0.62],
  ],
};
const over = (top, a, bottom) => bottom.map((c, i) => Math.round(top[i] * a + c * (1 - a)));
// Pico de --sheen: en oscuro aclara el panel (peor caso); en claro el peor caso es sin brillo.
const panelOf = (tint, wall, dark) => over([255, 255, 255], dark ? 0.08 : 0, panelTinted(tint, wall));
const panelTinted = (tint, wall) =>
  over(rgbOf(tint).slice(0, 3), Number(tint.match(/[\d.]+\)$/)[0].slice(0, -1)), saturate(wall, 1.7));

test('tinte: texto principal ≥ 7 y secundario ≥ 4.5 en ambos temas, cualquier wallpaper y opacidad', () => {
  for (const [name, sample] of Object.entries(WALLPAPERS)) {
    const tones = wallTones(sample);
    for (const dark of [true, false]) {
      const [primary, secondary] = TEXT[dark ? 'dark' : 'light'];
      for (const level of LEVELS) {
        const { tint } = glassStyle(dominantHue(sample), tones, dark, level);
        for (const wall of [tones[0], dark ? tones[2] : tones[1]]) {
          const panel = panelOf(tint, wall, dark);
          const where = `${name}, ${dark ? 'oscuro' : 'claro'} ${level}`;
          assert.ok(contrast(primary[0], panel) >= 7, `principal ${where}`);
          assert.ok(contrast(over(secondary[0], secondary[1], panel), panel) >= 4.5, `secundario ${where}`);
        }
      }
    }
  }
});

test('control de Opacidad: 0 = mínimo legible, 1 = opaco, y siempre tiene efecto', () => {
  for (const [name, sample] of Object.entries(WALLPAPERS)) {
    const tones = wallTones(sample);
    for (const dark of [true, false]) {
      const min = minTintAlpha(tones, dark);
      assert.equal(tintAlpha(tones, dark, 0), min, name);
      assert.equal(tintAlpha(tones, dark, 1), 1, name);
      assert.ok(tintAlpha(tones, dark, 0.5) > min, `${name}: el control cambia el tinte`);
      assert.equal(tintAlpha(tones, dark, 7), 1, 'fuera de rango se limita');
    }
  }
  // En oscuro un wallpaper claro necesita más tinte mínimo que uno oscuro.
  assert.ok(minTintAlpha(wallTones(WALLPAPERS['claro cálido']), true) > 0.5);
  assert.equal(minTintAlpha(wallTones(WALLPAPERS.negro), true), 0);
  // Sin wallpaper se mide sobre el vidrio fijo del tema.
  assert.equal(
    glassStyle(null, null, true, 0).tint,
    `rgba(28, 28, 30, ${minTintAlpha(null, true).toFixed(3)})`,
  );
});

test('--text-3 ≥ 4.5, resumen rojo ≥ 3 (texto grande) y píldoras rojas ≥ 4.5, sin cambiar el tono', () => {
  const CSS = {
    dark: { text3: [0x7c, 0x7c, 0x80], redHead: [0xff, 0x72, 0x66] },
    light: { text3: [0x8e, 0x8e, 0x93], redHead: [0xd7, 0x00, 0x15] },
  };
  const hue = (rgb) => rgbToHsl(...rgb)[0];
  const sameHue = (a, b) => Math.abs(hue(a) - hue(b)) < 3 || rgbToHsl(...a)[1] < 0.05;
  assert.equal(LARGE_TEXT_CONTRAST, 3);
  for (const [name, sample] of Object.entries(WALLPAPERS)) {
    const tones = wallTones(sample);
    for (const dark of [true, false]) {
      const css = CSS[dark ? 'dark' : 'light'];
      for (const level of LEVELS) {
        const where = `${name}, ${dark ? 'oscuro' : 'claro'} ${level}`;
        const layers = tones.map((tone) => glassBackgrounds(tone, dark, tintAlpha(tones, dark, level)));
        const bgs = layers.flat();
        const panels = layers.flatMap(([panel, sheen]) => [panel, sheen]);
        const style = glassStyle(dominantHue(sample), tones, dark, level);
        assert.equal('dangerText' in style, false);
        const text3 = rgbOf(style.text3);
        const redHead = rgbOf(style.redHead);
        const lateBg = rgbOf(style.lateBg).slice(0, 3);
        for (const bg of bgs) assert.ok(contrast(text3, bg) >= 4.5, `text-3 ${where}`);
        // Resumen ≥ 3:1; en oscuro con el control en 0 sobre un wallpaper claro el pico del brillo no
        // lo permite con L ≤ 0.70 (≈ 2.9) y queda el mejor posible: el tope de luminosidad.
        const resumen = Math.min(...panels.map((bg) => contrast(redHead, bg)));
        if (resumen < 3) {
          assert.ok(dark && level === 0, `resumen ${where}: ${resumen.toFixed(2)}`);
          assert.ok(Math.abs(rgbToHsl(...redHead)[2] - RED_MAX_LIGHTNESS) < 0.005, `tope ${where}`);
          assert.ok(resumen > 2.85, `resumen ${where}: ${resumen.toFixed(2)}`);
        }
        // "Hace 2 d" y "Descartar" van sobre tarjetas; el encabezado "Atrasadas", sobre el panel.
        for (const bg of bgs) {
          assert.ok(contrast([255, 255, 255], over(lateBg, 0.9, bg)) >= 4.5, `píldora roja ${where}`);
        }
        assert.ok(sameHue(text3, css.text3), `tono text-3 ${where}`);
        assert.ok(sameHue(redHead, css.redHead), `tono resumen ${where}: ${redHead}`);
        assert.ok(sameHue(lateBg, [255, 69, 58]), `tono píldora ${where}: ${lateBg}`);
        if (dark) assert.ok(rgbToHsl(...redHead)[2] <= RED_MAX_LIGHTNESS + 0.005, `L resumen ${where}`);
      }
    }
  }
  // Un color que ya cumple no se toca.
  const dark = [
    [20, 20, 22],
    [20, 20, 22],
    [20, 20, 22],
  ];
  assert.equal(textStyle(true, [dark]).redHead, 'rgb(255, 114, 102)');
});

test('tinte mínimo: solo texto principal y secundario; fondo de demo en oscuro ≈ 0.78 con rango útil', () => {
  // Muestra de 48×48 del degradado de assets/demo-wallpaper.png (arena #f2d4b0 → lavanda #c9b2d8 a 135°).
  const demo = Buffer.concat(
    Array.from({ length: 48 * 48 }, (_, i) => {
      const t = ((i % 48) + Math.floor(i / 48)) / 94;
      const [r, g, b] = [0xf2, 0xd4, 0xb0].map((c, k) => Math.round(c + ([0xc9, 0xb2, 0xd8][k] - c) * t));
      return Buffer.from([b, g, r, 255]);
    }),
  );
  const min = minTintAlpha(wallTones(demo), true);
  assert.ok(min > 0.72 && min < 0.84, `mínimo ${min}`);
  // Rango útil del control: al menos un 15 % del recorrido del alfa.
  assert.ok(tintAlpha(wallTones(demo), true, 1) - tintAlpha(wallTones(demo), true, 0) >= 0.15);
  // Con el nivel por defecto (30 %) el resumen llega a 3:1 dentro de L ≤ 0.70.
  const tones = wallTones(demo);
  const red = rgbOf(glassStyle(dominantHue(demo), tones, true, 0.3).redHead);
  assert.ok(rgbToHsl(...red)[2] <= RED_MAX_LIGHTNESS + 0.005);
  const alpha = tintAlpha(tones, true, 0.3);
  for (const tone of tones) {
    for (const bg of glassBackgrounds(tone, true, alpha).slice(0, 2)) assert.ok(contrast(red, bg) >= 3);
  }
});

test('acento ≥ 4.5 contra panel y tarjetas en ambos temas y todas las opacidades', () => {
  for (const [name, sample] of Object.entries(WALLPAPERS)) {
    const dom = dominantHue(sample);
    if (!dom) continue; // gris: acento neutro de styles.css
    const tones = wallTones(sample);
    for (const dark of [true, false]) {
      for (const level of LEVELS) {
        const style = glassStyle(dom, tones, dark, level);
        const alpha = tintAlpha(tones, dark, level);
        const accent = rgbOf(style.accent);
        for (const bg of tones.flatMap((tone) => glassBackgrounds(tone, dark, alpha))) {
          const c = contrast(accent, bg);
          assert.ok(c >= 4.5, `${name}, ${dark ? 'oscuro' : 'claro'} ${level}: ${c.toFixed(2)} contra ${bg}`);
        }
      }
    }
  }
});

test('wallTones: promedio y percentiles 5 y 95 de luminancia', () => {
  const [avg, p5, p95] = wallTones(WALLPAPERS['claro cálido']);
  assert.deepEqual(avg, averageColor(WALLPAPERS['claro cálido']));
  assert.ok(contrast(p5, [0, 0, 0]) < contrast(avg, [0, 0, 0]));
  assert.ok(contrast(avg, [0, 0, 0]) < contrast(p95, [0, 0, 0]));
});
