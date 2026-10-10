'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { AppError } = require('./errors');
const { t } = require('./i18n');

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const CONFIG_FILE = 'config.json';
const STATE_FILE = 'state.json';

const DEFAULTS = {
  baseUrl: '',
  loginPath: '/login/saml',
  tokenExpires: '',
  notifyHours: 3,
  refreshMinutes: 15,
  daysAhead: 14,
  overdueDays: 14,
  theme: 'system',
  opacity: 0.92,
  alwaysOnTop: false,
  bounds: null,
};

const DEFAULT_STATE = { notified: {}, tokenWarnedOn: '' };

/** Rangos aceptados en Ajustes: [mínimo, máximo]. */
const LIMITS = {
  notifyHours: [1, 48],
  refreshMinutes: [5, 120],
  daysAhead: [1, 60],
  opacity: [0.6, 1],
};

const THEMES = ['system', 'light', 'dark'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^\d+~[A-Za-z0-9]+$/;

/* ---------- archivos ---------- */

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...fallback };
  }
}

/** Escribe un archivo legible solo por el usuario (600) dentro de un directorio 700. */
function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.writeFileSync(file, data, { mode: PRIVATE_FILE_MODE });
  fs.chmodSync(file, PRIVATE_FILE_MODE);
}

/** Lectura y escritura de config.json y state.json en `dir`. */
function createStore(dir) {
  const file = (name) => path.join(dir, name);
  return {
    loadConfig: () => readJson(file(CONFIG_FILE), DEFAULTS),
    loadState: () => readJson(file(STATE_FILE), DEFAULT_STATE),
    saveConfig: (config) => writePrivate(file(CONFIG_FILE), JSON.stringify(config, null, 2)),
    saveState: (state) => writePrivate(file(STATE_FILE), JSON.stringify(state, null, 2)),
  };
}

/** Copia config.json y state.json de la ubicación antigua si aún no existen en la nueva. */
function migrateLegacyFiles(fromDir, toDir) {
  for (const name of [CONFIG_FILE, STATE_FILE]) {
    const from = path.join(fromDir, name);
    const to = path.join(toDir, name);
    if (fs.existsSync(to) || !fs.existsSync(from)) continue;
    writePrivate(to, fs.readFileSync(from));
  }
}

/* ---------- validación ---------- */

function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new AppError('config', t('error.invalidUrl'));
  }
  if (u.protocol !== 'https:') throw new AppError('config', t('error.httpsOnly'));
  return u.origin;
}

function normalizeLoginPath(input) {
  const s = String(input || '').trim();
  if (!s) return DEFAULTS.loginPath;
  if (!s.startsWith('/') || s.includes('//')) throw new AppError('config', t('error.loginPath'));
  return s;
}

function clampNum(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Valida lo que llega del formulario de Ajustes.
 * Devuelve la configuración nueva y el token nuevo ('' si no se pegó ninguno).
 * Lanza AppError('config') si algo no es válido.
 */
function validateSettings(input, current) {
  const s = input || {};
  const config = {
    ...current,
    baseUrl: normalizeBaseUrl(s.baseUrl),
    loginPath: normalizeLoginPath(s.loginPath),
    tokenExpires: DATE_PATTERN.test(s.tokenExpires || '') ? s.tokenExpires : '',
    theme: THEMES.includes(s.theme) ? s.theme : DEFAULTS.theme,
    alwaysOnTop: Boolean(s.alwaysOnTop),
  };
  for (const [key, range] of Object.entries(LIMITS)) {
    config[key] = clampNum(s[key], range, DEFAULTS[key]);
  }

  const token = typeof s.token === 'string' ? s.token.trim() : '';
  if (token && !TOKEN_PATTERN.test(token)) throw new AppError('config', t('error.tokenFormat'));
  return { config, token };
}

/** Días hasta que vence el token según la fecha "Vence el"; null si no hay fecha válida. */
function tokenDaysLeft(tokenExpires, now = Date.now()) {
  if (!tokenExpires) return null;
  const exp = new Date(`${tokenExpires}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.ceil((exp - now) / DAY_MS);
}

module.exports = {
  DAY_MS,
  DEFAULTS,
  LIMITS,
  createStore,
  migrateLegacyFiles,
  writePrivate,
  validateSettings,
  tokenDaysLeft,
};
