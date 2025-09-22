import { JsonDatabase } from '../storage/json-db.js';
import { PriceService } from '../prices/price-service.js';
import { PricePoint, SpreadCondition, TokenMonitor, TypedEventEmitter } from '@arbi/shared';
import { TelegramNotifier } from '../telegram/telegram.service.js';

interface MonitoringEvents {
  price: { monitor: TokenMonitor; price: PricePoint };
  alert: { monitor: TokenMonitor; condition: SpreadCondition; price: PricePoint };
}

const ALERT_COOLDOWN_MS = 60_000;

export class MonitoringService {
  private emitter = new TypedEventEmitter<MonitoringEvents>();

  private subscriptions = new Map<string, () => void>();
  private subscriptionConfigs = new Map<string, {
    contractAddress: string;
    mexcSymbol?: string;
    jupiterMintAddress?: string;
  }>();

  constructor(
    private db: JsonDatabase,
    private priceService: PriceService,
    private telegram: TelegramNotifier,
  ) {}

  async getMonitor(monitorId: string) {
    const monitor = await this.db.findMonitorById(monitorId);
    if (monitor) {
      this.ensureSubscription(monitor);
    }
    return monitor;
  }

  async listMonitors(userId: string) {
    const monitors = await this.db.listMonitorsByUser(userId);
    monitors.forEach((monitor) => this.ensureSubscription(monitor));
    return monitors;
  }

  async createMonitor(userId: string, data: {
    contractAddress: string;
    mexcSymbol?: string;
    jupiterMintAddress?: string;
    displayName?: string;
    conditions?: SpreadCondition[];
  }) {
    const monitor = await this.db.createMonitor({
      userId,
      contractAddress: data.contractAddress,
      mexcSymbol: data.mexcSymbol,
      jupiterMintAddress: data.jupiterMintAddress,
      displayName: data.displayName,
      conditions: data.conditions,
    });
    this.ensureSubscription(monitor);
    return monitor;
  }

  async updateMonitor(monitorId: string, update: Partial<Omit<TokenMonitor, 'id' | 'userId' | 'createdAt'>>) {
    const monitor = await this.db.findMonitorById(monitorId);
    if (!monitor) {
      throw new Error('Monitor not found');
    }
    const next: TokenMonitor = {
      ...monitor,
      ...update,
      conditions: update.conditions ?? monitor.conditions,
    };
    const saved = await this.db.upsertMonitor(next);
    this.ensureSubscription(saved);
    return saved;
  }

  async removeMonitor(monitorId: string) {
    const removed = await this.db.removeMonitor(monitorId);
    if (removed) {
      const unsub = this.subscriptions.get(monitorId);
      if (unsub) {
        unsub();
        this.subscriptions.delete(monitorId);
      }
      this.subscriptionConfigs.delete(monitorId);
    }
    return removed;
  }

  onPrice(listener: (payload: { monitor: TokenMonitor; price: PricePoint }) => void) {
    this.emitter.on('price', listener);
    return () => this.emitter.off('price', listener);
  }

  onAlert(listener: (payload: { monitor: TokenMonitor; condition: SpreadCondition; price: PricePoint }) => void) {
    this.emitter.on('alert', listener);
    return () => this.emitter.off('alert', listener);
  }

  private ensureSubscription(monitor: TokenMonitor) {
    const nextConfig = {
      contractAddress: monitor.contractAddress,
      mexcSymbol: monitor.mexcSymbol,
      jupiterMintAddress: monitor.jupiterMintAddress,
    };
    const previousConfig = this.subscriptionConfigs.get(monitor.id);
    const hasSubscription = this.subscriptions.has(monitor.id);
    const configChanged =
      !previousConfig ||
      previousConfig.contractAddress !== nextConfig.contractAddress ||
      previousConfig.mexcSymbol !== nextConfig.mexcSymbol ||
      previousConfig.jupiterMintAddress !== nextConfig.jupiterMintAddress;

    if (hasSubscription && configChanged) {
      const existing = this.subscriptions.get(monitor.id);
      existing?.();
      this.subscriptions.delete(monitor.id);
    }

    if (!this.subscriptions.has(monitor.id)) {
      const unsubscribe = this.priceService.subscribe(nextConfig, (price) => this.handlePriceUpdate(monitor.id, price));
      this.subscriptions.set(monitor.id, unsubscribe);
      this.subscriptionConfigs.set(monitor.id, nextConfig);
    }
  }

  private async handlePriceUpdate(monitorId: string, price: PricePoint) {
    const monitor = await this.db.findMonitorById(monitorId);
    if (!monitor) {
      const unsub = this.subscriptions.get(monitorId);
      if (unsub) {
        unsub();
        this.subscriptions.delete(monitorId);
      }
      this.subscriptionConfigs.delete(monitorId);
      return;
    }
    this.emitter.emit('price', { monitor, price });
    await this.evaluateConditions(monitor, price);
  }

  private async evaluateConditions(monitor: TokenMonitor, price: PricePoint) {
    if (price.spread === null) {
      return;
    }
    let shouldPersist = false;
    const updatedConditions = monitor.conditions.map((condition) => {
      if (!condition.isActive) {
        return condition;
      }
      if (condition.type === 'spread_greater_than' && price.spread >= condition.threshold) {
        const lastTriggeredAt = condition.lastTriggeredAt ? new Date(condition.lastTriggeredAt).getTime() : 0;
        const now = Date.now();
        if (!lastTriggeredAt || now - lastTriggeredAt > ALERT_COOLDOWN_MS) {
          this.emitter.emit('alert', { monitor, condition, price });
          shouldPersist = true;
          const nextCondition: SpreadCondition = {
            ...condition,
            lastTriggeredAt: new Date().toISOString(),
          };
          this.notifyTelegram(monitor, price, nextCondition).catch((err) => {
            console.error('Failed to send telegram alert', err);
          });
          return nextCondition;
        }
      }
      return condition;
    });
    if (shouldPersist) {
      const nextMonitor: TokenMonitor = {
        ...monitor,
        conditions: updatedConditions,
      };
      await this.db.upsertMonitor(nextMonitor);
    }
  }

  private async notifyTelegram(
    monitor: TokenMonitor,
    price: PricePoint,
    condition: SpreadCondition,
  ) {
    const user = await this.db.findUserById(monitor.userId);
    if (!user || !user.telegramUserId || !user.notificationsEnabled) {
      return;
    }
    const spreadValue = price.spread?.toFixed(2) ?? 'n/a';
    const mexc = price.mexcPrice ? price.mexcPrice.toFixed(6) : 'n/a';
    const jupiter = price.jupiterPrice ? price.jupiterPrice.toFixed(6) : 'n/a';
    const name = monitor.displayName ?? monitor.contractAddress;
    const message = `Спред по ${name} превысил ${condition.threshold}%\nMEXC: ${mexc}\nJupiter: ${jupiter}\nТекущий спред: ${spreadValue}%`;
    await this.telegram.sendMessage(user.telegramUserId, message);
  }
}
