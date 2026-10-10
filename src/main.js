'use strict';

const {
  app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification,
  nativeImage, nativeTheme, screen, net,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');

const APP_NAME = 'Canvas Today';
const DEMO = process.env.CANVAS_TODAY_DEMO === '1';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'canvas-widget');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const STATE_FILE = path.join(CONFIG_DIR, 'state.json');
const AUTOSTART_FILE = path.join(os.homedir(), '.config', 'autostart', 'canvas-today.desktop');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

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

let config = { ...DEFAULTS };
let state = { notified: {}, tokenWarnedOn: '' };
let cache = { items: [], fetchedAt: null, error: null };
let win = null;
let tray = null;
let timer = null;
let quitting = false;
let inFlight = null;

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---------- archivos ---------- */

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function readJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return { ...fallback }; }
}

function writePrivate(file, text) {
  ensureDir();
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const saveConfig = () => writePrivate(CONFIG_FILE, JSON.stringify(config, null, 2));
const saveState = () => writePrivate(STATE_FILE, JSON.stringify(state, null, 2));

function tokenInfo() {
  try {
    const st = fs.statSync(TOKEN_FILE);
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    return { exists: token.length > 0, safePerms: (st.mode & 0o077) === 0, token };
  } catch {
    return { exists: false, safePerms: true, token: '' };
  }
}

function tokenDaysLeft() {
  if (!config.tokenExpires) return null;
  const exp = new Date(`${config.tokenExpires}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.ceil((exp - Date.now()) / 864e5);
}

function normalizeBaseUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new AppError('config', 'La dirección de Canvas no es válida.'); }
  if (u.protocol !== 'https:') throw new AppError('config', 'La dirección de Canvas debe usar https.');
  return u.origin;
}

function normalizeLoginPath(input) {
  const s = String(input || '').trim();
  if (!s) return DEFAULTS.loginPath;
  if (!s.startsWith('/') || s.includes('//')) {
    throw new AppError('config', 'La ruta de inicio de sesión debe empezar con "/" y no contener "//".');
  }
  return s;
}

/* ---------- Canvas API ---------- */

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function canvasGet(apiPath) {
  const { token } = tokenInfo();
  if (!token) throw new AppError('auth', 'No hay token guardado.');
  const origin = new URL(config.baseUrl).origin;
  let url = new URL(apiPath, config.baseUrl).toString();
  const out = [];

  for (let page = 0; url && page < 10; page += 1) {
    // Nunca mandar el token fuera del dominio configurado.
    if (new URL(url).origin !== origin) break;

    let res;
    try {
      res = await net.fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch {
      throw new AppError('network', 'Sin conexión con Canvas.');
    }
    if (res.status === 401) throw new AppError('auth', 'El token no es válido o ya venció.');
    if (res.status === 403) throw new AppError('auth', 'Canvas rechazó el acceso con este token.');
    if (!res.ok) throw new AppError('http', `Canvas respondió con error ${res.status}.`);

    const data = await res.json();
    if (!Array.isArray(data)) return data;
    out.push(...data);
    url = nextLink(res.headers.get('link'));
  }
  return out;
}

const TYPE_LABELS = {
  assignment: 'Tarea',
  sub_assignment: 'Tarea',
  quiz: 'Examen',
  discussion_topic: 'Foro',
  wiki_page: 'Página',
  planner_note: 'Nota',
  assessment_request: 'Revisión',
};

function normalizeItem(raw, now) {
  if (!TYPE_LABELS[raw.plannable_type]) return null;
  const p = raw.plannable || {};
  const due = p.due_at || p.todo_date || raw.plannable_date;
  if (!due) return null;

  const s = raw.submissions || {};
  const done = s.submitted || s.graded || s.excused
    || (raw.planner_override && raw.planner_override.marked_complete);
  if (done) return null;

  let url = null;
  if (raw.html_url) {
    try { url = new URL(raw.html_url, config.baseUrl).toString(); } catch { url = null; }
  }

  return {
    id: `${raw.plannable_type}-${raw.plannable_id}`,
    courseId: raw.course_id ?? null,
    plannableId: raw.plannable_id ?? null,
    plannableType: raw.plannable_type,
    title: p.title || p.name || 'Sin título',
    course: raw.context_name || (raw.plannable_type === 'planner_note' ? 'Nota personal' : 'Canvas'),
    due: new Date(due).toISOString(),
    url,
    type: raw.plannable_type,
    typeLabel: TYPE_LABELS[raw.plannable_type],
    points: typeof p.points_possible === 'number' ? p.points_possible : null,
    overdue: new Date(due) < now,
  };
}

function htmlToText(html, max = 600) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return named[e.toLowerCase()] ?? m;
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      try { return String.fromCodePoint(n); } catch { return m; }
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const detailsCache = new Map();

async function fetchDetails(id) {
  if (detailsCache.has(id)) return detailsCache.get(id);
  const it = cache.items.find((x) => x.id === id);
  if (!it) throw new AppError('unknown', 'Pendiente no encontrado.');

  let d = { description: '', pointsPossible: it.points, submissionTypes: [], lockAt: null, allowedAttempts: null };
  if (DEMO) {
    d.description = 'Entrega un documento PDF con el desarrollo completo. Incluye portada, introducción y conclusiones.';
  } else {
    const c = String(it.courseId);
    const p = String(it.plannableId);
    const paths = {
      assignment: 'assignments',
      quiz: 'quizzes',
      discussion_topic: 'discussion_topics',
    };
    if (paths[it.plannableType] && /^\d+$/.test(c) && /^\d+$/.test(p)) {
      const r = await canvasGet(`/api/v1/courses/${c}/${paths[it.plannableType]}/${p}`);
      const a = r.assignment || {};
      d = {
        description: htmlToText(r.description ?? r.message),
        pointsPossible: r.points_possible ?? a.points_possible ?? it.points,
        submissionTypes: r.submission_types || a.submission_types || [],
        lockAt: r.lock_at ?? null,
        allowedAttempts: r.allowed_attempts ?? a.allowed_attempts ?? null,
      };
    }
  }
  detailsCache.set(id, d);
  return d;
}

async function fetchPending() {
  if (DEMO) return demoItems();
  if (!config.baseUrl) throw new AppError('config', 'Falta la dirección de Canvas.');
  if (!tokenInfo().exists) throw new AppError('auth', 'No hay token guardado.');

  const now = new Date();
  const qs = new URLSearchParams({
    start_date: new Date(now.getTime() - config.overdueDays * 864e5).toISOString(),
    end_date: new Date(now.getTime() + config.daysAhead * 864e5).toISOString(),
    per_page: '100',
  });
  const raw = await canvasGet(`/api/v1/planner/items?${qs}`);
  return raw
    .map((r) => normalizeItem(r, now))
    .filter(Boolean)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
}

/* ---------- avisos ---------- */

function shortDue(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms < 3600e3) return `en ${Math.max(1, Math.round(ms / 60000))} min`;
  return `en ${Math.round(ms / 3600e3)} h`;
}

function notifyDue(items) {
  if (!Notification.isSupported()) return;
  const now = Date.now();
  const horizon = config.notifyHours * 3600e3;
  const keep = {};

  for (const it of items) {
    const key = `${it.id}@${it.due}`;
    const t = new Date(it.due).getTime();
    if (state.notified[key]) keep[key] = state.notified[key];
    if (t > now && t - now <= horizon && !state.notified[key]) {
      const n = new Notification({
        title: it.title,
        body: `${it.course} · vence ${shortDue(it.due)}`,
        icon: ICON,
      });
      n.on('click', () => (it.url ? openSafe(it.url) : showWindow()));
      n.show();
      keep[key] = now;
    }
  }
  state.notified = keep;
  saveState();
}

function checkTokenExpiry() {
  const days = tokenDaysLeft();
  if (days === null || days > 7 || !Notification.isSupported()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (state.tokenWarnedOn === today) return;
  state.tokenWarnedOn = today;
  saveState();
  const body = days <= 0
    ? 'El token ya venció. Genera uno nuevo en Canvas y pégalo en Ajustes.'
    : `El token vence en ${days} ${days === 1 ? 'día' : 'días'}. Genera uno nuevo en Canvas y pégalo en Ajustes.`;
  const n = new Notification({ title: 'Token de Canvas', body, icon: ICON });
  n.on('click', showWindow);
  n.show();
}

/* ---------- ciclo de actualización ---------- */

function publicState() {
  const t = tokenInfo();
  return {
    items: cache.items,
    fetchedAt: cache.fetchedAt,
    error: cache.error,
    demo: DEMO,
    token: { exists: t.exists || DEMO, safePerms: t.safePerms, daysLeft: tokenDaysLeft(), path: TOKEN_FILE },
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
      autostart: isAutostart(),
    },
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const items = await fetchPending();
      cache = { items, fetchedAt: new Date().toISOString(), error: null };
      if (!DEMO) notifyDue(items);
    } catch (e) {
      cache = { ...cache, error: { code: e.code || 'unknown', message: e.message || 'Error desconocido.' } };
    }
    checkTokenExpiry();
    updateTray();
    const s = publicState();
    send('state', s);
    return s;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

function restartTimer() {
  clearInterval(timer);
  timer = setInterval(refresh, Math.max(5, config.refreshMinutes) * 60e3);
}

/* ---------- inicio automático ---------- */

function isAutostart() {
  return fs.existsSync(AUTOSTART_FILE);
}

function setAutostart(on) {
  if (!on) { fs.rmSync(AUTOSTART_FILE, { force: true }); return; }
  const exec = process.env.APPIMAGE
    ? `"${process.env.APPIMAGE}"`
    : `"${process.execPath}" "${app.getAppPath()}"`;
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(AUTOSTART_FILE, [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${APP_NAME}`,
    `Exec=${exec}`,
    'X-GNOME-Autostart-enabled=true',
    'X-GNOME-Autostart-Delay=10',
    '',
  ].join('\n'));
}

