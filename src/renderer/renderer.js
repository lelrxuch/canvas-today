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
/** Duración de la salida de una tarjeta descartada (igual que en styles.css) y del aviso para deshacer. */
const LEAVE_MS = 220;
const TOAST_MS = 6000;
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

/* ---------- pestañas ---------- */

const TABS = ['home', 'tasks', 'notes'];
/** Inicio muestra solo lo urgente; el resto queda en Tareas. */
const HOME_GROUPS = new Set(['overdue', 'today', 'tomorrow']);
const TAB_KEY = 'canvas-today.tab';

/** La pestaña se recuerda por comodidad; si el almacenamiento falla, se empieza en Inicio. */
function loadTab() {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.includes(saved) ? saved : 'home';
  } catch {
    return 'home';
  }
}

let tab = loadTab();

function setTab(name) {
  if (!TABS.includes(name)) return;
  tab = name;
  try {
    localStorage.setItem(TAB_KEY, name);
  } catch {
    /* sin almacenamiento: solo dura esta sesión */
  }
  expandedId = null;
  if (view !== 'list') setView('list', t('title.list'));
  else if (current) render(current);
  $('#view-list').scrollTop = 0;
}

const isNote = (it) => it.type === 'planner_note';
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
  if (item.type === 'planner_note') {
    // El detalle de una nota ya viene en el planner; no hay nada que pedir.
    box.textContent = item.details || t('note.noDetails');
    box.classList.toggle('muted', !item.details);
    return;
  }
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
    const closed = card.querySelector('.closed');
    if (closed && lockAt && new Date(lockAt) < new Date()) closed.textContent = t('discard.closed');
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
  const actions = el('div', 'actions');
  if (item.type === 'planner_note') {
    const edit = el('button', 'pill', t('note.edit'));
    edit.type = 'button';
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      openNote(item);
    });
    const del = el('button', 'pill danger', t('note.delete'));
    del.type = 'button';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeNote(card, item);
    });
    actions.append(edit, del);
  } else if (item.url) {
    const open = el('button', 'pill', t('details.open'));
    open.type = 'button';
    open.addEventListener('click', (e) => {
      e.stopPropagation();
      api.openUrl(item.url);
    });
    actions.append(open);
  }
  if (item.overdue && item.type !== 'planner_note') {
    const drop = el('button', 'pill danger', t('discard.button'));
    drop.type = 'button';
    drop.addEventListener('click', (e) => {
      e.stopPropagation();
      discard(card, item);
    });
    actions.append(drop, el('span', 'closed'));
  }
  if (actions.childElementCount) inner.append(actions);
  extra.append(inner);

  card.append(dot, body, due, extra);
  setExpanded(card, item, item.id === expandedId);
  return card;
}

/* ---------- descartar ---------- */

let toastTimer = null;

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

