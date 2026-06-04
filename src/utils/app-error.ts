/**
 * Error de dominio con código estable y estado HTTP. El middleware de errores global
 * lo traduce al sobre `{ ok: false, error: { code, message } }`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
