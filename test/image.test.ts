import { expect, test } from "bun:test";

import sharp from "sharp";

import { PNG_DPI, rasterizePdfToPngs } from "../src/image.js";

const encoder = new TextEncoder();

test("rasterizePdfToPngs preserves pages, dimensions, and density", async () => {
  const images = await rasterizePdfToPngs(createTwoPagePdf());

  expect(images).toHaveLength(2);

  const first = await sharp(images[0] ?? new Uint8Array()).metadata();
  const second = await sharp(images[1] ?? new Uint8Array()).metadata();

  expect(images[0]?.slice(0, 8)).toEqual(new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]));
  expect(first).toMatchObject({
    format: "png",
    width: 300,
    height: 600,
    density: PNG_DPI,
  });
  expect(second).toMatchObject({
    format: "png",
    width: 600,
    height: 300,
    density: PNG_DPI,
  });
});

function createTwoPagePdf(): Uint8Array {
  const firstPageContent = "0 0 1 rg\n0 0 72 144 re f\n";
  const secondPageContent = "1 0 0 rg\n0 0 144 72 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 144] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << >> /Contents 6 0 R >>",
    streamObject(firstPageContent),
    streamObject(secondPageContent),
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(source).byteLength);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const crossReferenceOffset = encoder.encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;

  return encoder.encode(source);
}

function streamObject(content: string): string {
  return `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream`;
}
