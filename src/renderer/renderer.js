'use strict';

const api = window.canvas;
const $ = (sel) => document.querySelector(sel);

const fmtTime = new Intl.DateTimeFormat('es-GT', { hour: 'numeric', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short' });

const GROUPS = [
  ['overdue', 'Atrasadas'],
  ['today', 'Hoy'],
  ['tomorrow', 'Mañana'],
  ['week', 'Esta semana'],
  ['later', 'Más adelante'],
];

let current = null;
let view = 'list';

/* ---------- fechas ---------- */

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function groupOf(item) {
  const due = new Date(item.due);
  const dd = dayDiff(due);
  if (dd === 0) return 'today'; // aunque ya haya vencido: se queda en Hoy con "Venció HH:MM"
  if (due < new Date()) return 'overdue';
  if (dd === 1) return 'tomorrow';
  if (dd < 7) return 'week';
  return 'later';
}

function dueLabel(item) {
  const due = new Date(item.due);
  const ms = due - Date.now();
  if (ms < 0) {
    const d = -dayDiff(due);
    if (d === 0) return { text: `Venció ${fmtTime.format(due)}`, cls: 'late' };
    if (d === 1) return { text: 'Ayer', cls: 'late' };
    return { text: `Hace ${d} d`, cls: 'late' };
  }
  if (ms < 3600e3) return { text: `En ${Math.max(1, Math.round(ms / 60000))} min`, cls: 'soon' };
  if (ms < 6 * 3600e3) return { text: `En ${Math.round(ms / 3600e3)} h`, cls: 'soon' };
  const dd = dayDiff(due);
  if (dd <= 1) return { text: fmtTime.format(due), cls: '' };
  if (dd < 7) return { text: cap(fmtDay.format(due).split(',')[0]) + ' ' + fmtTime.format(due), cls: '' };
  return { text: cap(fmtDay.format(due)), cls: '' };
}

function courseColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const palette = ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#5856d6', '#00c7be', '#a2845e'];
  return palette[h % palette.length];
}

/* ---------- elementos ---------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmtFull = new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const details = new Map(); // id -> promesa de { ok, details }
let expandedId = null;

function loadDetails(item, card) {
  const box = card.querySelector('.desc');
  const pts = card.querySelector('.pts');
  if (!details.has(item.id)) details.set(item.id, api.getDetails(item.id));
  details.get(item.id).then((r) => {
    if (!r.ok) {
      details.delete(item.id);
      box.textContent = 'No se pudieron cargar las instrucciones.';
      return;
    }
    box.textContent = r.details.description || 'Sin instrucciones';
    box.classList.toggle('muted', !r.details.description);
    if (r.details.pointsPossible !== null) pts.textContent = `${r.details.pointsPossible} pts`;
    const { lockAt, allowedAttempts: n } = r.details;
    card.querySelector('.lock').textContent = lockAt ? `Cierra: ${fmtFull.format(new Date(lockAt))}` : '';
    // Canvas usa -1 para intentos ilimitados.
    card.querySelector('.attempts').textContent = n === -1 ? 'Intentos ilimitados'
      : n > 0 ? `${n} ${n === 1 ? 'intento' : 'intentos'}` : '';
  });
}

function setExpanded(card, item, on) {
  card.classList.toggle('expanded', on);
  card.setAttribute('aria-expanded', String(on));
  card.querySelector('.extra').inert = !on;
  if (on) loadDetails(item, card);
}

function toggleItem(card, item) {
  const on = !card.classList.contains('expanded');
  for (const other of document.querySelectorAll('.item.expanded')) if (other !== card) other.dispatchEvent(new Event('collapse'));
  expandedId = on ? item.id : null;
  setExpanded(card, item, on);
}

function renderItem(item) {
  const card = el('div', 'item');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.addEventListener('click', (e) => { if (!e.target.closest('.extra')) toggleItem(card, item); });
  card.addEventListener('keydown', (e) => {
    if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleItem(card, item); }
  });
  card.addEventListener('collapse', () => setExpanded(card, item, false));

  const dot = el('span', 'dot');
  dot.style.setProperty('--c', courseColor(item.course));

  const body = el('span', 'item-body');
  body.append(el('span', 'item-title', item.title));
  const metaParts = [item.course, item.typeLabel];
  if (item.points !== null) metaParts.push(`${item.points} pts`);
  body.append(el('span', 'meta', metaParts.join(' · ')));

  const d = dueLabel(item);
  const due = el('span', `due ${d.cls}`.trim(), d.text);
  due.title = new Date(item.due).toLocaleString('es-GT', { dateStyle: 'full', timeStyle: 'short' });

  const extra = el('div', 'extra');
  const inner = el('div', 'extra-inner');
  const facts = el('div', 'facts');
  facts.append(el('span', '', cap(fmtFull.format(new Date(item.due)))));
  facts.append(el('span', 'pts', item.points !== null ? `${item.points} pts` : ''));
  facts.append(el('span', 'attempts'), el('span', 'lock'));
  inner.append(facts, el('p', 'desc', 'Cargando…'));
  if (item.url) {
    const open = el('button', 'open-btn', 'Abrir en Canvas');
    open.type = 'button';
    open.addEventListener('click', (e) => { e.stopPropagation(); api.openUrl(item.url); });
    inner.append(open);
  }
  extra.append(inner);

  card.append(dot, body, due, extra);
  setExpanded(card, item, item.id === expandedId);
  return card;
}

function renderList(s) {
  const list = $('#list');
  list.replaceChildren();

  const groups = new Map(GROUPS.map(([k]) => [k, []]));
  for (const it of s.items) groups.get(groupOf(it)).push(it);

  const today = groups.get('today').length;
  const overdue = groups.get('overdue').length;
  const summary = $('#summary');
  summary.replaceChildren();
  if (s.items.length || s.fetchedAt) {
    const total = `${s.items.length} en total`;
    let sub = total;
    if (overdue) {
      summary.append(el('span', 'late', `${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'}`));
      sub = `${today ? `${today} para hoy` : 'nada para hoy'} · ${total}`;
    } else if (today) {
      summary.append(document.createTextNode(`${today} para hoy`));
    } else {
      summary.append(document.createTextNode('Nada pendiente hoy'));
      const next = s.items.reduce((a, b) => (a && new Date(a.due) <= new Date(b.due) ? a : b), null);
      sub = next ? `Próxima: ${next.title} · ${cap(fmtDay.format(new Date(next.due)))}` : '';
    }
    if (sub) summary.append(el('small', '', sub));
  }

  if (!s.items.length) {
    if (s.fetchedAt && !s.error) {
      const empty = el('div', 'empty');
      empty.append(el('strong', '', 'Sin pendientes'));
      empty.append(document.createTextNode(`No hay entregas en los próximos ${s.config.daysAhead} días.`));
      list.append(empty);
    }
    return;
  }

  for (const [key, label] of GROUPS) {
    const items = groups.get(key);
    if (!items.length) continue;
    const head = el('div', `section-head ${key === 'overdue' ? 'overdue' : ''}`.trim());
    head.append(el('span', '', label), el('span', 'count', String(items.length)));
    list.append(head);
    for (const it of items) list.append(renderItem(it));
  }
}

function renderBanner(s) {
  const banner = $('#banner');
  const btn = $('#banner-btn');
  if (!s.error) { banner.hidden = true; return; }
  $('#banner-text').textContent = s.error.message;
  btn.hidden = false;
  if (s.error.code === 'auth' || s.error.code === 'config') {
    btn.textContent = 'Ajustes';
    btn.onclick = () => openSettings();
  } else {
    btn.textContent = 'Reintentar';
    btn.onclick = () => doRefresh();
  }
  banner.hidden = false;
}

function renderFooter(s) {
  let text = '';
  if (s.demo) text = 'Modo demostración';
  else if (s.fetchedAt) text = `Actualizado ${fmtTime.format(new Date(s.fetchedAt))}`;
  else if (!s.error) text = 'Cargando…';
  $('#updated').textContent = text;

  const chip = $('#token-chip');
  const days = s.token.daysLeft;
  if (days !== null && days <= 14) {
    chip.hidden = false;
    chip.className = days <= 3 ? 'chip late' : 'chip';
    chip.textContent = days <= 0 ? 'Token vencido' : `Token: ${days} d`;
    chip.title = 'Genera un token nuevo en Canvas y pégalo en Ajustes';
  } else {
    chip.hidden = true;
  }
  $('#btn-open-canvas').hidden = !s.config.baseUrl;
  $('#btn-login').hidden = !s.config.baseUrl;
}

function applyLook(cfg) {
  document.documentElement.style.setProperty('--alpha', String(cfg.opacity));
  $('#btn-pin').classList.toggle('on', cfg.alwaysOnTop);
  $('#btn-pin').title = cfg.alwaysOnTop ? 'Dejar de mantener encima' : 'Mantener encima';
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
  status.className = 'hint';
  if (!s.token.exists) {
    status.textContent = 'No hay token guardado. Pégalo abajo.';
    status.classList.add('warn');
  } else if (!s.token.safePerms) {
    status.textContent = 'Token guardado, pero otros usuarios pueden leerlo. Ejecuta chmod 600 en el archivo.';
    status.classList.add('warn');
  } else {
    status.textContent = 'Token guardado en ~/.config/canvas-widget/token';
  }
  $('#form-error').hidden = true;
}

function openSettings() {
  if (!current) return;
  view = 'settings';
  fillForm(current);
  $('#view-list').hidden = true;
  $('#view-settings').hidden = false;
  $('#title').textContent = 'Ajustes';
  $('#btn-settings').classList.add('active');
  $('#view-settings').scrollTop = 0;
}

function closeSettings() {
  view = 'list';
  $('#view-settings').hidden = true;
  $('#view-list').hidden = false;
  $('#title').textContent = 'Pendientes';
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
  btn.textContent = 'Guardando…';
  try {
    const res = await api.saveSettings(payload);
    if (!res.ok) {
      $('#form-error').textContent = res.error;
      $('#form-error').hidden = false;
      $('#form-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    f.token.value = '';
    current = res.state;
    closeSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

/* ---------- acciones ---------- */

async function doRefresh() {
  const b = $('#btn-refresh');
  b.classList.add('spin');
  try { render(await api.refresh()); } finally { b.classList.remove('spin'); }
}

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
  if (e.key === 'Escape') { if (view === 'settings') closeSettings(); else api.hide(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); doRefresh(); }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings(); }
});

api.onState(render);

const rootStyle = document.documentElement.style;
api.onWallpaper(({ url, accent, accentSoft, accentBorder }) => {
  if (url) rootStyle.setProperty('--wall', `url("${url}")`); else rootStyle.removeProperty('--wall');
  // Sin acento (fondo casi gris o sin wallpaper) queda el neutro de styles.css.
  for (const [k, v] of [['--accent', accent], ['--accent-soft', accentSoft], ['--accent-border', accentBorder]]) {
    if (v) rootStyle.setProperty(k, v); else rootStyle.removeProperty(k);
  }
});
api.onGeometry(({ x, y, width, height }) => {
  rootStyle.setProperty('--wx', `${x}px`);
  rootStyle.setProperty('--wy', `${y}px`);
  rootStyle.setProperty('--mw', `${width}px`);
  rootStyle.setProperty('--mh', `${height}px`);
});

// Refresca las etiquetas relativas ("En 20 min") cada minuto sin pedir datos.
setInterval(() => { if (current && view === 'list') render(current); }, 60e3);

(async () => {
  const s = await api.getState();
  render(s);
  if (!s.demo && (!s.config.baseUrl || !s.token.exists)) openSettings();
})();
