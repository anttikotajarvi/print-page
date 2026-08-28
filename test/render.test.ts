import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileRenderCache, type RenderCache } from "../src/cache.js";
import {
  render,
  type PdfRenderer,
  type RenderRequest,
} from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const temporaryDirectories: string[] = [];
const pdf = new TextEncoder().encode("%PDF-1.7\nfake PDF\n");

class MemoryCache implements RenderCache {
  private readonly entries = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.entries.get(key);
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(key, bytes);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("render prepares data and returns renderer output", async () => {
  let received: RenderRequest | undefined;
  const renderer: PdfRenderer = {
    render: async (request) => {
      received = request;
      return pdf;
    },
  };

  const result = await render({
    printableDirectory: `${fixtures}/with-prepare`,
    input: { width: 210, height: 297 },
    renderer,
    cache: new MemoryCache(),
  });

  expect(result).toEqual(pdf);
  expect(received?.data).toEqual({
    width: 210,
    height: 297,
    label: "210 × 297 mm",
  });
});

test("render reuses a deterministic cached PDF", async () => {
  const cache = new MemoryCache();
  let renderCount = 0;
  const renderer: PdfRenderer = {
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  };

  const first = await render({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    renderer,
    cache,
  });
  const second = await render({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    renderer,
    cache,
  });

  expect(first).toEqual(pdf);
  expect(second).toEqual(pdf);
  expect(renderCount).toBe(1);
});

test("render ignores an invalid cached value", async () => {
  let renderCount = 0;
  const cache: RenderCache = {
    read: async () => new Uint8Array(),
    write: async () => undefined,
    clear: async () => undefined,
  };

  const result = await render({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    cache,
    renderer: {
      render: async () => {
        renderCount += 1;
        return pdf;
      },
    },
  });

  expect(result).toEqual(pdf);
  expect(renderCount).toBe(1);
});

test("render rejects a non-PDF renderer result", async () => {
  await expect(
    render({
      printableDirectory: `${fixtures}/minimal`,
      input: {},
      cache: new MemoryCache(),
      renderer: { render: async () => new Uint8Array() },
    }),
  ).rejects.toThrow("Renderer did not return a PDF.");
});

test("FileRenderCache creates and atomically publishes its cache directory", async () => {
  const directory = await temporaryDirectory();
  const cache = new FileRenderCache(join(directory, "cache"));
  const key = "a".repeat(64);

  await cache.write(key, pdf);

  expect(await cache.read(key)).toEqual(pdf);
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "print-page-render-"));
  temporaryDirectories.push(directory);
  return directory;
}
