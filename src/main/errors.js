'use strict';

/**
 * Error con código para que el renderer decida qué ofrecer:
 * 'auth' y 'config' llevan a Ajustes; 'network', 'http' y 'unknown' a Reintentar.
 */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { AppError };
