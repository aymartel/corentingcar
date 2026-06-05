import { APP_VERSION } from '../config/version.js';

/**
 * Documento OpenAPI 3.0 de la API de CoRetingCar. Se sirve con Swagger UI en /api/docs
 * y como JSON en /api/openapi.json. Refleja el contrato (00-context-and-contract.md).
 */

// Sobre de error reutilizable.
const errorResponse = {
  description: 'Error (sobre común)',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
};

const bearer = [{ bearerAuth: [] }];

export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'CoRetingCar API',
    version: APP_VERSION,
    description:
      'API del coche compartido (Andy y Dennis). Todas las respuestas usan el sobre ' +
      '`{ ok: true, data }` o `{ ok: false, error: { code, message } }`. La mayoría de ' +
      'endpoints requieren `Authorization: Bearer <token>` (consíguelo en `POST /api/auth/login` ' +
      'y pulsa **Authorize**). Distancias en km, importes en €.',
  },
  servers: [
    { url: '/', description: 'Este servidor' },
    { url: 'https://api.corentingcar.uk', description: 'Producción' },
    { url: 'http://localhost:3000', description: 'Desarrollo' },
  ],
  tags: [
    { name: 'Salud' },
    { name: 'Auth' },
    { name: 'Perfiles y reglas' },
    { name: 'Prioridad y calendario' },
    { name: 'Kilómetros' },
    { name: 'Gastos' },
    { name: 'Solicitudes' },
    { name: 'Admin' },
  ],
  security: bearer,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token de sesión del login.' },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Datos inválidos.' },
              details: { type: 'object', nullable: true },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Andy' },
          profile: { type: 'string', enum: ['andy', 'amigo'], example: 'andy' },
          color: { type: 'string', nullable: true, example: '#1E88E5' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['profile', 'pin'],
        properties: {
          profile: { type: 'string', enum: ['andy', 'amigo'], example: 'andy' },
          pin: { type: 'string', example: '1234' },
        },
      },
      UsageCreate: {
        type: 'object',
        required: ['date', 'startKm', 'endKm', 'type'],
        properties: {
          date: { type: 'string', format: 'date', example: '2026-06-04' },
          startKm: { type: 'integer', example: 1000 },
          endKm: { type: 'integer', example: 1080 },
          type: { type: 'string', enum: ['individual', 'shared'], example: 'individual' },
        },
      },
      FuelCreate: {
        type: 'object',
        required: ['date', 'amountEur', 'type'],
        properties: {
          date: { type: 'string', format: 'date', example: '2026-06-04' },
          amountEur: { type: 'number', example: 60 },
          type: { type: 'string', enum: ['individual', 'shared'], example: 'shared' },
        },
      },
      WashCreate: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', format: 'date', example: '2026-06-04' },
          costEur: { type: 'number', nullable: true, example: 12 },
        },
      },
      HandoverCreate: {
        type: 'object',
        required: ['date', 'effectivePriorityUserId'],
        properties: {
          date: { type: 'string', format: 'date', example: '2026-06-10' },
          effectivePriorityUserId: { type: 'integer', example: 1 },
          origin: { type: 'string', enum: ['manual', 'one_off_change'], example: 'manual' },
        },
      },
      RequestCreate: {
        type: 'object',
        required: ['useDate'],
        properties: {
          useDate: { type: 'string', format: 'date', example: '2026-06-10' },
          message: { type: 'string', example: 'Tengo médico' },
        },
      },
      ResetRequest: {
        type: 'object',
        required: ['initialKm', 'password'],
        properties: {
          initialKm: { type: 'integer', example: 45000, description: 'Odómetro al recibir el coche (km)' },
          password: { type: 'string', example: 'Pass4admin', description: 'Contraseña de administrador' },
        },
      },
      CarStatusUpdate: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['free', 'taken'], example: 'free' },
          parking: {
            type: 'string',
            enum: ['andy', 'amigo'],
            example: 'amigo',
            description: 'En casa de qué persona se dejó aparcado (al dejarlo libre)',
          },
          note: { type: 'string', maxLength: 200, example: 'Plaza 12' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Salud'],
        summary: 'Healthcheck',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login por perfil + PIN',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          '200': { description: 'Token + usuario' },
          '401': errorResponse,
          '429': errorResponse,
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Cerrar sesión',
        responses: { '200': { description: 'OK' }, '401': errorResponse },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Usuario autenticado',
        responses: { '200': { description: 'Usuario' }, '401': errorResponse },
      },
    },
    '/api/users': {
      get: {
        tags: ['Perfiles y reglas'],
        summary: 'Lista de perfiles (sin PIN)',
        security: [],
        responses: { '200': { description: 'Perfiles' } },
      },
    },
    '/api/rules': {
      get: {
        tags: ['Perfiles y reglas'],
        summary: 'Reglas/configuración (solo lectura)',
        security: [],
        responses: { '200': { description: 'Reglas' } },
      },
    },
    '/api/priority/today': {
      get: {
        tags: ['Prioridad y calendario'],
        summary: 'Prioridad de hoy + frase de conflicto',
        responses: { '200': { description: 'Prioridad de hoy' }, '401': errorResponse },
      },
    },
    '/api/priority': {
      get: {
        tags: ['Prioridad y calendario'],
        summary: 'Prioridad efectiva de una fecha',
        parameters: [
          {
            name: 'date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            example: '2025-01-02',
          },
        ],
        responses: { '200': { description: 'Prioridad' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/api/calendar': {
      get: {
        tags: ['Prioridad y calendario'],
        summary: 'Prioridad por día de un mes',
        parameters: [
          {
            name: 'month',
            in: 'query',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            example: '2026-06',
          },
        ],
        responses: { '200': { description: 'Calendario' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/api/handovers': {
      post: {
        tags: ['Prioridad y calendario'],
        summary: 'Crear/actualizar cesión (handover) de un día',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HandoverCreate' } } },
        },
        responses: { '201': { description: 'Handover' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/api/handovers/{date}': {
      delete: {
        tags: ['Prioridad y calendario'],
        summary: 'Eliminar la cesión de un día',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'OK' }, '401': errorResponse },
      },
    },
    '/api/usage': {
      get: {
        tags: ['Kilómetros'],
        summary: 'Lista de registros de uso',
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'integer' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Registros' }, '401': errorResponse },
      },
      post: {
        tags: ['Kilómetros'],
        summary: 'Registrar uso (totalKm se calcula en servidor)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UsageCreate' } } },
        },
        responses: {
          '201': { description: 'Registro creado' },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/api/mileage': {
      get: {
        tags: ['Kilómetros'],
        summary: 'Resumen de km por persona (usados/restantes/exceso)',
        responses: { '200': { description: 'Resumen' }, '401': errorResponse },
      },
    },
    '/api/fuel': {
      post: {
        tags: ['Gastos'],
        summary: 'Registrar repostaje',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/FuelCreate' } } },
        },
        responses: { '201': { description: 'Repostaje' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/api/washes': {
      post: {
        tags: ['Gastos'],
        summary: 'Registrar lavado',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WashCreate' } } },
        },
        responses: { '201': { description: 'Lavado' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/api/expenses': {
      get: {
        tags: ['Gastos'],
        summary: 'Resumen: balance gasolina + último/próximo lavado',
        responses: { '200': { description: 'Gastos' }, '401': errorResponse },
      },
    },
    '/api/requests': {
      get: {
        tags: ['Solicitudes'],
        summary: 'Listar solicitudes (filtrable por estado)',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'cancelled'] },
          },
        ],
        responses: { '200': { description: 'Solicitudes' }, '401': errorResponse },
      },
      post: {
        tags: ['Solicitudes'],
        summary: 'Crear solicitud de uso',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestCreate' } } },
        },
        responses: {
          '201': { description: 'Solicitud creada (pending)' },
          '400': errorResponse,
          '409': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/api/requests/pending': {
      get: {
        tags: ['Solicitudes'],
        summary: 'Pendientes dirigidas al usuario (badge)',
        responses: { '200': { description: 'Pendientes' }, '401': errorResponse },
      },
    },
    '/api/requests/{id}/accept': {
      patch: {
        tags: ['Solicitudes'],
        summary: 'Aceptar (solo el recipient) → crea handover',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Aceptada' },
          '403': errorResponse,
          '409': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/api/requests/{id}/reject': {
      patch: {
        tags: ['Solicitudes'],
        summary: 'Rechazar (solo el recipient)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Rechazada' }, '403': errorResponse, '409': errorResponse },
      },
    },
    '/api/requests/{id}/cancel': {
      patch: {
        tags: ['Solicitudes'],
        summary: 'Cancelar (solo el solicitante, si pending)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Cancelada' }, '403': errorResponse, '409': errorResponse },
      },
    },
    '/api/car-status': {
      get: {
        tags: ['Coche'],
        summary: 'Estado actual del coche (libre/ocupado, quién, desde cuándo, nota)',
        responses: { '200': { description: 'Estado del coche' }, '401': errorResponse },
      },
      post: {
        tags: ['Coche'],
        summary: 'Fijar estado: "tengo el coche" (taken) / "lo dejo libre" (free)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CarStatusUpdate' } } },
        },
        responses: {
          '200': { description: 'Nuevo estado' },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/api/admin/reset': {
      post: {
        tags: ['Admin'],
        summary: '⚠️ Resetear TODOS los datos y fijar el odómetro inicial',
        description:
          'Borra cesiones, solicitudes, usos, gasolina y lavados; deja un uso base de 0 km con ' +
          '`initialKm` (odómetro al recibir el coche). Conserva usuarios y reglas. Requiere token de ' +
          'sesión **y** la contraseña de administrador.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetRequest' } } },
        },
        responses: {
          '200': { description: 'Datos reseteados' },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
        },
      },
    },
  },
} as const;
