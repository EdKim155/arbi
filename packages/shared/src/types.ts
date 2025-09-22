import { z } from 'zod';

export const spreadConditionSchema = z.object({
  id: z.string(),
  type: z.literal('spread_greater_than'),
  threshold: z.number().min(0),
  isActive: z.boolean().default(true),
  lastTriggeredAt: z.string().datetime().nullable().optional(),
});

export type SpreadCondition = z.infer<typeof spreadConditionSchema>;

export const tokenMonitorSchema = z.object({
  id: z.string(),
  userId: z.string(),
  contractAddress: z.string(),
  mexcSymbol: z.string().optional(),
  jupiterMintAddress: z.string().optional(),
  displayName: z.string().optional(),
  conditions: z.array(spreadConditionSchema),
  createdAt: z.string().datetime(),
});

export type TokenMonitor = z.infer<typeof tokenMonitorSchema>;

export const pricePointSchema = z.object({
  contractAddress: z.string(),
  mexcPrice: z.number().nullable(),
  jupiterPrice: z.number().nullable(),
  spread: z.number().nullable(),
  updatedAt: z.string().datetime(),
});

export type PricePoint = z.infer<typeof pricePointSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  passwordHash: z.string(),
  telegramUserId: z.string().nullable().optional(),
  notificationsEnabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

export const hiddenPasswordMessage = (password: string) => `||${password}||`;