/* ---------- ventana y bandeja ---------- */

function openSafe(url) {
  try {
    const u = new URL(url);
    const base = config.baseUrl ? new URL(config.baseUrl).origin : null;
    if (u.protocol === 'https:' && base && u.origin === base) shell.openExternal(u.toString());
  } catch { /* URL inválida: se ignora */ }
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide(); else showWindow();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function throttle(fn, ms) {
  let t = null;
  return () => { if (!t) t = setTimeout(() => { t = null; fn(); }, ms); };
}

/* ---------- vidrio: fondo de pantalla simulado ---------- */

function wallpaperPath() {
  const key = nativeTheme.shouldUseDarkColors ? 'picture-uri-dark' : 'picture-uri';
  return new Promise((resolve) => {
    execFile('gsettings', ['get', 'org.gnome.desktop.background', key], (err, out) => {
      if (err) return resolve(null);
      const uri = out.trim().replace(/^'|'$/g, '');
      if (!uri.startsWith('file://')) return resolve(null);
      try { resolve(decodeURIComponent(uri.slice(7))); } catch { resolve(null); }
    });
  });
}

/* ---------- acento: color vivo dominante del wallpaper ---------- */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
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

function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Tono más pesado (24 cubetas ponderadas por saturación) y su saturación media; null si el fondo es casi gris.
function dominantHue(img) {
  const px = img.resize({ width: 48, height: 48 }).toBitmap(); // BGRA
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, hw: 0, n: 0 }));
  let passed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = rgbToHsl(px[i + 2], px[i + 1], px[i]);
    if (s < 0.2 || l < 0.12 || l > 0.92) continue;
    passed++;
    const b = buckets[Math.floor(h / 15) % 24];
    b.w += s; b.hw += h * s; b.n++;
  }
  if (passed < 0.08 * (px.length / 4)) return null;
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  return { h: best.hw / best.w, s: best.w / best.n };
}

