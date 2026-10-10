'use strict';

/**
 * Lógica pura de la lista: agrupación por día, etiquetas de vencimiento, resumen superior y
 * formato de fechas. Sin DOM, para poder probarla con node:test.
 * Se carga como <script> en el renderer (global `createAgenda`) y con require() en las pruebas.
 */

/** Grupos de la lista, en orden de aparición. */
const AGENDA_GROUPS = ['overdue', 'today', 'tomorrow', 'week', 'later'];

/**
 * @param {(key: string, ...args: any[]) => string} t  traductor (ver i18n/)
 * @param {string} intlLocale                           locale para Intl, p. ej. "es-GT"
 */
function createAgenda(t, intlLocale) {
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  /** Por debajo de estas horas, el vencimiento se muestra como "En N h" y resaltado. */
  const SOON_HOURS = 6;
  const WEEK_DAYS = 7;

  const fmtTime = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat(intlLocale, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtFull = new Intl.DateTimeFormat(intlLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  const fmtTooltip = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'full', timeStyle: 'short' });

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Días de calendario entre `now` y `d` (0 = hoy, 1 = mañana, -1 = ayer). */
  function dayDiff(d, now) {
    return Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
  }

  /** Grupo de un pendiente. Lo vencido hoy se queda en "Hoy" con la etiqueta "Venció HH:MM". */
  function groupOf(item, now) {
    const due = new Date(item.due);
    const dd = dayDiff(due, now);
    if (dd === 0) return 'today';
    if (due < now) return 'overdue';
    if (dd === 1) return 'tomorrow';
    if (dd < WEEK_DAYS) return 'week';
    return 'later';
  }

  /** Map grupo → pendientes, con todos los grupos presentes (vacíos incluidos) y en orden. */
  function groupItems(items, now) {
    const groups = new Map(AGENDA_GROUPS.map((k) => [k, []]));
    for (const it of items) groups.get(groupOf(it, now)).push(it);
    return groups;
  }

  /** Texto corto de vencimiento y clase CSS: 'late' (vencido), 'soon' (menos de 6 h) o ''. */
  function dueLabel(item, now) {
    const due = new Date(item.due);
    const ms = due - now;
    if (ms < 0) {
      const days = -dayDiff(due, now);
      if (days === 0) return { text: t('due.at', fmtTime.format(due)), cls: 'late' };
      if (days === 1) return { text: t('due.yesterday'), cls: 'late' };
      return { text: t('due.daysAgo', days), cls: 'late' };
    }
    if (ms < HOUR_MS)
      return { text: t('due.inMinutes', Math.max(1, Math.round(ms / MINUTE_MS))), cls: 'soon' };
    if (ms < SOON_HOURS * HOUR_MS) return { text: t('due.inHours', Math.round(ms / HOUR_MS)), cls: 'soon' };
    const dd = dayDiff(due, now);
    if (dd <= 1) return { text: fmtTime.format(due), cls: '' };
    if (dd < WEEK_DAYS)
      return { text: `${cap(fmtDay.format(due).split(',')[0])} ${fmtTime.format(due)}`, cls: '' };
    return { text: formatDay(due), cls: '' };
  }

  /**
   * Resumen superior: `late` (atrasadas, en rojo) o `text` (para hoy / nada hoy), más el subtítulo `sub`.
   * Con atrasadas, el subtítulo dice lo de hoy y el total; sin nada hoy, cuál es el próximo.
   */
  function summary(items, now) {
    const groups = groupItems(items, now);
    const overdue = groups.get('overdue').length;
    const today = groups.get('today').length;
    const total = t('summary.total', items.length);

    if (overdue) {
      const todayText = today ? t('summary.today', today) : t('summary.nothingToday');
      return { late: t('summary.overdue', overdue), text: null, sub: `${todayText} · ${total}` };
    }
    if (today) return { late: null, text: t('summary.today', today), sub: total };

    const next = items.reduce((a, b) => (a && new Date(a.due) <= new Date(b.due) ? a : b), null);
    const sub = next ? t('summary.next', next.title, formatDay(new Date(next.due))) : '';
    return { late: null, text: t('summary.nothingPending'), sub };
  }

  const formatTime = (d) => fmtTime.format(d);
  const formatDay = (d) => cap(fmtDay.format(d));
  const formatFull = (d) => fmtFull.format(d);
  const formatTooltip = (d) => fmtTooltip.format(d);

  return {
    cap,
    dayDiff,
    groupOf,
    groupItems,
    dueLabel,
    summary,
    formatTime,
    formatDay,
    formatFull,
    formatTooltip,
  };
}

if (typeof module === 'object') module.exports = { AGENDA_GROUPS, createAgenda };
