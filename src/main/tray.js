'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const { t } = require('./i18n');

const TRAY_ICON_PX = 22;

/**
 * Ícono de bandeja con menú. En GNOME requiere la extensión AppIndicator;
 * si no se puede crear, devuelve un objeto cuyo update() no hace nada.
 * @param {object} opts
 * @param {string} opts.icon               ruta del PNG
 * @param {() => void} opts.onToggle       mostrar u ocultar la ventana
 * @param {() => void} opts.onRefresh
 * @param {() => void} opts.onQuit
 * @param {() => boolean} opts.isAutostart
 * @param {(on: boolean) => void} opts.onAutostart
 */
function createTray({ icon, onToggle, onRefresh, onQuit, isAutostart, onAutostart }) {
  let tray = null;
  try {
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX }));
    tray.on('click', onToggle);
  } catch {
    tray = null;
  }

  /** Actualiza el tooltip con el total de pendientes y reconstruye el menú. */
  function update(total) {
    if (!tray) return;
    tray.setToolTip(t('tray.tooltip', total));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.toggle'), click: onToggle },
        { label: t('tray.refresh'), click: onRefresh },
        { type: 'separator' },
        {
          label: t('tray.autostart'),
          type: 'checkbox',
          checked: isAutostart(),
          click: (item) => onAutostart(item.checked),
        },
        { type: 'separator' },
        { label: t('tray.quit'), click: onQuit },
      ]),
    );
  }

  return { update };
}

module.exports = { createTray };
