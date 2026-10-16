// Errores con mensaje seguro para el usuario y middleware centralizado.
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

export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = 'Ocurrió un error interno. Revisa la consola del servidor.';
  if (err.expose && err instanceof AppError) message = err.message;
  else if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') { status = 413; message = 'El archivo o la solicitud supera el tamaño máximo permitido.'; }
  else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') { status = 400; message = 'Envía un único archivo en el campo «archivo».'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'El cuerpo de la solicitud no es JSON válido.'; }
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message, details: err.expose ? err.details : undefined });
}
