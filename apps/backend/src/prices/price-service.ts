import fetch from 'node-fetch';
import { PricePoint, TypedEventEmitter } from '@arbi/shared';

export interface PriceSourceConfig {
  contractAddress: string;
  mexcSymbol?: string;
  jupiterMintAddress?: string;
}

interface PriceEvents {
  price: PricePoint;
  error: { contractAddress: string; error: Error };
}

interface WatcherState {
  config: PriceSourceConfig;
  timer?: NodeJS.Timeout;
  subscribers: number;
  lastPrice?: PricePoint;
}

const toNumber = (value: any): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const fetchMexcPrice = async (symbol?: string): Promise<number | null> => {
  if (!symbol) {
    return null;
  }
  const response = await fetch(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${symbol}`);
  if (!response.ok) {
    throw new Error(`MEXC request failed: ${response.status}`);
  }
  const body = (await response.json()) as any;
  const price = body?.data?.fairPrice ?? body?.data?.lastPrice ?? body?.data?.last;
  return toNumber(price);
};

const fetchJupiterPrice = async (mint?: string): Promise<number | null> => {
  if (!mint) {
    return null;
  }
  const response = await fetch(`https://price.jup.ag/v4/price?ids=${mint}`);
  if (!response.ok) {
    throw new Error(`Jupiter request failed: ${response.status}`);
  }
  const body = (await response.json()) as any;
  const price = body?.data?.[mint]?.price ?? body?.data?.[mint]?.priceUsd;
  return toNumber(price);
};

export class PriceService {
  private emitter = new TypedEventEmitter<PriceEvents>();

  private watchers = new Map<string, WatcherState>();

  constructor(private pollingIntervalMs: number) {}

  subscribe(config: PriceSourceConfig, listener: (price: PricePoint) => void) {
    const key = config.contractAddress;
    const watcher = this.ensureWatcher(config);
    const priceListener = (payload: PricePoint) => {
      if (payload.contractAddress === key) {
        listener(payload);
      }
    };
    this.emitter.on('price', priceListener);
    watcher.subscribers += 1;
    if (watcher.lastPrice) {
      listener(watcher.lastPrice);
    }

    return () => {
      this.emitter.off('price', priceListener);
      watcher.subscribers -= 1;
      if (watcher.subscribers <= 0) {
        this.stopWatcher(key);
      }
    };
  }

  onError(listener: (payload: { contractAddress: string; error: Error }) => void) {
    this.emitter.on('error', listener);
    return () => this.emitter.off('error', listener);
  }

  private ensureWatcher(config: PriceSourceConfig) {
    const key = config.contractAddress;
    let watcher = this.watchers.get(key);
    if (!watcher) {
      watcher = { config, subscribers: 0 };
      this.watchers.set(key, watcher);
      this.startWatcher(key);
    }
    return watcher;
  }

  private startWatcher(key: string) {
    const watcher = this.watchers.get(key);
    if (!watcher) return;
    const poll = async () => {
      try {
        const mexcPrice = await fetchMexcPrice(watcher.config.mexcSymbol);
        const jupiterPrice = await fetchJupiterPrice(watcher.config.jupiterMintAddress);
        let spread: number | null = null;
        if (mexcPrice !== null && jupiterPrice !== null && jupiterPrice !== 0) {
          spread = ((mexcPrice - jupiterPrice) / jupiterPrice) * 100;
        }
        const pricePoint: PricePoint = {
          contractAddress: watcher.config.contractAddress,
          mexcPrice,
          jupiterPrice,
          spread,
          updatedAt: new Date().toISOString(),
        };
        watcher.lastPrice = pricePoint;
        this.emitter.emit('price', pricePoint);
      } catch (err: any) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emitter.emit('error', { contractAddress: watcher.config.contractAddress, error });
      }
    };
    poll();
    watcher.timer = setInterval(poll, this.pollingIntervalMs);
  }

  private stopWatcher(key: string) {
    const watcher = this.watchers.get(key);
    if (!watcher) return;
    if (watcher.timer) {
      clearInterval(watcher.timer);
    }
    this.watchers.delete(key);
  }
}
