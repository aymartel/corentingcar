import type { Request, RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

/**
 * Rate-limit en memoria para el login por PIN (obligatorio: el PIN es la única barrera de
 * seguridad). Cuenta intentos FALLIDOS por (IP + perfil) en una ventana deslizante y bloquea
 * con 429 al superar el máximo. App de instancia única → in-memory es suficiente.
 */
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ATTEMPTS = 5;

class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  private prune(key: string, now: number): number[] {
    const list = (this.attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length > 0) {
      this.attempts.set(key, list);
    } else {
      this.attempts.delete(key);
    }
    return list;
  }

  check(key: string, now = Date.now()): { blocked: boolean; retryAfterMs: number } {
    const list = this.prune(key, now);
    if (list.length >= MAX_ATTEMPTS) {
      const oldest = list[0] ?? now;
      return { blocked: true, retryAfterMs: Math.max(0, WINDOW_MS - (now - oldest)) };
    }
    return { blocked: false, retryAfterMs: 0 };
  }

  recordFailure(key: string, now = Date.now()): void {
    const list = this.prune(key, now);
    list.push(now);
    this.attempts.set(key, list);
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }
}

const limiter = new LoginRateLimiter();

function keyOf(req: Request): string {
  const ip = req.ip ?? 'unknown';
  const profile = typeof req.body?.profile === 'string' ? req.body.profile : '';
  return `${ip}:${profile}`;
}

/** Middleware: bloquea con 429 si se superó el límite de intentos para esta IP+perfil. */
export const loginRateLimit: RequestHandler = (req, res, next) => {
  const status = limiter.check(keyOf(req));
  if (status.blocked) {
    res.set('Retry-After', Math.ceil(status.retryAfterMs / 1000).toString());
    next(
      new AppError('TOO_MANY_ATTEMPTS', 'Demasiados intentos de acceso. Inténtalo más tarde.', 429),
    );
    return;
  }
  next();
};

export function recordLoginFailure(req: Request): void {
  limiter.recordFailure(keyOf(req));
}

export function recordLoginSuccess(req: Request): void {
  limiter.recordSuccess(keyOf(req));
}
