'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { windowOptions, systemAccent, needsX11Relaunch } = require('../src/main/platform');
const { accentFrom, contrast, rgbToHsl } = require('../src/main/color');

const rgbOf = (css) => css.match(/\d+/g).map(Number);

test('windowOptions: acrílico solo en Windows, transparencia en Linux', () => {
  const win = windowOptions('win32');
  assert.equal(win.backgroundMaterial, 'acrylic');
  assert.equal(win.transparent, false);
  const linux = windowOptions('linux');
  assert.equal(linux.backgroundMaterial, undefined);
  assert.equal(linux.transparent, true);
});

test('systemAccent usa el ajuste de contraste del wallpaper', () => {
  // Azul por defecto de Windows 11 (#0078D4) en formato RRGGBBAA.
  const a = systemAccent('0078d4ff', true);
  assert.ok(contrast(rgbOf(a.accent), [0x2c, 0x2c, 0x30]) >= 4.5);
  const [h, s] = rgbToHsl(0x00, 0x78, 0xd4);
  assert.deepEqual(systemAccent('0078d4ff', false), accentFrom({ h, s }, false));
});

test('systemAccent: gris o inválido → acento neutro', () => {
  assert.deepEqual(systemAccent('808080ff', true), {});
  assert.deepEqual(systemAccent('', true), {});
  assert.deepEqual(systemAccent(undefined, false), {});
});

test('needsX11Relaunch solo en Linux, fuera de X11, con DISPLAY y una vez', () => {
  const base = { platform: 'linux', ozone: 'wayland', env: { DISPLAY: ':0' } };
  assert.equal(needsX11Relaunch(base), true);
  assert.equal(needsX11Relaunch({ ...base, platform: 'win32' }), false);
  assert.equal(needsX11Relaunch({ ...base, ozone: 'x11' }), false);
  assert.equal(needsX11Relaunch({ ...base, env: {} }), false);
  assert.equal(needsX11Relaunch({ ...base, env: { DISPLAY: ':0', CANVAS_TODAY_X11_RELAUNCH: '1' } }), false);
});
