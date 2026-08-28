export interface PrintBackend {
  print(pdf: Uint8Array): Promise<void>;
}
