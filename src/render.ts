import type { PrintableSettings } from "./types.js";

export interface RenderRequest {
  printableDirectory: string;
  settings: PrintableSettings;
  data: unknown;
}

export interface RenderedPdf {
  bytes: Uint8Array;
}

/**
 * Browser lifecycle implementations live behind this boundary so that HTML
 * rendering stays independent from output naming, caching, and host printing.
 */
export interface PdfRenderer {
  render(request: RenderRequest): Promise<RenderedPdf>;
}
