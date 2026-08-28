import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PlaywrightPdfRenderer, renderToFile } from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const e2e = test.skipIf(Bun.env.PRINT_PAGE_E2E !== "1");

e2e("renders Mustache and window-injected printables with Chromium", async () => {
  const directory = await mkdtemp(join(tmpdir(), "print-page-e2e-"));
  const executablePath = Bun.env.PRINT_PAGE_CHROMIUM_EXECUTABLE;
  const renderer = executablePath === undefined
    ? undefined
    : new PlaywrightPdfRenderer({ launchOptions: { executablePath } });

  try {
    const mustacheOutput = join(directory, "mustache.pdf");
    const windowOutput = join(directory, "window.pdf");

    await renderToFile({
      printableDirectory: `${fixtures}/minimal`,
      input: { name: "Ada" },
      outputPath: mustacheOutput,
      useCache: false,
      ...(renderer === undefined ? {} : { renderer }),
    });
    await renderToFile({
      printableDirectory: `${fixtures}/configured`,
      input: { name: "Ada" },
      outputPath: windowOutput,
      useCache: false,
      ...(renderer === undefined ? {} : { renderer }),
    });

    for (const outputPath of [mustacheOutput, windowOutput]) {
      const bytes = new Uint8Array(await Bun.file(outputPath).arrayBuffer());

      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      expect(bytes.byteLength).toBeGreaterThan(1_000);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
