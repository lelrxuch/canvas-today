'use strict';

const { Notification } = require('electron');
const { t } = require('./i18n');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** El aviso de token empieza esta cantidad de días antes de que venza. */
const TOKEN_WARN_DAYS = 7;

function relativeDue(iso, now) {
  const ms = new Date(iso) - now;
  if (ms < HOUR_MS) return t('notify.inMinutes', Math.max(1, Math.round(ms / MINUTE_MS)));
  return t('notify.inHours', Math.round(ms / HOUR_MS));
}

/**
 * Avisa una sola vez por pendiente (id + fecha) cuando vence dentro de `notifyHours`.
 * Actualiza `state.notified`, quitando los pendientes que ya no están en la lista.
 */
function notifyDue(items, state, { notifyHours, icon, onClick }) {
  if (!Notification.isSupported()) return;
  const now = Date.now();
  const horizon = notifyHours * HOUR_MS;
  const keep = {};

  for (const it of items) {
    const key = `${it.id}@${it.due}`;
    const dueAt = new Date(it.due).getTime();
    if (state.notified[key]) keep[key] = state.notified[key];
    if (dueAt > now && dueAt - now <= horizon && !state.notified[key]) {
      const n = new Notification({
        title: it.title,
        body: t('notify.due', it.course, relativeDue(it.due, now)),
        icon,
      });
      n.on('click', () => onClick(it));
      n.show();
      keep[key] = now;
    }
  }
  state.notified = keep;
}

/** Avisa una vez al día si al token le quedan TOKEN_WARN_DAYS días o menos. Devuelve true si avisó. */
function warnTokenExpiry(daysLeft, state, { icon, onClick }) {
  if (daysLeft === null || daysLeft > TOKEN_WARN_DAYS || !Notification.isSupported()) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (state.tokenWarnedOn === today) return false;
  state.tokenWarnedOn = today;
  const body = daysLeft <= 0 ? t('notify.tokenExpired') : t('notify.tokenExpiring', daysLeft);
  const n = new Notification({ title: t('notify.tokenTitle'), body, icon });
  n.on('click', onClick);
  n.show();
  return true;
}

module.exports = { notifyDue, warnTokenExpiry };
