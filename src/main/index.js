'use strict';

const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, shell, nativeTheme, screen, net } = require('electron');

const i18n = require('./i18n');
const { t } = i18n;
const { AppError } = require('./errors');
const {
  DEFAULTS,
  LIMITS,
  createStore,
  migrateLegacyFiles,
  validateSettings,
  tokenDaysLeft,
} = require('./config');
const { createTokenStore } = require('./token-store');
const { createCanvasClient, byDue } = require('./canvas-api');
const { isDemo, demoItems, demoDetails } = require('./demo');
const { notifyDue, warnTokenExpiry } = require('./notifications');
const { createTray } = require('./tray');
const autostart = require('./autostart');
const platform = require('./platform');

const APP_NAME = 'Canvas Today';
const DEMO = isDemo();
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
/** Ubicación de versiones anteriores a 1.1; sus archivos se migran a userData. */
const LEGACY_DIR = path.join(os.homedir(), '.config', 'canvas-widget');

const MINUTE_MS = 60 * 1000;
const WINDOW = { width: 380, height: 600, minWidth: 320, minHeight: 360, margin: 12 };
const SAVE_BOUNDS_DELAY_MS = 600;
const GEOMETRY_THROTTLE_MS = 50;
const BACKDROP_DEBOUNCE_MS = 300;

let store = null;
let tokens = null;
let client = null;
let tray = null;
let locale = null;
let config = { ...DEFAULTS };
let state = null;
let cache = { items: [], fetchedAt: null, error: null };
let win = null;
let timer = null;
let quitting = false;
let inFlight = null;
/** Pendientes descartados en esta sesión (id → pendiente), para poder deshacer. */
const discarded = new Map();

/* ---------- utilidades ---------- */

function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms) {
  let id = null;
  return () => {
    if (!id) {
      id = setTimeout(() => {
        id = null;
        fn();
      }, ms);
    }
  };
}

/** Abre en el navegador solo URLs https del Canvas configurado. */
function openSafe(url) {
  try {
    const u = new URL(url);
    const base = config.baseUrl ? new URL(config.baseUrl).origin : null;
    if (u.protocol === 'https:' && base && u.origin === base) shell.openExternal(u.toString());
  } catch {
    /* URL inválida: se ignora */
  }
}

function quit() {
  quitting = true;
  app.quit();
}

/* ---------- estado y actualización ---------- */

