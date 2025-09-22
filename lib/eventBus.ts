// lib/eventBus.ts
type Handler<T = any> = (payload: T) => void;

class EventBus {
  private map = new Map<string, Set<Handler>>();

  on<T = any>(event: string, fn: Handler<T>) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn as Handler);
    // return unsubscribe function
    return () => this.off(event, fn as Handler);
  }

  off<T = any>(event: string, fn: Handler<T>) {
    const set = this.map.get(event);
    if (!set) return;
    set.delete(fn as Handler);
    if (set.size === 0) this.map.delete(event);
  }

  emit<T = any>(event: string, payload: T) {
    this.map.get(event)?.forEach(fn => fn(payload));
  }

  // optional helpers if you ever need them:
  removeAll(event?: string) {
    if (event) this.map.delete(event);
    else this.map.clear();
  }
}

export const eventBus = new EventBus();
