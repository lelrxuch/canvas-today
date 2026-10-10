'use strict';

const { AppError } = require('./errors');
const { t } = require('./i18n');
const { DAY_MS } = require('./config');

/** Tope de páginas por consulta: evita bucles si Canvas devuelve enlaces "next" sin fin. */
const MAX_PAGES = 10;
const PER_PAGE = 100;
const DESCRIPTION_MAX_CHARS = 600;
/** Una petición colgada (red caída tras suspender, Wi-Fi que cambia) bloquearía todas las actualizaciones. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Tipos del planner que se muestran; el resto se ignora. */
const SUPPORTED_TYPES = new Set([
  'assignment',
  'sub_assignment',
  'quiz',
  'discussion_topic',
  'wiki_page',
  'planner_note',
  'assessment_request',
]);

/** Endpoint de detalle por tipo; los demás tipos no tienen descripción que cargar. */
const DETAIL_PATHS = {
  assignment: 'assignments',
  quiz: 'quizzes',
  discussion_topic: 'discussion_topics',
};

/** URL de la siguiente página según el header Link de Canvas, o null si no hay. */
function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Por qué un elemento del planner no se muestra, o null si se muestra.
 * Separado de normalizeItem para que el diagnóstico explique cada descarte.
 */
function exclusionReason(raw) {
  if (!SUPPORTED_TYPES.has(raw.plannable_type)) return 'unsupported_type';
  const p = raw.plannable || {};
  if (!(p.due_at || p.todo_date || raw.plannable_date)) return 'no_date';
  const s = raw.submissions || {};
  if (s.submitted) return 'submitted';
  if (s.graded) return 'graded';
  if (s.excused) return 'excused';
  if (raw.planner_override && raw.planner_override.marked_complete) return 'marked_complete';
  return null;
}

/**
 * Convierte un elemento de /api/v1/planner/items al formato de la lista.
 * Devuelve null si el tipo no se muestra, si no tiene fecha o si ya está entregado.
 */
function normalizeItem(raw, now, baseUrl) {
  if (exclusionReason(raw)) return null;
  const p = raw.plannable || {};
  const due = p.due_at || p.todo_date || raw.plannable_date;

  let url = null;
  if (raw.html_url) {
    try {
      url = new URL(raw.html_url, baseUrl).toString();
    } catch {
      url = null;
    }
  }

  const type = raw.plannable_type;
  return {
    id: `${type}-${raw.plannable_id}`,
    courseId: raw.course_id ?? null,
    plannableId: raw.plannable_id ?? null,
    title: p.title || p.name || t('item.untitled'),
    course: raw.context_name || t(type === 'planner_note' ? 'item.personalNote' : 'item.defaultCourse'),
    due: new Date(due).toISOString(),
    url,
    type,
    typeLabel: t(`type.${type}`),
    points: typeof p.points_possible === 'number' ? p.points_possible : null,
    overdue: new Date(due) < now,
    overrideId: raw.planner_override?.id ?? null,
  };
}

/** Texto plano a partir del HTML de una descripción, recortado a `max` caracteres. */
function htmlToText(html, max = DESCRIPTION_MAX_CHARS) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return named[e.toLowerCase()] ?? m;
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const byDue = (a, b) => new Date(a.due) - new Date(b.due);

/**
 * Cliente de la API de Canvas.
 * @param {object} deps
 * @param {typeof fetch} deps.fetch       net.fetch de Electron (o un doble en pruebas)
 * @param {() => object} deps.getConfig   configuración actual (baseUrl, daysAhead, overdueDays)
 * @param {() => string} deps.getToken    token de Canvas
 */