/** Aviso abajo durante TOAST_MS, con una acción opcional (Deshacer). */
function showToast(text, action, onAction) {
  $('#toast-text').textContent = text;
  const btn = $('#toast-btn');
  btn.hidden = !action;
  btn.textContent = action || '';
  btn.onclick = () => {
    hideToast();
    onAction();
  };
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

/** Colapsa la tarjeta, la saca con una animación y la marca completada en Canvas; si falla, vuelve. */
async function discard(card, item) {
  expandedId = null;
  setExpanded(card, item, false);
  card.style.maxHeight = `${card.offsetHeight}px`;
  void card.offsetHeight; // fija la altura de partida antes de animar
  card.classList.add('leaving');
  const [r] = await Promise.all([
    api.setComplete(item.id, true),
    new Promise((ok) => setTimeout(ok, LEAVE_MS)),
  ]);
  if (!r.ok) {
    card.classList.remove('leaving');
    card.style.maxHeight = '';
    showToast(r.error);
    return;
  }
  render(r.state);
  showToast(t('discard.done'), t('discard.undo'), async () => {
    const u = await api.setComplete(item.id, false);
    if (u.ok) render(u.state);
    else showToast(u.error);
  });
}

/** Datos de formulario a partir de una nota de la lista, para editarla o recrearla al deshacer. */
function noteInput(item) {
  const due = new Date(item.due);
  return {
    title: item.title,
    details: item.details || '',
    date: localDate(due),
    time: localTime(due),
    courseId: item.courseId ?? '',
  };
}

/** Saca la tarjeta con la misma animación que Descartar y borra la nota; Deshacer la vuelve a crear. */
async function removeNote(card, item) {
  expandedId = null;
  setExpanded(card, item, false);
  card.style.maxHeight = `${card.offsetHeight}px`;
  void card.offsetHeight;
  card.classList.add('leaving');
  const [r] = await Promise.all([api.deleteNote(item.id), new Promise((ok) => setTimeout(ok, LEAVE_MS))]);
  if (!r.ok) {
    card.classList.remove('leaving');
    card.style.maxHeight = '';
    showToast(r.error);
    return;
  }
  render(r.state);
  const input = noteInput(item);
  showToast(t('note.deleted'), t('discard.undo'), async () => {
    const u = await api.saveNote(input);
    if (u.ok) render(u.state);
    else showToast(u.error);
  });
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

function renderTabs(s) {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  }
  const notes = s.items.filter(isNote).length;
  const tasks = s.items.length - notes;
  $('#count-tasks').textContent = tasks ? String(tasks) : '';
  $('#count-notes').textContent = notes ? String(notes) : '';
}

/** Pendientes de la pestaña actual y lo que se muestra si no hay ninguno. */
function tabContent(s, now) {
  if (tab === 'notes') {
    return { items: s.items.filter(isNote), empty: [t('notes.emptyTitle'), t('notes.emptyBody')] };
  }
  if (tab === 'tasks') {
    return {
      items: s.items.filter((it) => !isNote(it)),
      empty: [t('empty.title'), t('empty.body', s.config.daysAhead)],
    };
  }
  const urgent = s.items.filter((it) => HOME_GROUPS.has(agenda.groupOf(it, now)));
  return {
    items: urgent,
    empty: [t('home.emptyTitle'), t('home.emptyBody')],
    // El enlace lleva a Tareas, así que solo cuenta tareas; las notas siguientes están en Notas.
    rest: s.items.filter((it) => !isNote(it) && !urgent.includes(it)).length,
  };
}

function renderList(s) {
  const now = new Date();
  const list = $('#list');
  list.replaceChildren();
  renderTabs(s);
  const { items, empty, rest } = tabContent(s, now);

  if (tab === 'notes') {
    const box = $('#summary');
    box.replaceChildren();
    if (s.fetchedAt || items.length) box.append(document.createTextNode(t('notes.count', items.length)));
  } else {
    // Inicio resume todo; Tareas, solo las tareas.
    renderSummary({ ...s, items: tab === 'home' ? s.items : items }, now);
  }

  if (!items.length) {
    if (s.fetchedAt && !s.error) {
      const box = el('div', 'empty');
      box.append(el('strong', '', empty[0]), document.createTextNode(empty[1]));
      list.append(box);
    }
  } else {
    for (const [key, groupItems] of agenda.groupItems(items, now)) {
      if (!groupItems.length) continue;
      const head = el('div', `section-head ${key === 'overdue' ? 'overdue' : ''}`.trim());
      // "Atrasadas" va como píldora roja con texto blanco, igual que "Hace 2 d".
      head.append(
        el('span', key === 'overdue' ? 'tag' : '', t(`group.${key}`)),
        el('span', 'count', String(groupItems.length)),
      );
      list.append(head);
      for (const it of groupItems) list.append(renderItem(it, now));
    }
  }

  if (tab === 'home' && rest > 0) {
    const more = el('button', 'link more', t('home.more', rest));
    more.type = 'button';
    more.addEventListener('click', () => setTab('tasks'));
    list.append(more);
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
  f.tintLevel.value = c.tintLevel;
  f.alwaysOnTop.checked = c.alwaysOnTop;
  f.autostart.checked = c.autostart;

  const status = $('#token-status');
  const { text, warn } = tokenStatus(s.token);
  status.className = warn ? 'hint warn' : 'hint';
  status.textContent = text;
  $('#form-error').hidden = true;
}

/** Muestra una de las vistas ('list', 'settings', 'note') y oculta las demás. */
function setView(name, title) {
  const leavingSettings = view === 'settings' && name !== 'settings';
  view = name;
  for (const v of ['list', 'settings', 'note']) $(`#view-${v}`).hidden = v !== name;
  $('#tabs').hidden = name !== 'list';
  $('#title').textContent = title;
  $('#btn-settings').classList.toggle('active', name === 'settings');
  $('#btn-note').classList.toggle('active', name === 'note');
  $(`#view-${name}`).scrollTop = 0;
  if (leavingSettings && current) previewOpacity(current.config.tintLevel); // deshace la vista previa si no se guardó
  if (name === 'list' && current) render(current);
}

function openSettings() {
  if (!current) return;
  fillForm(current);
  setView('settings', t('title.settings'));
}

function closeSettings() {
  setView('list', t('title.list'));
}

/* ---------- notas ---------- */

const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Nota que se está editando, o null si es nueva. */
let editingNote = null;

/** Cursos con pendientes en la lista: son los del ciclo actual, no los 30+ cursos viejos de la cuenta. */
function noteCourses(s, selectedId) {
  const map = new Map();
  for (const it of s.items) {
    if (it.courseId !== null && it.courseId !== undefined && it.type !== 'planner_note') {
      map.set(String(it.courseId), it.course);
    }
  }
  if (selectedId && !map.has(String(selectedId)) && editingNote) {
    map.set(String(selectedId), editingNote.course);
  }
  return [...map].sort((a, b) => a[1].localeCompare(b[1], intlLocale));
}

function openNote(item = null) {
  if (!current) return;
  editingNote = item;
  const f = $('#note-form');
  const values = item
    ? noteInput(item)
    : { title: '', details: '', date: localDate(new Date()), time: '', courseId: '' };
  f.title.value = values.title;
  f.details.value = values.details;
  f.date.value = values.date;
  // 23:59 es la hora por defecto; mostrar el campo vacío evita que parezca elegida.
  f.time.value = values.time === '23:59' ? '' : values.time;
  const sel = f.courseId;
  sel.replaceChildren(new Option(t('note.noCourse'), ''));
  for (const [id, name] of noteCourses(current, values.courseId)) sel.append(new Option(name, id));
  sel.value = String(values.courseId ?? '');
  $('#btn-note-delete').hidden = !item;
  $('#note-error').hidden = true;
  setView('note', t(item ? 'title.editNote' : 'title.newNote'));
  f.title.focus();
}

function closeNote() {
  editingNote = null;
  setView('list', t('title.list'));
}

function noteError(message) {
  const error = $('#note-error');
  error.textContent = message;
  error.hidden = false;
  error.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveNoteForm(e) {
  e.preventDefault();
  const f = $('#note-form');
  const payload = {
    id: editingNote ? editingNote.id : null,
    title: f.title.value,
    details: f.details.value,
    date: f.date.value,
    time: f.time.value,
    courseId: f.courseId.value,
  };
  const btn = $('#btn-note-save');
  btn.disabled = true;
  btn.textContent = t('settings.saving');
  try {
    const res = await api.saveNote(payload);
    if (!res.ok) {
      noteError(res.error);
      return;
    }
    current = res.state;
    closeNote();
  } finally {
    btn.disabled = false;
    btn.textContent = t('settings.save');
  }
}

async function deleteNoteFromForm() {
  if (!editingNote) return;
  const item = editingNote;
  const res = await api.deleteNote(item.id);
  if (!res.ok) {
    noteError(res.error);
    return;
  }
  current = res.state;
  closeNote();
  const input = noteInput(item);
  showToast(t('note.deleted'), t('discard.undo'), async () => {
    const u = await api.saveNote(input);
    if (u.ok) render(u.state);
    else showToast(u.error);
  });
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
    tintLevel: Number(f.tintLevel.value),
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
$('#btn-note').addEventListener('click', () => (view === 'note' ? closeNote() : openNote()));
$('#note-form').addEventListener('submit', saveNoteForm);
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
}
$('#btn-note-cancel').addEventListener('click', closeNote);
$('#btn-note-delete').addEventListener('click', deleteNoteFromForm);
$('#btn-open-canvas').addEventListener('click', () => api.openCanvas());
$('#btn-login').addEventListener('click', () => api.openLogin());
$('#btn-cancel').addEventListener('click', closeSettings);
$('#btn-quit').addEventListener('click', () => api.quit());
$('#form').addEventListener('submit', saveSettings);
$('#form').tintLevel.addEventListener('input', (e) => previewOpacity(e.target.value));
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (view === 'settings') closeSettings();
    else if (view === 'note') closeNote();
    else api.hide();
  }
  // Ctrl+1/2/3: Inicio, Tareas, Notas.
  if (mod && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    setTab(TABS[Number(e.key) - 1]);
  }
  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openNote();
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

/** Tinte, acento y colores de texto calculados en main. Lo que falta (fondo gris) queda como en styles.css. */
function applyGlass({ tint, text3, redHead, lateBg, accent, accentSoft, accentBorder }) {
  const vars = [
    ['--tint', tint],
    ['--text-3', text3],
    ['--red-head', redHead],
    ['--late-bg', lateBg],
    ['--accent', accent],
    ['--accent-soft', accentSoft],
    ['--accent-border', accentBorder],
  ];
  for (const [k, v] of vars) {
    if (v) rootStyle.setProperty(k, v);
    else rootStyle.removeProperty(k);
  }
}

/** Respuestas fuera de orden se descartan: gana la última posición del control. */
let previewSeq = 0;
async function previewOpacity(value) {
  const seq = ++previewSeq;
  const style = await api.previewOpacity(Number(value));
  if (seq === previewSeq) applyGlass(style);
}

api.onWallpaper((backdrop) => {
  if (backdrop.url) rootStyle.setProperty('--wall', `url("${backdrop.url}")`);
  else rootStyle.removeProperty('--wall');
  applyGlass(backdrop);
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
