export type StoredObject = { stream: ReadableStream<Uint8Array>; contentType: string };

export interface StorageProvider {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Null when the key does not exist. */
  getStream(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
