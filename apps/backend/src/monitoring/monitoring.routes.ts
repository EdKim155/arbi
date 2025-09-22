import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { MonitoringService } from './monitoring.service.js';
import { AuthenticatedRequest } from '../auth/auth.middleware.js';
import { spreadConditionSchema } from '@arbi/shared';

const conditionInputSchema = spreadConditionSchema.omit({ id: true, lastTriggeredAt: true }).extend({
  id: z.string().optional(),
});

export const createMonitoringRouter = (monitoring: MonitoringService) => {
  const router = Router();

  router.get('/contracts', async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const monitors = await monitoring.listMonitors(req.user.id);
    return res.json({ monitors });
  });

  const createSchema = z.object({
    contractAddress: z.string().min(4),
    mexcSymbol: z.string().optional(),
    jupiterMintAddress: z.string().optional(),
    displayName: z.string().optional(),
    conditions: z.array(conditionInputSchema).optional(),
  });

  router.post('/contracts', async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const result = createSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    const conditions = (result.data.conditions ?? []).map((condition) => ({
      id: condition.id ?? randomUUID(),
      type: condition.type,
      threshold: condition.threshold,
      isActive: condition.isActive,
    }));
    const monitor = await monitoring.createMonitor(req.user.id, {
      contractAddress: result.data.contractAddress,
      mexcSymbol: result.data.mexcSymbol,
      jupiterMintAddress: result.data.jupiterMintAddress,
      displayName: result.data.displayName,
      conditions,
    });
    return res.status(201).json({ monitor });
  });

  const updateSchema = createSchema.partial();

  router.patch('/contracts/:monitorId', async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const result = updateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: 'Invalid payload', issues: result.error.issues });
    }
    try {
      const existing = await monitoring.getMonitor(req.params.monitorId);
      if (!existing) {
        return res.status(404).json({ message: 'Monitor not found' });
      }
      if (existing.userId !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const monitor = await monitoring.updateMonitor(req.params.monitorId, {
        ...result.data,
        conditions: result.data.conditions?.map((condition) => ({
          id: condition.id ?? randomUUID(),
          type: condition.type,
          threshold: condition.threshold,
          isActive: condition.isActive,
        })),
      });
      return res.json({ monitor });
    } catch (err: any) {
      return res.status(400).json({ message: err.message ?? 'Unable to update monitor' });
    }
  });

  router.delete('/contracts/:monitorId', async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const existing = await monitoring.getMonitor(req.params.monitorId);
    if (!existing) {
      return res.status(404).json({ message: 'Monitor not found' });
    }
    if (existing.userId !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await monitoring.removeMonitor(req.params.monitorId);
    return res.status(204).send();
  });

  return router;
};
