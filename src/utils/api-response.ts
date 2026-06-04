/**
 * Sobre de respuesta común de la API.
 * Éxito:  { ok: true,  data: ... }
 * Error:  { ok: false, error: { code, message, details? } }
 */

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Construye una respuesta de éxito. */
export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

/** Construye una respuesta de error con el sobre común. */
export function fail(code: string, message: string, details?: unknown): ApiFailure {
  const error: ApiError = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { ok: false, error };
}
