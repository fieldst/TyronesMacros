// lib/eventBus.ts
type Handler<T = any> = (payload: T) => void;

class EventBus {
  private map = new Map<string, Set<Handler>>();

  on<T = any>(event: string, fn: Handler<T>) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn as Handler);
    return () => this.map.get(event)!.delete(fn as Handler);
  }

  emit<T = any>(event: string, payload: T) {
    this.map.get(event)?.forEach(fn => fn(payload));
  }
}
export const eventBus = new EventBus();
