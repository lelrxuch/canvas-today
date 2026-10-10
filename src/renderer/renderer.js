'use strict';

/* global I18N_ES, I18N_EN, createAgenda */

const api = window.canvas;
const $ = (sel) => document.querySelector(sel);

// styles.css ajusta controles de ventana, vidrio y tipografía con .platform-win32 / .platform-linux.
document.documentElement.classList.add(`platform-${api.platform}`);

/* ---------- idioma ---------- */

const DICTS = { es: I18N_ES, en: I18N_EN };
const dict = DICTS[api.locale.lang] || I18N_ES;
const intlLocale = api.locale.intlLocale || dict.intlLocale;

/** t(clave, ...datos): mismo comportamiento que translator() en src/main/i18n.js. */
function t(key, ...args) {
  const value = dict[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

const agenda = createAgenda(t, intlLocale);

/** Rellena los textos fijos del HTML marcados con data-i18n, data-i18n-title y data-i18n-placeholder. */
function applyStaticTexts() {
  document.documentElement.lang = api.locale.lang || 'es';
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const { i18n, i18nArg } = node.dataset;
    node.textContent = i18nArg === undefined ? t(i18n) : t(i18n, Number(i18nArg));
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
    node.setAttribute('aria-label', node.title);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
}

/* ---------- constantes de la vista ---------- */

const MINUTE_MS = 60 * 1000;
/** El chip del token aparece a partir de estos días y se pone rojo a partir de los segundos. */
const TOKEN_CHIP_DAYS = 14;
const TOKEN_CHIP_URGENT_DAYS = 3;
/** Canvas usa -1 para intentos ilimitados. */
const UNLIMITED_ATTEMPTS = -1;
const COURSE_PALETTE = [
  '#007aff',
  '#34c759',
  '#ff9500',
  '#af52de',
  '#ff2d55',
  '#5ac8fa',
  '#ffcc00',
  '#5856d6',
  '#00c7be',
  '#a2845e',
];

let current = null;
let view = 'list';
let expandedId = null;
const details = new Map(); // id → promesa de { ok, details }

/** Color estable por curso (hash del nombre sobre la paleta). */
function courseColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COURSE_PALETTE[h % COURSE_PALETTE.length];
}

/* ---------- elementos ---------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function loadDetails(item, card) {
  const box = card.querySelector('.desc');
  const pts = card.querySelector('.pts');
  if (!details.has(item.id)) details.set(item.id, api.getDetails(item.id));
  details.get(item.id).then((r) => {
    if (!r.ok) {
      details.delete(item.id);
      box.textContent = t('details.failed');
      return;
    }
    box.textContent = r.details.description || t('details.none');
    box.classList.toggle('muted', !r.details.description);
    if (r.details.pointsPossible !== null) pts.textContent = t('points', r.details.pointsPossible);
    const { lockAt, allowedAttempts: n } = r.details;
    card.querySelector('.lock').textContent = lockAt
      ? t('details.closes', agenda.formatFull(new Date(lockAt)))
      : '';
    let attempts = '';
    if (n === UNLIMITED_ATTEMPTS) attempts = t('details.unlimitedAttempts');
    else if (n > 0) attempts = t('details.attempts', n);
    card.querySelector('.attempts').textContent = attempts;
  });
}

function setExpanded(card, item, on) {
  card.classList.toggle('expanded', on);
  card.setAttribute('aria-expanded', String(on));
  card.querySelector('.extra').inert = !on;
  if (on) loadDetails(item, card);
}

/** Abre o cierra una tarjeta; solo una abierta a la vez. */
function toggleItem(card, item) {
  const on = !card.classList.contains('expanded');
  for (const other of document.querySelectorAll('.item.expanded')) {
    if (other !== card) other.dispatchEvent(new Event('collapse'));
  }
  expandedId = on ? item.id : null;
  setExpanded(card, item, on);
}

function renderItem(item, now) {
  const card = el('div', 'item');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.extra')) toggleItem(card, item);
  });
  card.addEventListener('keydown', (e) => {
    if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleItem(card, item);
    }
  });
  card.addEventListener('collapse', () => setExpanded(card, item, false));

  const dot = el('span', 'dot');
  dot.style.setProperty('--c', courseColor(item.course));

  const body = el('span', 'item-body');
  body.append(el('span', 'item-title', item.title));
  const metaParts = [item.course, item.typeLabel];
  if (item.points !== null) metaParts.push(t('points', item.points));
  body.append(el('span', 'meta', metaParts.join(' · ')));

  const label = agenda.dueLabel(item, now);
  const due = el('span', `due ${label.cls}`.trim(), label.text);
  due.title = agenda.formatTooltip(new Date(item.due));

  const extra = el('div', 'extra');
  const inner = el('div', 'extra-inner');
  const facts = el('div', 'facts');
  facts.append(el('span', '', agenda.cap(agenda.formatFull(new Date(item.due)))));
  facts.append(el('span', 'pts', item.points !== null ? t('points', item.points) : ''));
  facts.append(el('span', 'attempts'), el('span', 'lock'));
  inner.append(facts, el('p', 'desc', t('loading')));
  if (item.url) {
    const open = el('button', 'open-btn', t('details.open'));
    open.type = 'button';
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      api.openUrl(item.url);
    });
    inner.append(open);
  }
  extra.append(inner);

  card.append(dot, body, due, extra);
  setExpanded(card, item, item.id === expandedId);
  return card;
}

