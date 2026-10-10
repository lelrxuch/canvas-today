'use strict';

/**
 * Modo demostración: `npm run demo` (CANVAS_TODAY_DEMO=1).
 * Muestra pendientes de ejemplo sin conectarse a Canvas ni necesitar token; sirve para
 * probar la interfaz y tomar capturas. No envía avisos de vencimiento.
 */

const { t } = require('./i18n');
const { byDue } = require('./canvas-api');

const HOUR_MS = 60 * 60 * 1000;

const isDemo = () => process.env.CANVAS_TODAY_DEMO === '1';

/** Pendientes de ejemplo con fechas relativas a `now`: uno atrasado, varios hoy y en los próximos días. */
function demoItems(now = new Date()) {
  const inHours = (h) => new Date(now.getTime() + h * HOUR_MS).toISOString();
  const onDay = (days, hours, minutes) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };
  const item = (id, title, course, due, type = 'assignment', points = 10) => ({
    id: `demo-${id}`,
    title,
    course,
    due,
    url: null,
    type,
    typeLabel: t(`type.${type}`),
    points,
    overdue: new Date(due) < now,
  });
  return [
    item(1, 'Diagrama entidad-relación normalizado', 'Bases de Datos I', onDay(-2, 23, 59)),
    item(2, 'Configuración de reglas NAT en pfSense', 'Seguridad de Redes', inHours(1.6), 'assignment', 15),
    item(3, 'Casos de uso: módulo de solicitudes', 'Análisis de Sistemas II', onDay(0, 23, 59)),
    item(4, 'Corto 4: árboles B', 'Estructuras de Datos', onDay(1, 18, 0), 'quiz', 20),
    item(
      5,
      'Foro: ética en sistemas de información',
      'Ética Profesional',
      onDay(3, 12, 0),
      'discussion_topic',
      5,
    ),
    item(6, 'Informe de avance del invernadero', 'Microprocesadores', onDay(4, 20, 0), 'assignment', 25),
    item(
      7,
      'Proyecto final: plataforma de becas',
      'Análisis de Sistemas II',
      onDay(12, 23, 59),
      'assignment',
      40,
    ),
  ].sort(byDue);
}

/** Detalle de ejemplo, igual para todos los pendientes. */
function demoDetails(item) {
  return {
    description: t('demo.description'),
    pointsPossible: item.points,
    submissionTypes: [],
    lockAt: null,
    allowedAttempts: null,
  };
}

module.exports = { isDemo, demoItems, demoDetails };