/** Lo que ve el renderer: nunca incluye el token. */
function publicState() {
  const token = tokens.info();
  return {
    items: cache.items,
    fetchedAt: cache.fetchedAt,
    error: cache.error,
    demo: DEMO,
    token: {
      exists: token.exists || DEMO,
      encrypted: token.encrypted,
      safePerms: token.safePerms,
      file: token.file,
      daysLeft: tokenDaysLeft(config.tokenExpires),
    },
    config: {
      baseUrl: config.baseUrl,
      loginPath: config.loginPath,
      tokenExpires: config.tokenExpires,
      notifyHours: config.notifyHours,
      refreshMinutes: config.refreshMinutes,
      daysAhead: config.daysAhead,
      theme: config.theme,
      opacity: config.opacity,
      alwaysOnTop: config.alwaysOnTop,
      autostart: autostart.isEnabled(),
    },
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendState() {
  const s = publicState();
  send('state', s);
  return s;
}

/** Pide los pendientes, avisa de vencimientos y publica el estado. Llamadas simultáneas comparten la misma petición. */
function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const items = DEMO ? demoItems() : await client.fetchPending();
      cache = { items, fetchedAt: new Date().toISOString(), error: null };
      if (!DEMO) {
        notifyDue(items, state, {
          notifyHours: config.notifyHours,
          icon: ICON,
          onClick: (it) => (it.url ? openSafe(it.url) : showWindow()),
        });
        store.saveState(state);
      }
    } catch (e) {
      cache = { ...cache, error: { code: e.code || 'unknown', message: e.message || t('error.unknown') } };
    }
    if (warnTokenExpiry(tokenDaysLeft(config.tokenExpires), state, { icon: ICON, onClick: showWindow })) {
      store.saveState(state);
    }
    tray.update(cache.items.length);
    return sendState();
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function restartTimer() {
  clearInterval(timer);
  const [minMinutes] = LIMITS.refreshMinutes;
  timer = setInterval(refresh, Math.max(minMinutes, config.refreshMinutes) * MINUTE_MS);
}

/* ---------- ventana ---------- */

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

async function sendBackdrop() {
  if (!win || win.isDestroyed()) return;
  send('wallpaper', await platform.loadBackdrop(win.getBounds()));
}

/** Posición de la ventana dentro de su pantalla, para alinear el fondo simulado. */
function sendGeometry() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b).bounds;
  send('geometry', { x: b.x - d.x, y: b.y - d.y, width: d.width, height: d.height });
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = config.bounds || {
    width: WINDOW.width,
    height: WINDOW.height,
    x: workArea.x + workArea.width - WINDOW.width - WINDOW.margin,
    y: workArea.y + WINDOW.margin,
  };

  win = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    frame: false,
    ...platform.windowOptions(process.platform),
    alwaysOnTop: config.alwaysOnTop,
    show: false,
    title: APP_NAME,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // El preload lee idioma y plataforma de aquí: en sandbox no tiene acceso a app.getLocale().
      additionalArguments: [
        `--canvas-today-lang=${locale.lang}`,
        `--canvas-today-intl=${locale.intlLocale}`,
        `--canvas-today-platform=${process.platform}`,
      ],
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const saveBounds = debounce(() => {
    if (win && !win.isDestroyed() && !win.isMinimized()) {
      config.bounds = win.getBounds();
      store.saveConfig(config);
    }
  }, SAVE_BOUNDS_DELAY_MS);
  const geometry = throttle(sendGeometry, GEOMETRY_THROTTLE_MS);
  for (const event of ['move', 'resize']) {
    win.on(event, saveBounds);
    win.on(event, geometry);
  }
  win.webContents.on('did-finish-load', () => {
    sendGeometry();
    sendBackdrop();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/* ---------- IPC ---------- */

async function getDetails(id) {
  const item = cache.items.find((x) => x.id === id);
  if (!item) throw new AppError('unknown', t('error.itemNotFound'));
  return DEMO ? demoDetails(item) : client.fetchDetails(item);
}

/** Descarta (marca completado en Canvas) o restaura un pendiente y lo saca o devuelve a la lista. */
async function setComplete(id, complete) {
  const item = complete ? cache.items.find((x) => x.id === id) : discarded.get(id);
  if (!item) throw new AppError('unknown', t('error.itemNotFound'));
  if (!DEMO) item.overrideId = await (complete ? client.markComplete(item) : client.unmarkComplete(item));
  const rest = cache.items.filter((x) => x.id !== id);
  if (complete) discarded.set(id, item);
  else discarded.delete(id);
  cache.items = complete ? rest : [...rest, item].sort(byDue);
  tray.update(cache.items.length);
  return sendState();
}

async function saveSettings(input) {
  const { config: next, token } = validateSettings(input, config);
  if (token) {
    tokens.write(token);
    state.tokenWarnedOn = '';
  }
  config = next;
  store.saveConfig(config);
  nativeTheme.themeSource = config.theme;
  if (win) win.setAlwaysOnTop(config.alwaysOnTop);
  autostart.setEnabled(Boolean(input && input.autostart));
  restartTimer();
  cache.error = null;
  await refresh();
  return publicState();
}

function registerIpc() {
  ipcMain.handle('get-state', () => publicState());
  ipcMain.handle('refresh', () => refresh());
  ipcMain.handle('get-details', async (_e, id) => {
    try {
      return { ok: true, details: await getDetails(String(id)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('set-complete', async (_e, id, complete) => {
    try {
      return { ok: true, state: await setComplete(String(id), Boolean(complete)) };
    } catch (e) {
      return { ok: false, error: e.message || t('error.unknown') };
    }
  });
  ipcMain.handle('open-url', (_e, url) => openSafe(String(url)));
  ipcMain.handle('open-canvas', () => config.baseUrl && openSafe(config.baseUrl));
  ipcMain.handle('open-login', () => config.baseUrl && openSafe(config.baseUrl + config.loginPath));
  ipcMain.handle('hide', () => win && win.hide());
  ipcMain.handle('minimize', () => win && win.minimize());
  ipcMain.handle('toggle-pin', () => {
    config.alwaysOnTop = !config.alwaysOnTop;
    if (win) win.setAlwaysOnTop(config.alwaysOnTop);
    store.saveConfig(config);
    return sendState();
  });
  ipcMain.handle('quit', quit);
  ipcMain.handle('save-settings', async (_e, input) => {
    try {
      return { ok: true, state: await saveSettings(input) };
    } catch (e) {
      return { ok: false, error: e.message || t('error.saveFailed') };
    }
  });
}

/* ---------- arranque ---------- */

function start() {
  app.setName(APP_NAME);
  platform.setup();
  locale = i18n.init(app.getLocale());

  const dir = app.getPath('userData');
  migrateLegacyFiles(LEGACY_DIR, dir);
  store = createStore(dir);
  config = store.loadConfig();
  state = store.loadState();
  tokens = createTokenStore(dir, path.join(LEGACY_DIR, 'token'));
  tokens.migrate();
  client = createCanvasClient({ fetch: net.fetch, getConfig: () => config, getToken: tokens.read });

  nativeTheme.themeSource = config.theme;
  registerIpc();
  createWindow();
  const stopWatching = platform.watchBackdrop(debounce(sendBackdrop, BACKDROP_DEBOUNCE_MS));
  app.on('will-quit', stopWatching);
  tray = createTray({
    icon: ICON,
    onToggle: toggleWindow,
    onRefresh: () => refresh(),
    onQuit: quit,
    isAutostart: autostart.isEnabled,
    onAutostart: (on) => {
      autostart.setEnabled(on);
      sendState();
    },
  });
  refresh();
  restartTimer();
}

if (platform.relaunchInX11IfNeeded()) {
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, quit);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    /* sigue en segundo plano en la bandeja */
  });
  app.whenReady().then(start);
}
