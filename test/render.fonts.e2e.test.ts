import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { PDFiumLibrary } from "@hyzyla/pdfium";

import { PlaywrightPdfRenderer, render } from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const e2e = test.skipIf(Bun.env.PRINT_PAGE_E2E !== "1");

// Kept separate from render.e2e.test.ts: PDFium hangs when initialised twice
// in one process, and that file's rasterization test already initialises it.

e2e("waits for late-loading fonts before printing", async () => {
  const executablePath = Bun.env.PRINT_PAGE_CHROMIUM_EXECUTABLE;
  const renderer = executablePath === undefined
    ? undefined
    : new PlaywrightPdfRenderer({ launchOptions: { executablePath } });
  const pdf = await render({
    printableDirectory: `${fixtures}/font-loading`,
    input: {},
    useCache: false,
    ...(renderer === undefined ? {} : { renderer }),
  });
  const library = await PDFiumLibrary.init();
  const document = await library.loadDocument(pdf);

  try {
    let text = "";

    for (const page of document.pages()) {
      text += page.getText();
    }

    expect(text).toContain("loaded");
    expect(text).not.toContain("pending");
  } finally {
    document.destroy();
    library.destroy();
  }
});
