import { promises as fs } from 'fs';
import path from 'path';
import Redis from 'ioredis';
import { PriceService, PriceSourceConfig } from '@arbi/backend';
import { PricePoint } from '@arbi/shared';

const redisUrl = process.env.REDIS_URL;
const pollingInterval = Number(process.env.PRICE_POLL_INTERVAL_MS ?? 5000);
const ttlSeconds = Number(process.env.PRICE_CACHE_TTL ?? 5);
const publishChannel = process.env.PRICE_PUBSUB_CHANNEL ?? 'price-updates';
const configFile = process.env.MONITOR_CONFIG_FILE;

const redis = redisUrl ? new Redis(redisUrl) : null;

const parseMonitorsFromEnv = (): PriceSourceConfig[] => {
  const raw = process.env.MONITOR_CONTRACTS;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item.contractAddress === 'string');
    }
    return [];
  } catch (err) {
    console.error('Failed to parse MONITOR_CONTRACTS', err);
    return [];
  }
};

const parseMonitorsFromFile = async (): Promise<PriceSourceConfig[]> => {
  if (!configFile) {
    return [];
  }
  try {
    const absolute = path.resolve(configFile);
    const content = await fs.readFile(absolute, 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item.contractAddress === 'string');
    }
    return [];
  } catch (err) {
    console.error('Failed to parse monitor config file', err);
    return [];
  }
};

const loadMonitorConfigs = async () => {
  const fromEnv = parseMonitorsFromEnv();
  const fromFile = await parseMonitorsFromFile();
  const combined = [...fromEnv, ...fromFile];
  const unique = new Map<string, PriceSourceConfig>();
  combined.forEach((config) => {
    unique.set(config.contractAddress, config);
  });
  return Array.from(unique.values());
};

const upsertRedisState = async (key: string, price: PricePoint) => {
  if (!redis) {
    return;
  }
  await redis.set(key, JSON.stringify(price), 'EX', ttlSeconds);
  await redis.publish(publishChannel, JSON.stringify(price));
};

const main = async () => {
  const monitorConfigs = await loadMonitorConfigs();
  if (monitorConfigs.length === 0) {
    console.warn('No monitor configs supplied. Provide MONITOR_CONTRACTS or MONITOR_CONFIG_FILE');
  }
  const priceService = new PriceService(pollingInterval);
  priceService.onError(({ contractAddress, error }) => {
    console.error('[worker] price fetch error', contractAddress, error);
  });

  monitorConfigs.forEach((config) => {
    priceService.subscribe(config, async (price) => {
      const cacheKey = `price:${config.contractAddress}`;
      if (redis) {
        await upsertRedisState(cacheKey, price);
      } else {
        console.log('[price]', config.contractAddress, price);
      }
    });
  });
};

main().catch((err) => {
  console.error('Worker crashed', err);
  process.exit(1);
});
