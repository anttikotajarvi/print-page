import { PDFiumLibrary } from "@hyzyla/pdfium";
import sharp from "sharp";

import { PrintPageError } from "./errors.js";

export const PNG_DPI = 300;

const PDF_POINTS_PER_INCH = 72;

/**
 * Rasterizes each PDF page as a 300-DPI PNG. The PDF remains the source of
 * truth so CSS page geometry and pagination match normal print output.
 */
export async function rasterizePdfToPngs(
  pdf: Uint8Array,
): Promise<Uint8Array[]> {
  let library: Awaited<ReturnType<typeof PDFiumLibrary.init>> | undefined;
  let document: Awaited<ReturnType<
    Awaited<ReturnType<typeof PDFiumLibrary.init>>["loadDocument"]
  >> | undefined;

  try {
    library = await PDFiumLibrary.init();
    document = await library.loadDocument(pdf);
    const images: Uint8Array[] = [];

    for (const page of document.pages()) {
      const { originalWidth, originalHeight } = page.getOriginalSize();
      const bitmap = await page.render({
        // PDFium floors page dimensions before applying `scale`. Calculate the
        // final raster dimensions first so fractional PDF points are retained.
        width: Math.round(originalWidth * PNG_DPI / PDF_POINTS_PER_INCH),
        height: Math.round(originalHeight * PNG_DPI / PDF_POINTS_PER_INCH),
      });
      const image = await sharp(bitmap.data, {
        raw: {
          width: bitmap.width,
          height: bitmap.height,
          channels: 4,
        },
      })
        .png()
        .withMetadata({ density: PNG_DPI })
        .toBuffer();

      images.push(new Uint8Array(image));
    }

    if (images.length === 0) {
      throw new Error("PDF has no pages.");
    }

    return images;
  } catch (error) {
    if (error instanceof PrintPageError) {
      throw error;
    }

    throw new PrintPageError(
      "RENDER_FAILED",
      `Could not rasterize PDF as PNG. ${describeError(error)}`,
      { cause: error },
    );
  } finally {
    document?.destroy();
    library?.destroy();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
