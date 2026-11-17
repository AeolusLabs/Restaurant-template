import type { StorageProvider, StoredObject } from "./types";

/** In-memory storage for development and tests. Lost on restart. */
export class MemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body: body.slice(), contentType });
  }

  async getStream(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    const bytes = o.body.slice();
    return {
      contentType: o.contentType,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
