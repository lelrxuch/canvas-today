'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateSettings, migrateConfig, tokenDaysLeft } = require('../src/main/config');

test('validateSettings normaliza la dirección y limita los números', () => {
  const { config, token } = validateSettings(
    { baseUrl: ' canvas.example.edu/courses ', notifyHours: 999, tintLevel: -0.5, theme: 'neon', token: '' },
    DEFAULTS,
  );
  assert.equal(config.baseUrl, 'https://canvas.example.edu');
  assert.equal(config.notifyHours, 48);
  assert.equal(config.tintLevel, 0);
  assert.equal(config.theme, 'system');
  assert.equal(config.loginPath, '/login/saml');
  assert.equal(config.refreshMinutes, DEFAULTS.refreshMinutes);
  assert.equal(token, '');
});

test('validateSettings rechaza http, rutas raras y tokens mal formados', () => {
  assert.throws(() => validateSettings({ baseUrl: 'http://c.edu' }, DEFAULTS), { code: 'config' });
  assert.throws(() => validateSettings({ loginPath: 'login' }, DEFAULTS), { code: 'config' });
  assert.throws(() => validateSettings({ loginPath: '//evil' }, DEFAULTS), { code: 'config' });
  assert.throws(() => validateSettings({ token: 'abc' }, DEFAULTS), { code: 'config' });
  assert.equal(validateSettings({ token: ' 1234~AbC9 ' }, DEFAULTS).token, '1234~AbC9');
});

test('tokenDaysLeft cuenta días hasta la fecha de vencimiento', () => {
  const now = new Date(2026, 9, 10, 15, 0).getTime();
  assert.equal(tokenDaysLeft('2026-10-17', now), 7);
  assert.equal(tokenDaysLeft('2026-10-10', now), -0);
  assert.equal(tokenDaysLeft('', now), null);
  assert.equal(tokenDaysLeft('nope', now), null);
});

test('migrateConfig pasa la opacidad 0.6–1 de la versión 1.0 a tintLevel (0–1)', () => {
  const old = { ...DEFAULTS, opacity: 0.92 };
  delete old.tintLevel;
  const migrated = migrateConfig({ ...DEFAULTS, ...old });
  assert.equal(migrated.tintLevel, 0.34);
  assert.equal('opacity' in migrated, false);
  assert.equal(migrateConfig({ ...DEFAULTS, opacity: 'x' }).tintLevel, DEFAULTS.tintLevel);
  const current = { ...DEFAULTS, tintLevel: 0.7 };
  assert.equal(migrateConfig(current), current);
});
