import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { loginRateLimit } from '../middlewares/rate-limit.js';
import { requireAuth } from '../middlewares/require-auth.js';
import {
  loginController,
  logoutController,
  meController,
  loginSchema,
} from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimit, validate(loginSchema), loginController);
authRouter.post('/logout', requireAuth, logoutController);
authRouter.get('/me', requireAuth, meController);
