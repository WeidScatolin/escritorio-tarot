// Agrupa itens por chave (chat): cada item novo reinicia a espera; quando passa `waitMs` sem
// novidade, entrega todos de uma vez. Usa setTimeout/clearTimeout globais (testável com fake timers).

export type Debouncer<T> = {
  push(key: string, item: T): void;
  has(key: string): boolean;
  /** Descarta os buffers pendentes sem entregar (desligamento). */
  clear(): void;
};

type Options<T> = { waitMs: number; onFlush: (key: string, items: T[]) => void };

type Entry<T> = { items: T[]; timer: ReturnType<typeof setTimeout> };

export function createDebouncer<T>({ waitMs, onFlush }: Options<T>): Debouncer<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    push(key, item) {
      if (waitMs <= 0) {
        onFlush(key, [item]);
        return;
      }
      const previous = entries.get(key);
      if (previous) clearTimeout(previous.timer);
      const items = previous ? [...previous.items, item] : [item];
      const timer = setTimeout(() => {
        entries.delete(key);
        onFlush(key, items);
      }, waitMs);
      entries.set(key, { items, timer });
    },
    has: (key) => entries.has(key),
    clear() {
      for (const entry of entries.values()) clearTimeout(entry.timer);
      entries.clear();
    },
  };
}
