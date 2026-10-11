'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNote, TITLE_MAX } = require('../src/main/notes');

const base = { title: '  Estudiar cap. 3 ', details: ' Ejercicios 1-10 ', date: '2026-10-12', time: '08:30' };

test('validateNote recorta textos y convierte fecha y hora locales a ISO', () => {
  const n = validateNote({ ...base, courseId: '210357' });
  assert.equal(n.title, 'Estudiar cap. 3');
  assert.equal(n.details, 'Ejercicios 1-10');
  assert.equal(n.todoDate, new Date(2026, 9, 12, 8, 30).toISOString());
  assert.equal(n.courseId, 210357);
});

test('validateNote usa 23:59 sin hora y null sin curso', () => {
  const n = validateNote({ ...base, time: '', courseId: '' });
  assert.equal(n.todoDate, new Date(2026, 9, 12, 23, 59).toISOString());
  assert.equal(n.courseId, null);
});

test('validateNote rechaza título vacío o largo, fechas imposibles y cursos raros', () => {
  assert.throws(() => validateNote({ ...base, title: '   ' }), { code: 'validation' });
  assert.throws(() => validateNote({ ...base, title: 'x'.repeat(TITLE_MAX + 1) }), { code: 'validation' });
  assert.throws(() => validateNote({ ...base, date: '2026-02-31' }), {
    message: 'La fecha o la hora no son válidas.',
  });
  assert.throws(() => validateNote({ ...base, date: '12/10/2026' }), { code: 'validation' });
  assert.throws(() => validateNote({ ...base, time: '25:00' }), { code: 'validation' });
  assert.throws(() => validateNote({ ...base, courseId: '7; DROP' }), { code: 'validation' });
  assert.throws(() => validateNote(null), { code: 'validation' });
});
