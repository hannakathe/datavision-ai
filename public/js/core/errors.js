// Errores con mensaje seguro para el usuario. Compartido por el servidor y el modo navegador.
export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, details);
export const notFound = (msg = 'Recurso no encontrado.') => new AppError(404, msg);
