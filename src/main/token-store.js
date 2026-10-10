'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { writePrivate } = require('./config');

const ENCRYPTED_FILE = 'token.enc';
const PLAIN_FILE = 'token';
const GROUP_OTHER_BITS = 0o077;

/**
 * safeStorage cifra con el llavero del sistema (libsecret/KWallet en Linux, DPAPI en Windows).
 * En Linux sin llavero cae a 'basic_text', que usa una clave fija: eso no protege nada,
 * así que se trata como no disponible y se usa el archivo con permisos 600.
 */
function encryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function readPlain(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Guarda el token de Canvas en `dir` (userData).
 * - Con safeStorage: `token.enc`, cifrado.
 * - Sin safeStorage: `token` en texto plano con permisos 600.
 * `legacyFile` es el token de versiones anteriores (~/.config/canvas-widget/token); se migra
 * la primera vez y se borra solo después de comprobar que la copia nueva se lee igual.
 * Usar después de app.whenReady().
 */
function createTokenStore(dir, legacyFile) {
  const encryptedFile = path.join(dir, ENCRYPTED_FILE);
  const plainFile = path.join(dir, PLAIN_FILE);
  let cached = null;

  function load() {
    if (encryptionAvailable() && fs.existsSync(encryptedFile)) {
      try {
        return safeStorage.decryptString(fs.readFileSync(encryptedFile)).trim();
      } catch {
        return '';
      }
    }
    return readPlain(plainFile);
  }

  function read() {
    if (cached === null) cached = load();
    return cached;
  }

  function write(token) {
    if (encryptionAvailable()) {
      writePrivate(encryptedFile, safeStorage.encryptString(token));
      fs.rmSync(plainFile, { force: true });
    } else {
      writePrivate(plainFile, `${token}\n`);
    }
    cached = token;
  }

  /** Pasa a la mejor ubicación disponible un token en texto plano (antiguo o de respaldo). */
  function migrate() {
    if (fs.existsSync(encryptedFile)) return;
    const encrypt = encryptionAvailable();
    // Sin cifrado, el archivo de respaldo ya es el destino: solo queda migrar el antiguo.
    const sources = encrypt ? [plainFile, legacyFile] : [legacyFile];
    if (!encrypt && fs.existsSync(plainFile)) return;

    for (const src of sources) {
      const token = readPlain(src);
      if (!token) continue;
      write(token);
      cached = null;
      if (read() === token) fs.rmSync(src, { force: true });
      return;
    }
  }

  /** Estado para Ajustes: si hay token, si está cifrado y si el archivo plano tiene permisos seguros. */
  function info() {
    const exists = read().length > 0;
    const encrypted = exists && encryptionAvailable() && fs.existsSync(encryptedFile);
    let safePerms = true;
    if (exists && !encrypted) {
      try {
        safePerms = (fs.statSync(plainFile).mode & GROUP_OTHER_BITS) === 0;
      } catch {
        safePerms = true;
      }
    }
    return { exists, encrypted, safePerms, file: encrypted ? encryptedFile : plainFile };
  }

  return { read, write, migrate, info };
}

module.exports = { createTokenStore };
