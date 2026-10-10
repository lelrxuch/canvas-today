'use strict';

const { AppError } = require('./errors');
const { t } = require('./i18n');
const { DAY_MS } = require('./config');

/** Tope de páginas por consulta: evita bucles si Canvas devuelve enlaces "next" sin fin. */
const MAX_PAGES = 10;
const PER_PAGE = 100;
const DESCRIPTION_MAX_CHARS = 600;

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
 * Convierte un elemento de /api/v1/planner/items al formato de la lista.
 * Devuelve null si el tipo no se muestra, si no tiene fecha o si ya está entregado.
 */
function normalizeItem(raw, now, baseUrl) {
  if (!SUPPORTED_TYPES.has(raw.plannable_type)) return null;
  const p = raw.plannable || {};
  const due = p.due_at || p.todo_date || raw.plannable_date;
  if (!due) return null;

  const s = raw.submissions || {};
  const done =
    s.submitted || s.graded || s.excused || (raw.planner_override && raw.planner_override.marked_complete);
  if (done) return null;

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
      res = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
    } catch {
      throw new AppError('network', t('error.offline'));
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

  /** Pendientes desde `overdueDays` atrás hasta `daysAhead` adelante, ordenados por fecha. */
  async function fetchPending(now = new Date()) {
    const { baseUrl, overdueDays, daysAhead } = getConfig();
    if (!baseUrl) throw new AppError('config', t('error.noBaseUrl'));
    if (!getToken()) throw new AppError('auth', t('error.noToken'));

    const qs = new URLSearchParams({
      start_date: new Date(now.getTime() - overdueDays * DAY_MS).toISOString(),
      end_date: new Date(now.getTime() + daysAhead * DAY_MS).toISOString(),
      per_page: String(PER_PAGE),
    });
    const raw = await get(`/api/v1/planner/items?${qs}`);
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

  const markComplete = (item) => setComplete(item, true);
  const unmarkComplete = (item) => setComplete(item, false);

  return { get, fetchPending, fetchDetails, markComplete, unmarkComplete };
}

module.exports = { nextLink, normalizeItem, htmlToText, byDue, createCanvasClient };
