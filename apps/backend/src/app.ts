import express from 'express';
import cors from 'cors';
import { loadConfig, EnvConfig } from './config/env.js';
import { JsonDatabase } from './storage/json-db.js';
import { TelegramNotifier } from './telegram/telegram.service.js';
import { AuthService } from './auth/auth.service.js';
import { createAuthRouter } from './auth/auth.routes.js';
import { createAuthMiddleware } from './auth/auth.middleware.js';
import { PriceService } from './prices/price-service.js';
import { MonitoringService } from './monitoring/monitoring.service.js';
import { createMonitoringRouter } from './monitoring/monitoring.routes.js';

export interface ApplicationContext {
  app: express.Express;
  config: EnvConfig;
  db: JsonDatabase;
  telegram: TelegramNotifier;
  authService: AuthService;
  priceService: PriceService;
  monitoringService: MonitoringService;
}

export const createApplication = (overrides?: Partial<EnvConfig>): ApplicationContext => {
  const config = { ...loadConfig(), ...overrides };
  const app = express();

  app.use(
    cors({
      origin: config.frontendUrl ?? '*',
    }),
  );
  app.use(express.json());

  const db = new JsonDatabase(config.dataFile);
  const telegram = new TelegramNotifier(config.telegramBotToken);
  const authService = new AuthService(db, {
    jwtSecret: config.jwtSecret,
    telegramNotifier: telegram,
  });
  const priceService = new PriceService(config.pollingIntervalMs);
  const monitoringService = new MonitoringService(db, priceService, telegram);
  const authMiddleware = createAuthMiddleware(db, config.jwtSecret);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/auth', createAuthRouter(authService, db, authMiddleware));
  app.use('/monitoring', authMiddleware, createMonitoringRouter(monitoringService));

  return {
    app,
    config,
    db,
    telegram,
    authService,
    priceService,
    monitoringService,
  };
};
