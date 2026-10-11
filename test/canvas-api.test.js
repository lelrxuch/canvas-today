'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nextLink,
  normalizeItem,
  exclusionReason,
  htmlToText,
  createCanvasClient,
} = require('../src/main/canvas-api');

const BASE = 'https://canvas.example.edu';
const NOW = new Date('2026-10-14T16:00:00Z');

const raw = (over = {}) => ({
  plannable_type: 'assignment',
  plannable_id: 42,
  course_id: 7,
  context_name: 'Bases de Datos I',
  html_url: '/courses/7/assignments/42',
  plannable: { title: 'Diagrama ER', due_at: '2026-10-15T05:59:00Z', points_possible: 10 },
  submissions: {},
  ...over,
});

test('normalizeItem convierte un elemento del planner', () => {
  assert.deepEqual(normalizeItem(raw(), NOW, BASE), {
    id: 'assignment-42',
    courseId: 7,
    plannableId: 42,
    title: 'Diagrama ER',
    course: 'Bases de Datos I',
    due: '2026-10-15T05:59:00.000Z',
    url: `${BASE}/courses/7/assignments/42`,
    type: 'assignment',
    typeLabel: 'Tarea',
    points: 10,
    overdue: false,
    overrideId: null,
  });
  assert.equal(
    normalizeItem(raw({ planner_override: { id: 5, marked_complete: false } }), NOW, BASE).overrideId,
    5,
  );
});

test('normalizeItem descarta tipos no soportados, sin fecha y ya entregados', () => {
  assert.equal(normalizeItem(raw({ plannable_type: 'calendar_event' }), NOW, BASE), null);
  assert.equal(normalizeItem(raw({ plannable: {} }), NOW, BASE), null);
  assert.equal(normalizeItem(raw({ submissions: { submitted: true } }), NOW, BASE), null);
  assert.equal(normalizeItem(raw({ submissions: { excused: true } }), NOW, BASE), null);
  assert.equal(normalizeItem(raw({ planner_override: { marked_complete: true } }), NOW, BASE), null);
});

test('normalizeItem usa todo_date, plannable_date y textos por defecto', () => {
  const note = normalizeItem(
    raw({
      plannable_type: 'planner_note',
      context_name: null,
      html_url: null,
      plannable: { todo_date: '2026-10-13T12:00:00Z' },
    }),
    NOW,
    BASE,
  );
  assert.equal(note.title, 'Sin título');
  assert.equal(note.course, 'Nota personal');
  assert.equal(note.url, null);
  assert.equal(note.points, null);
  assert.equal(note.overdue, true);

  const page = normalizeItem(
    raw({
      plannable_type: 'wiki_page',
      context_name: '',
      plannable: { name: 'Lectura' },
      plannable_date: '2026-10-20T00:00:00Z',
    }),
    NOW,
    BASE,
  );
  assert.equal(page.title, 'Lectura');
  assert.equal(page.course, 'Canvas');
  assert.equal(page.due, '2026-10-20T00:00:00.000Z');
});

test('nextLink lee rel="next" del header Link', () => {
  const header =
    '<https://c.edu/api/v1/x?page=1>; rel="current", <https://c.edu/api/v1/x?page=2>; rel="next", <https://c.edu/api/v1/x?page=9>; rel="last"';
  assert.equal(nextLink(header), 'https://c.edu/api/v1/x?page=2');
  assert.equal(nextLink('<https://c.edu/api/v1/x?page=9>; rel="last"'), null);
  assert.equal(nextLink(null), null);
});

test('htmlToText quita etiquetas, decodifica entidades y recorta', () => {
  assert.equal(
    htmlToText('<p>Hola&nbsp;<b>mundo</b> &amp; &#233;xito &#x2713;</p><script>alert(1)</script>'),
    'Hola mundo & éxito ✓',
  );
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText('abcdefghij', 5), 'abcd…');
});