function renderSummary(s, now) {
  const box = $('#summary');
  box.replaceChildren();
  if (!s.items.length && !s.fetchedAt) return;
  const { late, text, sub } = agenda.summary(s.items, now);
  if (late) box.append(el('span', 'late', late));
  if (text) box.append(document.createTextNode(text));
  if (sub) box.append(el('small', '', sub));
}

function renderList(s) {
  const now = new Date();
  const list = $('#list');
  list.replaceChildren();
  renderSummary(s, now);

  if (!s.items.length) {
    if (s.fetchedAt && !s.error) {
      const empty = el('div', 'empty');
      empty.append(el('strong', '', t('empty.title')));
      empty.append(document.createTextNode(t('empty.body', s.config.daysAhead)));
      list.append(empty);
    }
    return;
  }

  for (const [key, items] of agenda.groupItems(s.items, now)) {
    if (!items.length) continue;
    const head = el('div', `section-head ${key === 'overdue' ? 'overdue' : ''}`.trim());
    head.append(el('span', '', t(`group.${key}`)), el('span', 'count', String(items.length)));
    list.append(head);
    for (const it of items) list.append(renderItem(it, now));
  }
}

function renderBanner(s) {
  const banner = $('#banner');
  const btn = $('#banner-btn');
  if (!s.error) {
    banner.hidden = true;
    return;
  }
  $('#banner-text').textContent = s.error.message;
  btn.hidden = false;
  if (s.error.code === 'auth' || s.error.code === 'config') {
    btn.textContent = t('banner.settings');
    btn.onclick = () => openSettings();
  } else {
    btn.textContent = t('banner.retry');
    btn.onclick = () => doRefresh();
  }
  banner.hidden = false;
}

function renderFooter(s) {
  let text = '';
  if (s.demo) text = t('footer.demo');
  else if (s.fetchedAt) text = t('footer.updated', agenda.formatTime(new Date(s.fetchedAt)));
  else if (!s.error) text = t('loading');
  $('#updated').textContent = text;

  const chip = $('#token-chip');
  const days = s.token.daysLeft;
  if (days !== null && days <= TOKEN_CHIP_DAYS) {
    chip.hidden = false;
    chip.className = days <= TOKEN_CHIP_URGENT_DAYS ? 'chip late' : 'chip';
    chip.textContent = days <= 0 ? t('chip.expired') : t('chip.days', days);
    chip.title = t('chip.hint');
  } else {
    chip.hidden = true;
  }
  $('#btn-open-canvas').hidden = !s.config.baseUrl;
  $('#btn-login').hidden = !s.config.baseUrl;
}

function applyLook(cfg) {
  document.documentElement.style.setProperty('--alpha', String(cfg.opacity));
  const pin = $('#btn-pin');
  pin.classList.toggle('on', cfg.alwaysOnTop);
  pin.title = t(cfg.alwaysOnTop ? 'pin.on' : 'pin.off');
  pin.setAttribute('aria-label', pin.title);
}

function render(s) {
  current = s;
  applyLook(s.config);
  if (view === 'list') {
    renderBanner(s);
    renderList(s);
  }
  renderFooter(s);
}

/* ---------- ajustes ---------- */

function setSelect(sel, value) {
  const v = String(value);
  if (![...sel.options].some((o) => o.value === v)) sel.append(new Option(v, v));
  sel.value = v;
}

function tokenStatus(token) {
  if (!token.exists) return { text: t('settings.tokenMissing'), warn: true };
  if (token.encrypted) return { text: t('settings.tokenEncrypted'), warn: false };
  if (!token.safePerms) return { text: t('settings.tokenUnsafe'), warn: true };
  return { text: t('settings.tokenFile', token.file), warn: false };
}

