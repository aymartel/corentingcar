import { describe, it, expect } from 'vitest';
import { errorToResponse } from './error-handler.js';
import { AppError } from '../utils/app-error.js';

describe('errorToResponse', () => {
  it('AppError fuera de producción incluye details', () => {
    const err = new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400, { campo: 'x' });
    const r = errorToResponse(err, false);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.', details: { campo: 'x' } },
    });
    expect(r.logInternal).toBe(false);
  });

  it('AppError en PRODUCCIÓN NO incluye details', () => {
    const err = new AppError('VALIDATION_ERROR', 'Datos inválidos.', 400, { campo: 'x' });
    const r = errorToResponse(err, true);
    expect(r.status).toBe(400);
    expect(r.body.error.details).toBeUndefined();
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('error no controlado → 500 genérico, sin filtrar internos', () => {
    const r = errorToResponse(new Error('contraseña secreta en el stack'), true);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Se ha producido un error interno.' },
    });
    expect(JSON.stringify(r.body)).not.toContain('secreta');
    expect(r.logInternal).toBe(true);
  });
});
