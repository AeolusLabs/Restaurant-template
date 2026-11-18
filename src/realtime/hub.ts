/** Hands each message to every listener. A listener that throws (its connection closed) is dropped. */
export class StreamHub<T> {
  private readonly listeners = new Set<(message: T) => void>();

  get size(): number {
    return this.listeners.size;
  }

  subscribe(listener: (message: T) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  publish(message: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(message);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
}
