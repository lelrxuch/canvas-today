'use strict';

// Los diccionarios viven junto al renderer, que los carga como <script>; aquí se reutilizan.
const DICTS = {
  es: require('../renderer/i18n/es'),
  en: require('../renderer/i18n/en'),
};
const DEFAULT_LANG = 'es';

/** Elige idioma a partir del locale del sistema ("en-US" → en); si no hay traducción, español. */
function resolveLocale(systemLocale) {
  const lang = String(systemLocale || '')
    .split('-')[0]
    .toLowerCase();
  if (DICTS[lang]) return { lang, intlLocale: systemLocale };
  return { lang: DEFAULT_LANG, intlLocale: DICTS[DEFAULT_LANG].intlLocale };
}

/** t(clave, ...datos): devuelve el texto, o llama a la función del diccionario con los datos. */
function translator(dict) {
  return (key, ...args) => {
    const value = dict[key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
  };
}

let tr = translator(DICTS[DEFAULT_LANG]);

/** Fija el idioma del proceso principal; llamar tras app.whenReady() con app.getLocale(). */
function init(systemLocale) {
  const locale = resolveLocale(systemLocale);
  tr = translator(DICTS[locale.lang]);
  return locale;
}

module.exports = {
  DICTS,
  resolveLocale,
  translator,
  init,
  t: (key, ...args) => tr(key, ...args),
};