/** fetch falso: responde según la URL con { status, body, link }. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const r = routes[url];
    if (!r) throw new Error(`sin ruta: ${url}`);
    return {
      status: r.status ?? 200,
      ok: (r.status ?? 200) < 400,
      json: async () => r.body,
      headers: { get: (name) => (name === 'link' ? (r.link ?? null) : null) },
    };
  };
  return { fetch, calls };
}

const client = (fetch) =>
  createCanvasClient({ fetch, getConfig: () => ({ baseUrl: BASE }), getToken: () => '1~abc' });

test('get sigue la paginación del header Link y junta las páginas', async () => {
  const { fetch, calls } = fakeFetch({
    [`${BASE}/api/v1/x`]: { body: [1, 2], link: `<${BASE}/api/v1/x?page=2>; rel="next"` },
    [`${BASE}/api/v1/x?page=2`]: { body: [3], link: `<${BASE}/api/v1/x?page=1>; rel="first"` },
  });
  assert.deepEqual(await client(fetch).get('/api/v1/x'), [1, 2, 3]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.auth === 'Bearer 1~abc'));
});

test('get no manda el token a otro dominio al paginar', async () => {
  const { fetch, calls } = fakeFetch({
    [`${BASE}/api/v1/x`]: { body: [1], link: '<https://evil.example/steal>; rel="next"' },
  });
  assert.deepEqual(await client(fetch).get('/api/v1/x'), [1]);
  assert.equal(calls.length, 1);
});

test('get se detiene tras el máximo de páginas', async () => {
  const { fetch, calls } = fakeFetch({
    [`${BASE}/api/v1/loop`]: { body: [0], link: `<${BASE}/api/v1/loop>; rel="next"` },
  });
  const out = await client(fetch).get('/api/v1/loop');
  assert.equal(calls.length, 10);
  assert.equal(out.length, 10);
});

test('get traduce errores HTTP a AppError con código', async () => {
  const { fetch } = fakeFetch({
    [`${BASE}/a`]: { status: 401 },
    [`${BASE}/b`]: { status: 500 },
  });
  await assert.rejects(client(fetch).get('/a'), { code: 'auth' });
  await assert.rejects(client(fetch).get('/b'), { code: 'http', message: 'Canvas respondió con error 500.' });
  await assert.rejects(client(fetch).get('/c'), { code: 'network' });
});

/** fetch falso que registra método y cuerpo, y responde con `body`. */
function recordingFetch(body, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    return { status, ok: status < 400, json: async () => body, headers: { get: () => null } };
  };
  return { fetch, calls };
}

const item = { type: 'assignment', plannableId: 42, overrideId: null };

test('markComplete crea el override con POST si no existe', async () => {
  const { fetch, calls } = recordingFetch({ id: 99, marked_complete: true });
  assert.equal(await client(fetch).markComplete(item), 99);
  assert.deepEqual(calls, [
    {
      url: `${BASE}/api/v1/planner/overrides`,
      method: 'POST',
      body: { plannable_type: 'assignment', plannable_id: 42, marked_complete: true },
    },
  ]);
});

test('markComplete y unmarkComplete actualizan con PUT el override existente', async () => {
  const { fetch, calls } = recordingFetch({ id: 99 });
  const c = client(fetch);
  assert.equal(await c.markComplete({ ...item, overrideId: 99 }), 99);
  assert.equal(await c.unmarkComplete({ ...item, overrideId: 99 }), 99);
  assert.deepEqual(
    calls.map((x) => [x.method, x.url, x.body.marked_complete]),
    [
      ['PUT', `${BASE}/api/v1/planner/overrides/99`, true],
      ['PUT', `${BASE}/api/v1/planner/overrides/99`, false],
    ],
  );
});

test('markComplete propaga errores y rechaza ids no numéricos', async () => {
  await assert.rejects(client(recordingFetch({}, 500).fetch).markComplete(item), { code: 'http' });
  const { fetch, calls } = recordingFetch({});
  await assert.rejects(client(fetch).markComplete({ ...item, plannableId: '1/../x' }), { code: 'unknown' });
  assert.equal(calls.length, 0);
});

test('exclusionReason explica cada descarte', () => {
  assert.equal(exclusionReason(raw()), null);
  assert.equal(exclusionReason(raw({ plannable_type: 'calendar_event' })), 'unsupported_type');
  assert.equal(exclusionReason(raw({ plannable: { title: 'x' } })), 'no_date');
  assert.equal(exclusionReason(raw({ submissions: { submitted: true } })), 'submitted');
  assert.equal(exclusionReason(raw({ submissions: { graded: true } })), 'graded');
  assert.equal(exclusionReason(raw({ submissions: { excused: true } })), 'excused');
  assert.equal(exclusionReason(raw({ planner_override: { marked_complete: true } })), 'marked_complete');
});

