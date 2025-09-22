import EventEmitter from 'eventemitter3';

export type PubSubEventMap<TEvents extends Record<string, any>> = {
  [K in keyof TEvents]: (payload: TEvents[K]) => void;
};

export class TypedEventEmitter<TEvents extends Record<string, any>> {
  private emitter = new EventEmitter();

  on<K extends keyof TEvents>(event: K, listener: (payload: TEvents[K]) => void) {
    this.emitter.on(event as string, listener as any);
  }

  once<K extends keyof TEvents>(event: K, listener: (payload: TEvents[K]) => void) {
    this.emitter.once(event as string, listener as any);
  }

  off<K extends keyof TEvents>(event: K, listener: (payload: TEvents[K]) => void) {
    this.emitter.off(event as string, listener as any);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]) {
    this.emitter.emit(event as string, payload);
  }

  listenerCount(event: keyof TEvents) {
    return this.emitter.listenerCount(event as string);
  }
}
