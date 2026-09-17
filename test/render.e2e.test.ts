import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { rasterizePdfToPngs } from "../src/image.js";
import { PlaywrightPdfRenderer, render } from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const e2e = test.skipIf(Bun.env.PRINT_PAGE_E2E !== "1");

e2e("renders Mustache and window-injected printables with Chromium", async () => {
  const executablePath = Bun.env.PRINT_PAGE_CHROMIUM_EXECUTABLE;
  const renderer = executablePath === undefined
    ? undefined
    : new PlaywrightPdfRenderer({ launchOptions: { executablePath } });

  const mustachePdf = await render({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    useCache: false,
    ...(renderer === undefined ? {} : { renderer }),
  });
  const windowPdf = await render({
    printableDirectory: `${fixtures}/configured`,
    input: { name: "Ada" },
    useCache: false,
    ...(renderer === undefined ? {} : { renderer }),
  });

  for (const bytes of [mustachePdf, windowPdf]) {
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  }
});

e2e("rasterizes CSS-sized pages as 300-DPI PNGs", async () => {
  const executablePath = Bun.env.PRINT_PAGE_CHROMIUM_EXECUTABLE;
  const renderer = executablePath === undefined
    ? undefined
    : new PlaywrightPdfRenderer({ launchOptions: { executablePath } });
  const pdf = await render({
    printableDirectory: `${fixtures}/image-pages`,
    input: {},
    useCache: false,
    ...(renderer === undefined ? {} : { renderer }),
  });
  const images = await rasterizePdfToPngs(pdf);

  expect(images).toHaveLength(2);

  for (const image of images) {
    const metadata = await sharp(image).metadata();

    expect(metadata.width).toBeGreaterThan(591);
    expect(metadata.width).toBeLessThan(593);
    expect(metadata.height).toBeGreaterThan(353);
    expect(metadata.height).toBeLessThan(355);
    expect(metadata.density).toBe(300);
  }
});
