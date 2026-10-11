'use strict';

/**
 * Textos en español (idioma por defecto).
 * Se carga como <script> en el renderer y con require() en el proceso principal.
 * Cada valor es un texto o una función que recibe los datos variables.
 */
const I18N_ES = {
  intlLocale: 'es-GT',

  // Tipos de pendiente de Canvas
  'type.assignment': 'Tarea',
  'type.sub_assignment': 'Tarea',
  'type.quiz': 'Examen',
  'type.discussion_topic': 'Foro',
  'type.wiki_page': 'Página',
  'type.planner_note': 'Nota',
  'type.assessment_request': 'Revisión',
  'item.untitled': 'Sin título',
  'item.personalNote': 'Nota personal',
  'item.defaultCourse': 'Canvas',

  // Errores
  'error.noBaseUrl': 'Falta la dirección de Canvas.',
  'error.noToken': 'No hay token guardado.',
  'error.offline': 'Sin conexión con Canvas.',
  'error.timeout': 'Canvas tardó demasiado en responder.',
  'error.tokenInvalid': 'El token no es válido o ya venció.',
  'error.forbidden': 'Canvas rechazó el acceso con este token.',
  'error.http': (status) => `Canvas respondió con error ${status}.`,
  'error.itemNotFound': 'Pendiente no encontrado.',
  'error.unknown': 'Error desconocido.',
  'error.saveFailed': 'No se pudo guardar.',
  'error.invalidUrl': 'La dirección de Canvas no es válida.',
  'error.httpsOnly': 'La dirección de Canvas debe usar https.',
  'error.loginPath': 'La ruta de inicio de sesión debe empezar con "/" y no contener "//".',
  'error.tokenFormat': 'El token no tiene el formato de Canvas (número~letras).',

  // Avisos del sistema
  'notify.due': (course, when) => `${course} · vence ${when}`,
  'notify.inMinutes': (n) => `en ${n} min`,
  'notify.inHours': (n) => `en ${n} h`,
  'notify.tokenTitle': 'Token de Canvas',
  'notify.tokenExpired': 'El token ya venció. Genera uno nuevo en Canvas y pégalo en Ajustes.',
  'notify.tokenExpiring': (days) =>
    `El token vence en ${days} ${days === 1 ? 'día' : 'días'}. Genera uno nuevo en Canvas y pégalo en Ajustes.`,

  // Bandeja
  'tray.tooltip': (n) => `Canvas Today · ${n} ${n === 1 ? 'pendiente' : 'pendientes'}`,
  'tray.toggle': 'Mostrar u ocultar',
  'tray.refresh': 'Actualizar ahora',
  'tray.autostart': 'Iniciar con el sistema',
  'tray.quit': 'Salir',

  // Modo demo
  'demo.description':
    'Entrega un documento PDF con el desarrollo completo. Incluye portada, introducción y conclusiones.',

  // Lista
  'title.list': 'Pendientes',
  'title.settings': 'Ajustes',
  'group.overdue': 'Atrasadas',
  'group.today': 'Hoy',
  'group.tomorrow': 'Mañana',
  'group.week': 'Esta semana',
  'group.later': 'Más adelante',
  'due.at': (time) => `Venció ${time}`,
  'due.yesterday': 'Ayer',
  'due.daysAgo': (n) => `Hace ${n} d`,
  'due.inMinutes': (n) => `En ${n} min`,
  'due.inHours': (n) => `En ${n} h`,
  'summary.overdue': (n) => `${n} ${n === 1 ? 'atrasada' : 'atrasadas'}`,
  'summary.today': (n) => `${n} para hoy`,
  'summary.nothingToday': 'nada para hoy',
  'summary.nothingPending': 'Nada pendiente hoy',
  'summary.total': (n) => `${n} en total`,
  'summary.next': (title, day) => `Próxima: ${title} · ${day}`,
  'empty.title': 'Sin pendientes',
  'empty.body': (days) => `No hay entregas en los próximos ${days} días.`,
  points: (n) => `${n} pts`,
  loading: 'Cargando…',

  // Detalle de un pendiente
  'details.failed': 'No se pudieron cargar las instrucciones.',
  'details.none': 'Sin instrucciones',
  'details.closes': (date) => `Cierra: ${date}`,
  'details.unlimitedAttempts': 'Intentos ilimitados',
  'details.attempts': (n) => `${n} ${n === 1 ? 'intento' : 'intentos'}`,
  'details.open': 'Abrir en Canvas',
  'discard.button': 'Descartar',
  'discard.closed': 'Ya no se puede entregar',
  'discard.done': 'Tarea descartada',
  'discard.undo': 'Deshacer',

  // Banner, pie y barra de título
  'banner.settings': 'Ajustes',
  'banner.retry': 'Reintentar',
  'footer.demo': 'Modo demostración',
  'footer.updated': (time) => `Actualizado ${time}`,
  'footer.login': 'Iniciar sesión',
  'footer.openCanvas': 'Abrir Canvas',
  'chip.expired': 'Token vencido',
  'chip.days': (n) => `Token: ${n} d`,
  'chip.hint': 'Genera un token nuevo en Canvas y pégalo en Ajustes',
  'pin.on': 'Dejar de mantener encima',
  'pin.off': 'Mantener encima',
  'btn.hide': 'Ocultar',
  'btn.minimize': 'Minimizar',
  'btn.refresh': 'Actualizar',
  'btn.settings': 'Ajustes',

  // Ajustes
  'settings.connection': 'Conexión',
  'settings.baseUrl': 'Dirección de Canvas',
  'settings.loginPath': 'Ruta de inicio de sesión',
  'settings.token': 'Token',
  'settings.tokenPlaceholder': 'Pegar token nuevo (opcional)',
  'settings.tokenExpires': 'Vence el',
  'settings.tokenMissing': 'No hay token guardado. Pégalo abajo.',
  'settings.tokenUnsafe':
    'Token guardado, pero otros usuarios pueden leerlo. Ejecuta chmod 600 en el archivo.',
  'settings.tokenEncrypted': 'Token guardado cifrado en el llavero del sistema.',
  'settings.tokenFile': (file) =>
    `Token sin cifrar en ${file} (solo tu usuario puede leerlo). No hay llavero del sistema disponible.`,
  'settings.pending': 'Pendientes',
  'settings.notifyHours': 'Avisar antes de vencer',
  'settings.daysAhead': 'Mostrar los próximos',
  'settings.refreshMinutes': 'Actualizar cada',
  'settings.window': 'Ventana',
  'settings.theme': 'Apariencia',
  'settings.themeSystem': 'Sistema',
  'settings.themeLight': 'Claro',
  'settings.themeDark': 'Oscuro',
  'settings.opacity': 'Opacidad',
  'settings.alwaysOnTop': 'Mantener encima',
  'settings.autostart': 'Iniciar con el sistema',
  'settings.cancel': 'Cancelar',
  'settings.save': 'Guardar',
  'settings.saving': 'Guardando…',
  'settings.quit': 'Salir de Canvas Today',
  'unit.minutes': (n) => `${n} min`,
  'unit.hours': (n) => `${n} ${n === 1 ? 'hora' : 'horas'}`,
  'unit.days': (n) => `${n} ${n === 1 ? 'día' : 'días'}`,

  // Notas personales (planner notes de Canvas)
  'btn.newNote': 'Nueva nota (Ctrl+N)',
  'title.newNote': 'Nueva nota',
  'title.editNote': 'Editar nota',
  'note.title': 'Título',
  'note.titlePlaceholder': 'Estudiar capítulo 3',
  'note.details': 'Detalles',
  'note.date': 'Fecha',
  'note.time': 'Hora',
  'note.course': 'Curso',
  'note.noCourse': 'Ninguno',
  'note.syncHint': 'Se guarda en tu planner de Canvas: también la ves en la web y en la app móvil.',
  'note.edit': 'Editar',
  'note.delete': 'Eliminar',
  'note.deleted': 'Nota eliminada',
  'note.noDetails': 'Sin detalles',
  'note.errorTitle': 'Escribe un título.',
  'note.errorTitleLong': (n) => `El título no puede pasar de ${n} caracteres.`,
  'note.errorDetailsLong': (n) => `Los detalles no pueden pasar de ${n} caracteres.`,
  'note.errorDate': 'La fecha o la hora no son válidas.',
  'note.errorCourse': 'Curso no válido.',

  // Pestañas
  'tab.home': 'Inicio',
  'tab.tasks': 'Tareas',
  'tab.notes': 'Notas',
  'home.emptyTitle': 'Nada urgente',
  'home.emptyBody': 'No hay nada atrasado, para hoy ni para mañana.',
  'home.more': (n) => `${n} más en Tareas →`,
  'notes.emptyTitle': 'Sin notas',
  'notes.emptyBody': 'Crea una con + o Ctrl+N.',
  'notes.count': (n) => (n === 1 ? '1 nota' : `${n} notas`),
};

if (typeof module === 'object') module.exports = I18N_ES;
