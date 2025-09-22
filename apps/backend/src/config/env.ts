export interface EnvConfig {
  port: number;
  jwtSecret: string;
  dataFile: string;
  pollingIntervalMs: number;
  telegramBotToken?: string;
  frontendUrl?: string;
}

export const loadConfig = (): EnvConfig => {
  const port = Number(process.env.PORT ?? 4000);
  const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
  const dataFile = process.env.DATA_FILE ?? 'data/store.json';
  const pollingIntervalMs = Number(process.env.PRICE_POLL_INTERVAL_MS ?? 5000);
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const frontendUrl = process.env.FRONTEND_URL;

  return {
    port,
    jwtSecret,
    dataFile,
    pollingIntervalMs,
    telegramBotToken,
    frontendUrl,
  };
};
