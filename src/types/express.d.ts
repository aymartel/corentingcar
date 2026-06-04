import type { UserDto } from '../models/user.js';

// Augmenta Express.Request con el usuario y el token de la sesión autenticada (B3).
declare global {
  namespace Express {
    interface Request {
      authUser?: UserDto;
      authToken?: string;
    }
  }
}

export {};