test('las peticiones llevan timeout y un timeout se reporta como error de red', async () => {
  let signal;
  const fetch = async (_url, init) => {
    signal = init.signal;
    throw new DOMException('timeout', 'TimeoutError');
  };
  await assert.rejects(client(fetch).get('/a'), {
    code: 'network',
    message: 'Canvas tardó demasiado en responder.',
  });
  assert.ok(signal instanceof AbortSignal);
});

test('diagnose lista las tareas de los cursos que faltan en el planner', async () => {
  const config = { baseUrl: BASE, overdueDays: 14, daysAhead: 14 };
  const day = 24 * 60 * 60 * 1000;
  const qs = new URLSearchParams({
    start_date: new Date(NOW.getTime() - 14 * day).toISOString(),
    end_date: new Date(NOW.getTime() + 14 * day).toISOString(),
    per_page: '100',
  });
  const { fetch } = fakeFetch({
    [`${BASE}/api/v1/planner/items?${qs}`]: {
      body: [raw(), raw({ plannable_id: 43, submissions: { submitted: true } })],
    },
    [`${BASE}/api/v1/courses?enrollment_state=active&per_page=100`]: {
      body: [
        { id: 7, name: 'Bases de Datos I', enrollments: [{ type: 'student', enrollment_state: 'active' }] },
      ],
    },
    [`${BASE}/api/v1/courses/7/assignments?include[]=submission&order_by=due_at&per_page=100`]: {
      body: [
        { id: 42, name: 'Diagrama ER', due_at: '2026-10-15T05:59:00Z' },
        { id: 43, name: 'Entregada', due_at: '2026-10-15T05:59:00Z' },
        { id: 44, name: 'Plan de pruebas', due_at: '2026-10-14T22:00:00Z', published: true },
        { id: 45, name: 'Fuera de rango', due_at: '2027-01-01T00:00:00Z' },
        { id: 46, name: 'Sin fecha', due_at: null },
      ],
    },
  });
  const c = createCanvasClient({ fetch, getConfig: () => config, getToken: () => '1~abc' });
  const d = await c.diagnose(NOW);

  assert.deepEqual(
    d.planner.map((p) => p.excluded),
    [null, 'submitted'],
  );
  assert.deepEqual(d.courses, [
    { id: 7, name: 'Bases de Datos I', enrollments: ['student:active'], assignmentsInWindow: 3, error: null },
  ]);
  assert.deepEqual(
    d.missingFromPlanner.map((m) => m.title),
    ['Plan de pruebas'],
  );
  assert.ok(!JSON.stringify(d).includes('1~abc'));
});

test('normalizeItem agrega detalle y curso a las notas personales', () => {
  const n = normalizeItem(
    raw({
      plannable_type: 'planner_note',
      course_id: undefined,
      context_name: undefined,
      html_url: null,
      plannable: { title: 'Repasar', details: 'Cap. 3', todo_date: '2026-10-15T05:59:00Z', course_id: 9 },
    }),
    NOW,
    BASE,
  );
  assert.equal(n.details, 'Cap. 3');
  assert.equal(n.courseId, 9);
  assert.equal(normalizeItem(raw(), NOW, BASE).details, undefined);
});

test('saveNote crea con POST, actualiza con PUT y desvincula el curso con valor vacío', async () => {
  const { fetch, calls } = recordingFetch({ id: 77 });
  const c = client(fetch);
  const note = { title: 'Repasar', details: '', todoDate: '2026-10-15T05:59:00.000Z', courseId: 7 };

  assert.deepEqual(await c.saveNote(note), { id: 77 });
  await c.saveNote({ ...note, courseId: null }, 77);
  await c.saveNote({ ...note, courseId: null });

  assert.deepEqual(calls[0], {
    url: `${BASE}/api/v1/planner_notes`,
    method: 'POST',
    body: { title: 'Repasar', details: '', todo_date: '2026-10-15T05:59:00.000Z', course_id: 7 },
  });
  assert.equal(calls[1].url, `${BASE}/api/v1/planner_notes/77`);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body.course_id, '');
  assert.ok(!('course_id' in calls[2].body));
  await assert.rejects(c.saveNote(note, '1/../2'), { code: 'unknown' });
});

test('deleteNote borra por id y rechaza ids no numéricos', async () => {
  const { fetch, calls } = recordingFetch({});
  const c = client(fetch);
  await c.deleteNote(77);
  assert.deepEqual(calls[0], { url: `${BASE}/api/v1/planner_notes/77`, method: 'DELETE', body: undefined });
  await assert.rejects(c.deleteNote('x'), { code: 'unknown' });
  assert.equal(calls.length, 1);
});
