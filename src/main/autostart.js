'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

/** Entrada XDG de inicio automático (GNOME y la mayoría de escritorios Linux). */
const AUTOSTART_FILE = path.join(os.homedir(), '.config', 'autostart', 'canvas-today.desktop');
/** Segundos que GNOME espera tras iniciar sesión, para que la bandeja ya esté lista. */
const START_DELAY_S = 10;

function isEnabled() {
  return fs.existsSync(AUTOSTART_FILE);
}

function setEnabled(on) {
  if (!on) {
    fs.rmSync(AUTOSTART_FILE, { force: true });
    return;
  }
  // Dentro de una AppImage, process.execPath apunta al montaje temporal: se usa la AppImage.
  const exec = process.env.APPIMAGE
    ? `"${process.env.APPIMAGE}"`
    : `"${process.execPath}" "${app.getAppPath()}"`;
  fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
  fs.writeFileSync(
    AUTOSTART_FILE,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${app.getName()}`,
      `Exec=${exec}`,
      'X-GNOME-Autostart-enabled=true',
      `X-GNOME-Autostart-Delay=${START_DELAY_S}`,
      '',
    ].join('\n'),
  );
}

module.exports = { isEnabled, setEnabled };
