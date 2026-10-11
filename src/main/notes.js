'use strict';

const { AppError } = require('./errors');
const { t } = require('./i18n');

/** Límites de Canvas para planner notes (título) y uno propio para que el detalle quepa en la tarjeta. */
const TITLE_MAX = 255;
const DETAILS_MAX = 2000;
/** Sin hora, la nota vence al final del día, como las tareas de Canvas. */
const DEFAULT_TIME = '23:59';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Valida lo que llega del formulario de nota y lo convierte al formato de la API.
 * La fecha y la hora se interpretan en la zona horaria local.
 * @returns {{ title: string, details: string, todoDate: string, courseId: number|null }}
 */
function validateNote(input) {
  const src = input || {};
  const title = String(src.title ?? '').trim();
  if (!title) throw new AppError('validation', t('note.errorTitle'));
  if (title.length > TITLE_MAX) throw new AppError('validation', t('note.errorTitleLong', TITLE_MAX));

  const details = String(src.details ?? '').trim();
  if (details.length > DETAILS_MAX) throw new AppError('validation', t('note.errorDetailsLong', DETAILS_MAX));

  const date = DATE_RE.exec(String(src.date ?? ''));
  const time = TIME_RE.exec(String(src.time || DEFAULT_TIME));
  if (!date || !time) throw new AppError('validation', t('note.errorDate'));
  const [y, mo, d] = date.slice(1).map(Number);
  const local = new Date(y, mo - 1, d, Number(time[1]), Number(time[2]));
  // new Date corrige fechas imposibles (31 de febrero → 3 de marzo); eso es un error del usuario.
  if (local.getFullYear() !== y || local.getMonth() !== mo - 1 || local.getDate() !== d) {
    throw new AppError('validation', t('note.errorDate'));
  }

  const course = String(src.courseId ?? '');
  if (course && !/^\d+$/.test(course)) throw new AppError('validation', t('note.errorCourse'));

  return { title, details, todoDate: local.toISOString(), courseId: course ? Number(course) : null };
}

module.exports = { validateNote, TITLE_MAX, DETAILS_MAX, DEFAULT_TIME };
