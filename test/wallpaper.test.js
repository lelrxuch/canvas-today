'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rgbToHsl, hslToRgb, contrast, dominantHue, accentFrom } = require('../src/main/wallpaper');

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
