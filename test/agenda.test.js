'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgenda } = require('../src/renderer/agenda');
const { translator, DICTS } = require('../src/main/i18n');

const LOCALE = 'es-GT';
const agenda = createAgenda(translator(DICTS.es), LOCALE);
const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });

// Miércoles 14 de octubre de 2026, 10:00 hora local.
const NOW = new Date(2026, 9, 14, 10, 0);
const at = (days, hours, minutes = 0) => new Date(2026, 9, 14 + days, hours, minutes);
const item = (due, title = 'x') => ({ title, due: due.toISOString() });

test('groupOf ubica cada pendiente en su grupo', () => {
  const cases = [
    [at(-2, 23, 59), 'overdue'],
    [at(-1, 9), 'overdue'],
    [at(0, 8), 'today'], // vencido hoy: se queda en Hoy
    [at(0, 23, 59), 'today'],
    [at(1, 0, 30), 'tomorrow'],
    [at(6, 12), 'week'],
    [at(7, 12), 'later'],
  ];
  for (const [due, group] of cases) assert.equal(agenda.groupOf(item(due), NOW), group, due.toString());
});

test('groupItems devuelve todos los grupos en orden', () => {
  const groups = agenda.groupItems([item(at(1, 9)), item(at(-3, 9))], NOW);
  assert.deepEqual([...groups.keys()], ['overdue', 'today', 'tomorrow', 'week', 'later']);
  assert.equal(groups.get('overdue').length, 1);
  assert.equal(groups.get('tomorrow').length, 1);
  assert.equal(groups.get('today').length, 0);
});

test('dueLabel da texto relativo y clase', () => {
  assert.deepEqual(agenda.dueLabel(item(at(0, 8, 30)), NOW), {
    text: `Venció ${time.format(at(0, 8, 30))}`,
    cls: 'late',
  });
  assert.deepEqual(agenda.dueLabel(item(at(-1, 12)), NOW), { text: 'Ayer', cls: 'late' });
  assert.deepEqual(agenda.dueLabel(item(at(-4, 12)), NOW), { text: 'Hace 4 d', cls: 'late' });
  assert.deepEqual(agenda.dueLabel(item(at(0, 10, 0.5)), NOW), { text: 'En 1 min', cls: 'soon' });
  assert.deepEqual(agenda.dueLabel(item(at(0, 10, 25)), NOW), { text: 'En 25 min', cls: 'soon' });
  assert.deepEqual(agenda.dueLabel(item(at(0, 13)), NOW), { text: 'En 3 h', cls: 'soon' });
  assert.deepEqual(agenda.dueLabel(item(at(0, 20)), NOW), { text: time.format(at(0, 20)), cls: '' });
  assert.deepEqual(agenda.dueLabel(item(at(1, 18)), NOW), { text: time.format(at(1, 18)), cls: '' });
});

test('dueLabel usa día de la semana esta semana y fecha después', () => {
  const week = agenda.dueLabel(item(at(3, 12)), NOW); // sábado
  assert.match(week.text, /^Sáb\.? /);
  assert.ok(week.text.endsWith(time.format(at(3, 12))));
  const later = agenda.dueLabel(item(at(12, 23, 59)), NOW);
  assert.equal(later.text, agenda.formatDay(at(12, 23, 59)));
  assert.match(later.text, /^Lun.*26/);
});

test('summary con atrasadas', () => {
  const s = agenda.summary([item(at(-2, 9)), item(at(-1, 9)), item(at(0, 20)), item(at(3, 9))], NOW);
  assert.deepEqual(s, { late: '2 atrasadas', text: null, sub: '1 para hoy · 4 en total' });
  const one = agenda.summary([item(at(-2, 9))], NOW);
  assert.deepEqual(one, { late: '1 atrasada', text: null, sub: 'nada para hoy · 1 en total' });
});

test('summary con pendientes para hoy', () => {
  const s = agenda.summary([item(at(0, 20)), item(at(0, 22)), item(at(5, 9))], NOW);
  assert.deepEqual(s, { late: null, text: '2 para hoy', sub: '3 en total' });
});

test('summary sin nada hoy indica el próximo', () => {
  const s = agenda.summary([item(at(5, 9), 'Informe'), item(at(2, 9), 'Corto 4')], NOW);
  assert.deepEqual(s, {
    late: null,
    text: 'Nada pendiente hoy',
    sub: `Próxima: Corto 4 · ${agenda.formatDay(at(2, 9))}`,
  });
  assert.deepEqual(agenda.summary([], NOW), { late: null, text: 'Nada pendiente hoy', sub: '' });
});

test('formatos de fecha en español y en inglés', () => {
  assert.match(agenda.formatDay(at(0, 9)), /^Mié\.?,? 14 (de )?oct/);
  assert.match(agenda.formatFull(at(0, 9)), /^miércoles, 14 de octubre/);
  assert.equal(agenda.cap('lunes'), 'Lunes');

  const en = createAgenda(translator(DICTS.en), 'en-US');
  assert.equal(en.formatDay(at(0, 9)), 'Wed, Oct 14');
  assert.deepEqual(en.dueLabel(item(at(-1, 12)), NOW), { text: 'Yesterday', cls: 'late' });
  assert.deepEqual(en.summary([item(at(0, 20))], NOW).text, '1 due today');
});
