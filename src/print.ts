export interface PrintBackend {
  print(pdfPath: string): Promise<void>;
}