// Ajusta el tono para que se lea sobre el vidrio (≥ 4.5:1) y no se confunda con el rojo de "atrasada".
function accentFrom(dom, dark) {
  if (!dom) return {};
  const h = dom.h < 25 || dom.h > 335 ? 32 : dom.h;
  const s = Math.min(0.8, Math.max(0.45, dom.s));
  const bg = dark ? [0x2c, 0x2c, 0x30] : [0xf2, 0xf2, 0xf4];
  let l = dark ? 0.72 : 0.38;
  let rgb = hslToRgb(h, s, l);
  while (contrast(rgb, bg) < 4.5 && l > 0 && l < 1) {
    l = dark ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
    rgb = hslToRgb(h, s, l);
  }
  const c = rgb.join(', ');
  return { accent: `rgb(${c})`, accentSoft: `rgba(${c}, 0.18)`, accentBorder: `rgba(${c}, 0.45)` };
}

async function sendWallpaper() {
  let payload = { url: null };
  try {
    const file = await wallpaperPath();
    const img = file ? nativeImage.createFromPath(file) : null;
    if (img && !img.isEmpty() && win && !win.isDestroyed()) {
      const { width } = screen.getDisplayMatching(win.getBounds()).size;
      payload = {
        url: `data:image/jpeg;base64,${img.resize({ width: Math.round(width / 2) }).toJPEG(80).toString('base64')}`,
        ...accentFrom(dominantHue(img), nativeTheme.shouldUseDarkColors),
      };
    }
  } catch { payload = { url: null }; }
  send('wallpaper', payload);
}