function createCanvasClient({ fetch, getConfig, getToken }) {
  const detailsCache = new Map();

  /** Petición con token a una URL del dominio configurado; traduce los errores a AppError. */
  async function request(url, { method = 'GET', body } = {}) {
    const token = getToken();
    if (!token) throw new AppError('auth', t('error.noToken'));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new AppError('network', t(timedOut ? 'error.timeout' : 'error.offline'));
    }
    if (res.status === 401) throw new AppError('auth', t('error.tokenInvalid'));
    if (res.status === 403) throw new AppError('auth', t('error.forbidden'));
    if (!res.ok) throw new AppError('http', t('error.http', res.status));
    return res;
  }

  /** GET con token; si la respuesta es una lista, sigue la paginación del header Link. */
  async function get(apiPath) {
    if (!getToken()) throw new AppError('auth', t('error.noToken'));
    const { baseUrl } = getConfig();
    const origin = new URL(baseUrl).origin;
    let url = new URL(apiPath, baseUrl).toString();
    const out = [];

    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      // Nunca mandar el token fuera del dominio configurado.
      if (new URL(url).origin !== origin) break;

      const res = await request(url);
      const data = await res.json();
      if (!Array.isArray(data)) return data;
      out.push(...data);
      url = nextLink(res.headers.get('link'));
    }
    return out;
  }

  function plannerWindow(now, overdueDays, daysAhead) {
    return {
      start: new Date(now.getTime() - overdueDays * DAY_MS),
      end: new Date(now.getTime() + daysAhead * DAY_MS),
    };
  }

  async function fetchPlannerRaw(now, overdueDays, daysAhead) {
    const { start, end } = plannerWindow(now, overdueDays, daysAhead);
    const qs = new URLSearchParams({
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      per_page: String(PER_PAGE),
    });
    return get(`/api/v1/planner/items?${qs}`);
  }

  /** Pendientes desde `overdueDays` atrás hasta `daysAhead` adelante, ordenados por fecha. */
  async function fetchPending(now = new Date()) {
    const { baseUrl, overdueDays, daysAhead } = getConfig();
    if (!baseUrl) throw new AppError('config', t('error.noBaseUrl'));
    if (!getToken()) throw new AppError('auth', t('error.noToken'));

    const raw = await fetchPlannerRaw(now, overdueDays, daysAhead);
    return raw
      .map((r) => normalizeItem(r, now, baseUrl))
      .filter(Boolean)
      .sort(byDue);
  }

  /** Descripción, puntos, tipos de entrega, cierre e intentos de un pendiente (con caché). */
  async function fetchDetails(item) {
    if (detailsCache.has(item.id)) return detailsCache.get(item.id);

    let details = {
      description: '',
      pointsPossible: item.points,
      submissionTypes: [],
      lockAt: null,
      allowedAttempts: null,
    };
    const course = String(item.courseId);
    const id = String(item.plannableId);
    const kind = DETAIL_PATHS[item.type];
    if (kind && /^\d+$/.test(course) && /^\d+$/.test(id)) {
      const r = await get(`/api/v1/courses/${course}/${kind}/${id}`);
      const a = r.assignment || {};
      details = {
        description: htmlToText(r.description ?? r.message),
        pointsPossible: r.points_possible ?? a.points_possible ?? item.points,
        submissionTypes: r.submission_types || a.submission_types || [],
        lockAt: r.lock_at ?? null,
        allowedAttempts: r.allowed_attempts ?? a.allowed_attempts ?? null,
      };
    }
    detailsCache.set(item.id, details);
    return details;
  }

  /**
   * Marca o desmarca un pendiente como completado en el planner de Canvas: crea el override
   * (POST) o actualiza el que ya tiene (PUT). Devuelve el id del override.
   */
  async function setComplete(item, complete) {
    const { baseUrl } = getConfig();
    const overrideId = String(item.overrideId ?? '');
    const plannableId = String(item.plannableId ?? '');
    let res;
    if (/^\d+$/.test(overrideId)) {
      res = await request(new URL(`/api/v1/planner/overrides/${overrideId}`, baseUrl).toString(), {
        method: 'PUT',
        body: { marked_complete: complete },
      });
    } else if (/^\d+$/.test(plannableId)) {
      res = await request(new URL('/api/v1/planner/overrides', baseUrl).toString(), {
        method: 'POST',
        body: { plannable_type: item.type, plannable_id: Number(plannableId), marked_complete: complete },
      });
    } else {
      throw new AppError('unknown', t('error.itemNotFound'));
    }
    const data = await res.json();
    return data?.id ?? item.overrideId ?? null;
  }

  /**
   * Compara el planner con las tareas de cada curso activo para encontrar las que Canvas no
   * incluye en el planner, y explica por qué se descartó cada elemento que sí incluye.
   * El resultado no contiene el token ni URLs con credenciales.
   */
  async function diagnose(now = new Date()) {
    const { baseUrl, overdueDays, daysAhead } = getConfig();
    if (!baseUrl) throw new AppError('config', t('error.noBaseUrl'));
    const { start, end } = plannerWindow(now, overdueDays, daysAhead);

    const planner = await fetchPlannerRaw(now, overdueDays, daysAhead);
    const inPlanner = new Set();
    for (const r of planner) {
      const p = r.plannable || {};
      const assignmentId = p.assignment_id ?? (r.plannable_type === 'assignment' ? r.plannable_id : null);
      if (assignmentId !== null && assignmentId !== undefined) inPlanner.add(String(assignmentId));
    }

    const courses = await get('/api/v1/courses?enrollment_state=active&per_page=100');
    const missing = [];
    const courseInfo = [];
    for (const c of courses) {
      const info = {
        id: c.id,
        name: c.name || c.course_code || null,
        enrollments: (c.enrollments || []).map((e) => `${e.type}:${e.enrollment_state}`),
        assignmentsInWindow: 0,
        error: null,
      };
      courseInfo.push(info);
      if (!/^\d+$/.test(String(c.id))) continue;
      let assignments;
      try {
        assignments = await get(
          `/api/v1/courses/${c.id}/assignments?include[]=submission&order_by=due_at&per_page=${PER_PAGE}`,
        );
      } catch (e) {
        info.error = e.code || 'unknown';
        continue;
      }
      for (const a of assignments) {
        if (!a.due_at) continue;
        const due = new Date(a.due_at);
        if (due < start || due > end) continue;
        info.assignmentsInWindow += 1;
        if (inPlanner.has(String(a.id))) continue;
        missing.push({
          course: info.name,
          title: a.name,
          due: a.due_at,
          published: a.published ?? null,
          submissionTypes: a.submission_types || [],
          submission: a.submission?.workflow_state ?? null,
          hasSubmittedSubmissions: a.has_submitted_submissions ?? null,
        });
      }
    }

    return {
      generatedAt: now.toISOString(),
      window: { start: start.toISOString(), end: end.toISOString() },
      planner: planner.map((r) => ({
        course: r.context_name || null,
        type: r.plannable_type,
        title: r.plannable?.title || r.plannable?.name || null,
        due: r.plannable?.due_at || r.plannable?.todo_date || r.plannable_date || null,
        excluded: exclusionReason(r),
      })),
      courses: courseInfo,
      missingFromPlanner: missing,
    };
  }

  const markComplete = (item) => setComplete(item, true);
  const unmarkComplete = (item) => setComplete(item, false);

  return { get, fetchPending, fetchDetails, markComplete, unmarkComplete, diagnose };
}

module.exports = { nextLink, normalizeItem, exclusionReason, htmlToText, byDue, createCanvasClient };
