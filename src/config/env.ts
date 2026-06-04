import 'dotenv/config';
import { z } from 'zod';

/**
 * Lee y valida las variables de entorno. Todas tienen valor por defecto para desarrollo,
 * de modo que `npm run dev` arranque copiando `.env.example` a `.env`. En producción,
 * `SESSION_TOKEN_SECRET` es obligatorio y no puede ser el valor de ejemplo.
 */
const DEFAULT_SESSION_SECRET = 'dev-secret-change-me';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_PATH: z.string().min(1).default('./data/coche.db'),
    CORS_ORIGINS: z.string().default('*'),
    BASE_URL: z.string().url().default('http://localhost:3000'),
    SESSION_TOKEN_SECRET: z.string().min(1).default(DEFAULT_SESSION_SECRET),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.SESSION_TOKEN_SECRET === DEFAULT_SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_TOKEN_SECRET'],
        message: 'Define un SESSION_TOKEN_SECRET seguro en producción (distinto del de ejemplo).',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fallo claro: listar las variables inválidas y abortar el arranque.
  console.error('❌ Variables de entorno inválidas:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
  }
  process.exit(1);
}

const data = parsed.data;

export const env = {
  ...data,
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  /** Orígenes CORS ya normalizados a lista. `['*']` permite cualquiera. */
  corsOrigins: data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
} as const;

export type Env = typeof env;