function sendGeometry() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b).bounds;
  send('geometry', { x: b.x - d.x, y: b.y - d.y, width: d.width, height: d.height });
}

function watchWallpaper() {
  const reload = debounce(sendWallpaper, 300);
  nativeTheme.on('updated', reload);
  const mon = spawn('gsettings', ['monitor', 'org.gnome.desktop.background']);
  mon.on('error', () => { /* sin gsettings: se queda el fondo actual */ });
  mon.stdout.on('data', reload);
  app.on('will-quit', () => mon.kill());
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 380;
  const h = 600;
  const bounds = config.bounds || {
    width: w, height: h, x: workArea.x + workArea.width - w - 12, y: workArea.y + 12,
  };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 360,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    show: false,
    title: APP_NAME,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const saveBounds = debounce(() => {
    if (win && !win.isDestroyed() && !win.isMinimized()) { config.bounds = win.getBounds(); saveConfig(); }
  }, 600);
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  const geometry = throttle(sendGeometry, 50);
  win.on('move', geometry);
  win.on('resize', geometry);
  win.webContents.on('did-finish-load', () => { sendGeometry(); sendWallpaper(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(img);
    tray.on('click', toggleWindow);
    updateTray();
  } catch { tray = null; }
}

function updateTray() {
  if (!tray) return;
  const total = cache.items.length;
  tray.setToolTip(`${APP_NAME} · ${total} ${total === 1 ? 'pendiente' : 'pendientes'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar u ocultar', click: toggleWindow },
    { label: 'Actualizar ahora', click: () => refresh() },
    { type: 'separator' },
    {
      label: 'Iniciar con el sistema', type: 'checkbox', checked: isAutostart(),
      click: (item) => { setAutostart(item.checked); send('state', publicState()); },
    },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.handle('get-state', () => publicState());
  ipcMain.handle('refresh', () => refresh());
  ipcMain.handle('get-details', async (_e, id) => {
    try { return { ok: true, details: await fetchDetails(String(id)) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('open-url', (_e, url) => openSafe(String(url)));
  ipcMain.handle('open-canvas', () => config.baseUrl && openSafe(config.baseUrl));
  ipcMain.handle('open-login', () => config.baseUrl && openSafe(config.baseUrl + config.loginPath));
  ipcMain.handle('hide', () => win && win.hide());
  ipcMain.handle('minimize', () => win && win.minimize());
  ipcMain.handle('toggle-pin', () => {
    config.alwaysOnTop = !config.alwaysOnTop;
    if (win) win.setAlwaysOnTop(config.alwaysOnTop);
    saveConfig();
    const s = publicState();
    send('state', s);
    return s;
  });
  ipcMain.handle('quit', () => { quitting = true; app.quit(); });

  ipcMain.handle('save-settings', async (_e, input) => {
    try {
      const s = input || {};
      const next = { ...config };
      next.baseUrl = normalizeBaseUrl(s.baseUrl);
      next.loginPath = normalizeLoginPath(s.loginPath);
      next.tokenExpires = /^\d{4}-\d{2}-\d{2}$/.test(s.tokenExpires || '') ? s.tokenExpires : '';
      next.notifyHours = clampNum(s.notifyHours, 1, 48, DEFAULTS.notifyHours);
      next.refreshMinutes = clampNum(s.refreshMinutes, 5, 120, DEFAULTS.refreshMinutes);
      next.daysAhead = clampNum(s.daysAhead, 1, 60, DEFAULTS.daysAhead);
      next.theme = ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system';
      next.opacity = clampNum(s.opacity, 0.6, 1, DEFAULTS.opacity);
      next.alwaysOnTop = Boolean(s.alwaysOnTop);

      const newToken = typeof s.token === 'string' ? s.token.trim() : '';
      if (newToken) {
        if (!/^\d+~[A-Za-z0-9]+$/.test(newToken)) {
          throw new AppError('config', 'El token no tiene el formato de Canvas (número~letras).');
        }
        writePrivate(TOKEN_FILE, `${newToken}\n`);
        state.tokenWarnedOn = '';
      }

      config = next;
      saveConfig();
      nativeTheme.themeSource = config.theme;
      if (win) win.setAlwaysOnTop(config.alwaysOnTop);
      setAutostart(Boolean(s.autostart));
      restartTimer();
      cache.error = null;
      await refresh();
      return { ok: true, state: publicState() };
    } catch (e) {
      return { ok: false, error: e.message || 'No se pudo guardar.' };
    }
  });
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ---------- demo ---------- */

function demoItems() {
  const now = Date.now();
  const at = (h) => new Date(now + h * 3600e3).toISOString();
  const day = (d, hh, mm) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(hh, mm, 0, 0); return x.toISOString(); };
  const mk = (id, title, course, due, type = 'assignment', points = 10) => ({
    id: `demo-${id}`, title, course, due, url: null, type, typeLabel: TYPE_LABELS[type], points,
    overdue: new Date(due) < new Date(),
  });
  return [
    mk(1, 'Diagrama entidad-relación normalizado', 'Bases de Datos I', day(-2, 23, 59)),
    mk(2, 'Configuración de reglas NAT en pfSense', 'Seguridad de Redes', at(1.6), 'assignment', 15),
    mk(3, 'Casos de uso: módulo de solicitudes', 'Análisis de Sistemas II', day(0, 23, 59)),
    mk(4, 'Corto 4: árboles B', 'Estructuras de Datos', day(1, 18, 0), 'quiz', 20),
    mk(5, 'Foro: ética en sistemas de información', 'Ética Profesional', day(3, 12, 0), 'discussion_topic', 5),
    mk(6, 'Informe de avance del invernadero', 'Microprocesadores', day(4, 20, 0), 'assignment', 25),
    mk(7, 'Proyecto final: plataforma de becas', 'Análisis de Sistemas II', day(12, 23, 59), 'assignment', 40),
  ].sort((a, b) => new Date(a.due) - new Date(b.due));
}

/* ---------- arranque ---------- */

// En Linux se necesita X11: en Wayland no funcionan "Mantener encima" ni la posición del vidrio.
// appendSwitch('ozone-platform') llega tarde en Electron 44 (la plataforma ya se eligió), así que
// se relanza una vez con el flag. El valor del switch antes de tocarlo es la plataforma efectiva.
// No se usa app.relaunch: su proceso auxiliar vive dentro del montaje de la AppImage, que
// desaparece al salir, y la app nunca vuelve a abrir.
function needsX11Relaunch() {
  return process.platform === 'linux'
    && app.commandLine.getSwitchValue('ozone-platform') !== 'x11'
    && Boolean(process.env.DISPLAY) // sin XWayland no hay X11 al que cambiar
    && !process.env.CANVAS_TODAY_X11_RELAUNCH;
}

if (needsX11Relaunch()) {
  spawn(process.env.APPIMAGE || process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], {
    detached: true,
    // fd 3 es el pipe con el que el runtime de la AppImage sabe que la app terminó; si se hereda,
    // la instancia original y su montaje nunca se cierran. 'ignore' no lo reemplaza; 'pipe' sí.
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, CANVAS_TODAY_X11_RELAUNCH: '1' },
  }).unref();
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { quitting = true; app.quit(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* sigue en segundo plano */ });

  app.whenReady().then(() => {
    app.setName(APP_NAME);
    config = readJson(CONFIG_FILE, DEFAULTS);
    state = readJson(STATE_FILE, { notified: {}, tokenWarnedOn: '' });
    nativeTheme.themeSource = config.theme;
    registerIpc();
    createWindow();
    watchWallpaper();
    createTray();
    refresh();
    restartTimer();
  });
}