function fillForm(s) {
  const f = $('#form');
  const c = s.config;
  f.baseUrl.value = c.baseUrl ? new URL(c.baseUrl).host : '';
  f.loginPath.value = c.loginPath;
  f.token.value = '';
  f.tokenExpires.value = c.tokenExpires || '';
  setSelect(f.notifyHours, c.notifyHours);
  setSelect(f.daysAhead, c.daysAhead);
  setSelect(f.refreshMinutes, c.refreshMinutes);
  for (const r of f.querySelectorAll('input[name=theme]')) r.checked = r.value === c.theme;
  f.opacity.value = c.opacity;
  f.alwaysOnTop.checked = c.alwaysOnTop;
  f.autostart.checked = c.autostart;

  const status = $('#token-status');
  const { text, warn } = tokenStatus(s.token);
  status.className = warn ? 'hint warn' : 'hint';
  status.textContent = text;
  $('#form-error').hidden = true;
}

function openSettings() {
  if (!current) return;
  view = 'settings';
  fillForm(current);
  $('#view-list').hidden = true;
  $('#view-settings').hidden = false;
  $('#title').textContent = t('title.settings');
  $('#btn-settings').classList.add('active');
  $('#view-settings').scrollTop = 0;
}

function closeSettings() {
  view = 'list';
  $('#view-settings').hidden = true;
  $('#view-list').hidden = false;
  $('#title').textContent = t('title.list');
  $('#btn-settings').classList.remove('active');
  if (current) render(current);
}

async function saveSettings(e) {
  e.preventDefault();
  const f = $('#form');
  const payload = {
    baseUrl: f.baseUrl.value,
    loginPath: f.loginPath.value,
    token: f.token.value,
    tokenExpires: f.tokenExpires.value,
    notifyHours: Number(f.notifyHours.value),
    daysAhead: Number(f.daysAhead.value),
    refreshMinutes: Number(f.refreshMinutes.value),
    theme: f.querySelector('input[name=theme]:checked')?.value || 'system',
    opacity: Number(f.opacity.value),
    alwaysOnTop: f.alwaysOnTop.checked,
    autostart: f.autostart.checked,
  };
  const btn = $('#btn-save');
  btn.disabled = true;
  btn.textContent = t('settings.saving');
  try {
    const res = await api.saveSettings(payload);
    if (!res.ok) {
      const error = $('#form-error');
      error.textContent = res.error;
      error.hidden = false;
      error.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    f.token.value = '';
    current = res.state;
    closeSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = t('settings.save');
  }
}

/* ---------- acciones ---------- */

async function doRefresh() {
  const b = $('#btn-refresh');
  b.classList.add('spin');
  try {
    render(await api.refresh());
  } finally {
    b.classList.remove('spin');
  }
}

applyStaticTexts();

$('#btn-close').addEventListener('click', () => api.hide());
$('#btn-min').addEventListener('click', () => api.minimize());
$('#btn-pin').addEventListener('click', async () => render(await api.togglePin()));
$('#btn-refresh').addEventListener('click', doRefresh);
$('#btn-settings').addEventListener('click', () => (view === 'settings' ? closeSettings() : openSettings()));
$('#btn-open-canvas').addEventListener('click', () => api.openCanvas());
$('#btn-login').addEventListener('click', () => api.openLogin());
$('#btn-cancel').addEventListener('click', closeSettings);
$('#btn-quit').addEventListener('click', () => api.quit());
$('#form').addEventListener('submit', saveSettings);
$('#form').opacity.addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--alpha', e.target.value);
});
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (view === 'settings') closeSettings();
    else api.hide();
  }
  if (mod && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    doRefresh();
  }
  if (mod && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

api.onState(render);

const rootStyle = document.documentElement.style;
api.onWallpaper(({ url, accent, accentSoft, accentBorder }) => {
  if (url) rootStyle.setProperty('--wall', `url("${url}")`);
  else rootStyle.removeProperty('--wall');
  // Sin acento (fondo casi gris o sin wallpaper) queda el neutro de styles.css.
  const vars = [
    ['--accent', accent],
    ['--accent-soft', accentSoft],
    ['--accent-border', accentBorder],
  ];
  for (const [k, v] of vars) {
    if (v) rootStyle.setProperty(k, v);
    else rootStyle.removeProperty(k);
  }
});
api.onGeometry(({ x, y, width, height }) => {
  rootStyle.setProperty('--wx', `${x}px`);
  rootStyle.setProperty('--wy', `${y}px`);
  rootStyle.setProperty('--mw', `${width}px`);
  rootStyle.setProperty('--mh', `${height}px`);
});

// Refresca las etiquetas relativas ("En 20 min") cada minuto sin pedir datos.
setInterval(() => {
  if (current && view === 'list') render(current);
}, MINUTE_MS);

(async () => {
  const s = await api.getState();
  render(s);
  if (!s.demo && (!s.config.baseUrl || !s.token.exists)) openSettings();
})();
