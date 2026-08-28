export interface RenderCache {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, pdf: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

export interface CacheKeyFactory<Input = unknown> {
  create(input: Input): Promise<string>;
}
