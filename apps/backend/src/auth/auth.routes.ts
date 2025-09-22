import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { JsonDatabase } from '../storage/json-db.js';
import { AuthenticatedRequest } from './auth.middleware.js';

export const createAuthRouter = (
  authService: AuthService,
  db: JsonDatabase,
  authMiddleware?: RequestHandler,
) => {
  const router = Router();

  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    telegramUserId: z.string().optional(),
  });

  router.post('/register', async (req, res) => {
    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    try {
      const { user, token } = await authService.register(
        result.data.email,
        result.data.password,
        result.data.telegramUserId,
      );
      return res.status(201).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          telegramUserId: user.telegramUserId,
          notificationsEnabled: user.notificationsEnabled,
          createdAt: user.createdAt,
        },
      });
    } catch (err: any) {
      return res.status(400).json({ message: err.message ?? 'Registration failed' });
    }
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  router.post('/login', async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    try {
      const { user, token } = await authService.login(result.data.email, result.data.password);
      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          telegramUserId: user.telegramUserId,
          notificationsEnabled: user.notificationsEnabled,
          createdAt: user.createdAt,
        },
      });
    } catch (err: any) {
      return res.status(401).json({ message: err.message ?? 'Invalid credentials' });
    }
  });

  const resetSchema = z.object({
    email: z.string().email(),
  });

  router.post('/reset-password', async (req, res) => {
    const result = resetSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    try {
      const { temporaryPassword } = await authService.resetPassword(result.data.email);
      return res.json({ message: 'Password reset', temporaryPassword });
    } catch (err: any) {
      return res.status(404).json({ message: err.message ?? 'User not found' });
    }
  });

  const linkSchema = z.object({
    telegramUserId: z.string(),
  });

  router.post('/link-telegram', async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const result = linkSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    const user = await db.findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.telegramUserId = result.data.telegramUserId;
    await db.updateUser(user);
    return res.json({
      id: user.id,
      email: user.email,
      telegramUserId: user.telegramUserId,
      notificationsEnabled: user.notificationsEnabled,
      createdAt: user.createdAt,
    });
  });

  if (authMiddleware) {
    const notificationSchema = z.object({
      enabled: z.boolean(),
    });

    router.post('/notifications', authMiddleware, async (req: AuthenticatedRequest, res) => {
      if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      const result = notificationSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
      }
      const user = await db.findUserById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      user.notificationsEnabled = result.data.enabled;
      await db.updateUser(user);
      return res.json({
        id: user.id,
        email: user.email,
        telegramUserId: user.telegramUserId,
        notificationsEnabled: user.notificationsEnabled,
        createdAt: user.createdAt,
      });
    });
  }

  return router;
};
